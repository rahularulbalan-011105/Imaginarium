import * as THREE from 'three'
import { physicsManager } from './physics/PhysicsManager.js'
import { sceneManager } from './SceneManager.js'
import { cloneModel } from '../utils/modelLoader.js'
import { getWeapon } from '../combat/weaponRegistry.js'
import { damageManager } from '../combat/DamageManager.js'
import { projectileManager } from '../combat/ProjectileManager.js'
import { statusEffectSystem } from '../combat/StatusEffectSystem.js'
import { useCombatStore } from '../stores/combatStore.js'

// ─────────────────────────────────────────────────────────────────────────────
// WeaponManager — per-robot weapon runtime.
//
// Equips each robot with a weapon (from weaponRegistry), mounts its GLB on top of
// the chassis, and each frame: advances reload/cooldown, and — while the fire key
// is held and the robot isn't overheated — fires via the weapon's strategy:
//   ray    → instant raycast per pellet (+ tracer VFX)         [autocannon, shotgun]
//   rocket → ProjectileManager physical rocket → ExplosionSystem [rocket pod]
//   flame  → short cone raycasts + burning status               [flamethrower]
// All damage is emitted as DamageEvents through the single funnel; heat/recoil/
// knockback/status are applied here. Aim = the robot's facing (top-down arena).
// ─────────────────────────────────────────────────────────────────────────────

const FWD = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)

class WeaponManager {
  constructor() {
    this._weapons = {}       // robotId -> instance
    this._getRobot = null    // (id) -> { id, bodyId, radius, stats }
    this._getActor = null    // (id) -> runtime actor
    this._tracers = []       // active tracer VFX
    this._tracerPool = []
    this._scene = null
  }

  configure({ getRobot, getActor }) {
    this._scene = sceneManager.scene
    this._getRobot = getRobot; this._getActor = getActor
    return this
  }

  equip(robotId, weaponKey) {
    const def = getWeapon(weaponKey)
    if (!def) return
    this._weapons[robotId] = {
      def, ammo: def.magSize, cooldown: 0, reloading: false, reloadEndsAt: 0,
      recoilGrow: 0, mesh: null, flameMesh: null,
    }
  }

  // Mount weapon GLBs (call after their models are loaded).
  mountMeshes() {
    for (const [id, inst] of Object.entries(this._weapons)) {
      const g = cloneModel(inst.def.model)
      if (g) { g.userData.isArena = true; g.traverse(c => { c.userData.isArena = true }); this._scene.add(g); inst.mesh = g }
    }
  }

  // ── Per-frame ───────────────────────────────────────────────────────────────
  step(dt, now, fireInputs) {
    for (const [id, inst] of Object.entries(this._weapons)) {
      const robot = this._getRobot(id)
      const actor = this._getActor(id)
      if (!robot || !actor || actor.state === 'destroyed') continue

      // Reload / cooldown / progressive-recoil decay.
      if (inst.reloading) { if (now >= inst.reloadEndsAt) { inst.reloading = false; inst.ammo = inst.def.magSize } }
      inst.cooldown = Math.max(0, inst.cooldown - dt)
      inst.recoilGrow = Math.max(0, inst.recoilGrow - dt * 6)

      const firing = !!fireInputs[id] && !inst.reloading && inst.cooldown <= 0 && inst.ammo > 0 && !actor.overheated
      if (firing) this._fire(robot, actor, inst, now)
      else if (inst.flameMesh) inst.flameMesh.visible = false

      // Mirror weapon state to the HUD.
      useCombatStore.getState().patchActor(id, {
        weaponName: inst.def.name, ammo: Math.ceil(inst.ammo), magSize: inst.def.magSize, reloading: inst.reloading,
      })
    }
  }

  _fire(robot, actor, inst, now) {
    const def = inst.def
    const body = physicsManager.getBody(robot.bodyId)
    if (!body) return
    const P = body.translation()
    const rot = body.rotation()
    const Q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
    const forward = FWD.clone().applyQuaternion(Q)
    const muzzle = new THREE.Vector3(P.x, P.y, P.z)
      .addScaledVector(forward, (robot.radius || 1) + 0.4)
      .addScaledVector(UP, def.muzzleY || 1.2)
    const mass = body.mass() || 1

    if (def.strategy === 'ray')          this._fireRay(robot, actor, inst, muzzle, forward, now)
    else if (def.strategy === 'rocket')  this._fireRocket(robot, inst, muzzle, forward)
    else if (def.strategy === 'flame')   this._fireFlame(robot, actor, inst, muzzle, forward, now)

    // Recoil (self impulse), heat, self-status, ammo, cadence.
    if (def.recoil) physicsManager.applyImpulse(robot.id, { x: -forward.x * def.recoil * mass, y: 0, z: -forward.z * def.recoil * mass })
    actor.heat = Math.min(actor.heatMax, actor.heat + def.heatPerShot)
    for (const s of def.selfStatus || []) statusEffectSystem.add(actor, s, now)
    inst.ammo -= 1
    inst.cooldown = 1 / def.fireRateHz
    if (inst.ammo <= 0) { inst.reloading = true; inst.reloadEndsAt = now + def.reloadMs }
  }

  _fireRay(robot, actor, inst, muzzle, forward, now) {
    const def = inst.def
    const pellets = def.pellets || 1
    for (let k = 0; k < pellets; k++) {
      const dir = perturb(forward, def.spreadDeg + inst.recoilGrow)
      const hit = physicsManager.raycast(muzzle, dir, def.range, robot.id)
      let end
      if (hit && hit.id != null && hit.id !== robot.id) {
        this._hitTarget(robot, hit.id, def, dir, now)
        end = hit.point
      } else {
        end = { x: muzzle.x + dir.x * def.range, y: muzzle.y + dir.y * def.range, z: muzzle.z + dir.z * def.range }
      }
      this._tracer(muzzle, end)
    }
    inst.recoilGrow = Math.min(6, inst.recoilGrow + 0.9)   // progressive recoil
  }

  _fireRocket(robot, inst, muzzle, forward) {
    const dir = perturb(forward, inst.def.spreadDeg)
    projectileManager.spawnRocket(muzzle, dir, robot.id, inst.def)
  }

  _fireFlame(robot, actor, inst, muzzle, forward, now) {
    const def = inst.def
    for (let k = 0; k < (def.pellets || 3); k++) {
      const dir = perturb(forward, def.spreadDeg)
      const hit = physicsManager.raycast(muzzle, dir, def.range, robot.id)
      if (hit && hit.id != null && hit.id !== robot.id) this._hitTarget(robot, hit.id, def, dir, now)
    }
    this._flameVFX(inst, muzzle, forward)
  }

  _hitTarget(robot, targetId, def, dir, now) {
    const target = this._getActor(targetId)
    if (!target || target.state === 'destroyed') return
    const crit = !!def.crit && target.armor <= 0
    damageManager.apply({
      targetId, sourceId: robot.id, damageType: def.strategy === 'flame' ? 'burn' : 'core',
      amounts: { ...def.damage }, crit, critMul: def.critMul,
    })
    for (const e of def.statusEffects || []) statusEffectSystem.add(target, e, now)
    if (def.knockback) {
      const body = physicsManager.getBody(targetId)
      const mass = body ? body.mass() : 1
      physicsManager.applyImpulse(targetId, { x: dir.x * def.knockback * mass, y: 0, z: dir.z * def.knockback * mass })
    }
  }

  // ── Weapon-mesh placement (call each frame after robots are posed) ────────────
  tickMeshes() {
    for (const [id, inst] of Object.entries(this._weapons)) {
      if (!inst.mesh) continue
      const robot = this._getRobot(id)
      const body = robot && physicsManager.getBody(robot.bodyId)
      if (!body) { inst.mesh.visible = false; continue }
      const P = body.translation(), rot = body.rotation()
      inst.mesh.visible = true
      inst.mesh.position.set(P.x, P.y + (inst.def.muzzleY || 1.2), P.z)
      inst.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w)
    }
  }

  // Advance tracer VFX + flame decay.
  stepVFX(dt) {
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i]
      t.life -= dt
      if (t.life <= 0) { t.line.visible = false; this._tracerPool.push(t.line); this._tracers.splice(i, 1) }
      else t.line.material.opacity = Math.max(0, t.life / 0.06)
    }
  }

  _tracer(a, b) {
    let line = this._tracerPool.pop()
    if (!line) {
      line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 1, depthWrite: false }),
      )
      line.userData.isArena = true
      this._scene.add(line)
    }
    const pos = line.geometry.attributes.position
    pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true
    line.material.opacity = 1; line.visible = true
    this._tracers.push({ line, life: 0.06 })
  }

  _flameVFX(inst, muzzle, forward) {
    if (!inst.flameMesh) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(inst.def.range * 0.35, inst.def.range, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }),
      )
      cone.geometry.rotateX(Math.PI / 2)      // point +Z
      cone.geometry.translate(0, 0, inst.def.range / 2)
      cone.userData.isArena = true
      this._scene.add(cone); inst.flameMesh = cone
    }
    inst.flameMesh.visible = true
    inst.flameMesh.position.copy(muzzle)
    inst.flameMesh.quaternion.setFromUnitVectors(FWD, forward)
    inst.flameMesh.material.opacity = 0.28 + Math.random() * 0.22   // flicker
  }

  clear() {
    for (const inst of Object.values(this._weapons)) {
      inst.mesh?.removeFromParent()
      if (inst.flameMesh) { inst.flameMesh.geometry.dispose(); inst.flameMesh.material.dispose(); inst.flameMesh.removeFromParent() }
    }
    for (const t of this._tracers) t.line.removeFromParent()
    for (const l of this._tracerPool) { l.geometry.dispose(); l.material.dispose(); l.removeFromParent() }
    this._weapons = {}; this._tracers = []; this._tracerPool = []
    this._getRobot = this._getActor = null
  }
}

// Random direction within a `spreadDeg` cone around `dir`.
function perturb(dir, spreadDeg) {
  if (spreadDeg <= 0) return dir.clone()
  const rad = (spreadDeg * Math.PI) / 180
  const up = Math.abs(dir.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)
  const right = new THREE.Vector3().crossVectors(dir, up).normalize()
  const tup = new THREE.Vector3().crossVectors(right, dir).normalize()
  const a = (Math.random() - 0.5) * rad, b = (Math.random() - 0.5) * rad
  return dir.clone().addScaledVector(right, Math.tan(a)).addScaledVector(tup, Math.tan(b)).normalize()
}

export const weaponManager = new WeaponManager()
