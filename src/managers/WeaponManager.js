import * as THREE from 'three'
import { physicsManager } from './physics/PhysicsManager.js'
import { sceneManager } from './SceneManager.js'
import { getWeapon } from '../combat/weaponRegistry.js'
import { damageManager } from '../combat/DamageManager.js'
import { projectileManager } from '../combat/ProjectileManager.js'
import { statusEffectSystem } from '../combat/StatusEffectSystem.js'
import { useCombatStore } from '../stores/combatStore.js'
import { mountSpecFor } from './SurfaceMountManager.js'

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
// knockback/status are applied here.
//
// Aim: a MOUNTED weapon fires from its own muzzle along its own barrel axis —
// the model's local forward from its mount spec (weaponRegistry `mount.forward`,
// e.g. autocannon/rocket +X, shotgun/flame +Z) taken through the weapon's live
// world transform, muzzle = the far end of the model along that axis (measured
// once per instance from the mesh, or `def.muzzle` {x,y,z} model-local when a
// definition sets it). So turning a weapon in the editor turns where it shoots.
// Only a weapon with no mesh (built-in melee) uses the robot's facing.
//
// Mouse aiming (player): setAimTarget(robotId, worldPoint) gives every mounted
// weapon a point to aim at. Each frame a weapon with an `aim` spec swivels on
// its mount toward it — yaw about its mount-up axis, pitch about its side axis,
// both clamped to the def's arc (yawDeg / upDeg / downDeg) and moved at its
// traverse / elevation speed — so the barrel physically turns and the shot
// still leaves the real muzzle along the real (aimed) barrel. The swivel is a
// local rotation on top of the mounted pose (inst.aimQ, applied by
// CombatManager when it places the part); the editor pose is never written.
// Shells aim with drop compensation (they fall under def.gravity). No target
// (AI, or no pointer yet) → weapons sit at rest, exactly as mounted.
//
// Hits are resolved to a COMPONENT before any damage (traceShot): the physics
// ray finds the robot's collision box, then the robot's component model
// (RobotDamageView.resolve) finds the actual part the shot meets along that
// line. No part met → the round flies on past that robot (it only clipped the
// box). Damage then depends on the impact: angle of incidence (a grazing
// kinetic round ricochets for a quarter damage), and the struck component takes
// it scaled by its role's toughness. Damaged weapons lose function (spread,
// cadence, swivel speed); a detached one cannot fire at all.
// ─────────────────────────────────────────────────────────────────────────────

const FWD = new THREE.Vector3(0, 0, 1)
const UP = new THREE.Vector3(0, 1, 0)
const DEG = Math.PI / 180
const RICOCHET_COS = 0.22          // a kinetic round meeting a surface flatter than ~77° glances off
const RICOCHET_MUL = 0.25
const AXES = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] }

class WeaponManager {
  constructor() {
    this._weapons = {}       // robotId -> { all: inst[], primaries: inst[], secondary: inst|null, primary: inst|null }
    this._getRobot = null    // (id) -> { id, bodyId, radius, stats }
    this._getActor = null    // (id) -> runtime actor
    this._onFire = null      // (robotId, def) -> void  (audio / recoil shake)
    this._tracers = []       // active tracer VFX
    this._tracerPool = []
    this._flashes = []       // muzzle flashes
    this._flashPool = []
    this._firedOnce = false
    this._scene = null
  }

  // resolveShot(targetId, entry, dir) → component hit | null; exitPoint(…);
  // partHealth(robotId, mesh) → 0..1 — the robot component model (host-provided).
  configure({ getRobot, getActor, onFire = null, resolveShot = null, exitPoint = null, partHealth = null }) {
    this._scene = sceneManager.scene
    this._getRobot = getRobot; this._getActor = getActor; this._onFire = onFire
    this._resolveShot = resolveShot; this._exitPoint = exitPoint; this._partHealth = partHealth
    this._aimTargets = {}
    // Shell sweeps report every robot box they touch; the component model says
    // whether the round really struck something. Returns false → it flies on.
    projectileManager.onShellHit = (sh, hitId, point, dir) => {
      const robot = this._getRobot?.(sh.ownerId)
      if (!robot || !this._getActor?.(hitId)) return true
      const res = this._resolveShot ? this._resolveShot(hitId, point, dir) : null
      if (this._resolveShot && !res) return false
      this._hitTarget(robot, hitId, sh.def, dir, performance.now(), res?.point ?? point, res)
      this._tracer(res?.point ?? point, (res?.point ?? point).clone().addScaledVector(dir, -1.2))   // short spark streak at the hit
      return true
    }
    return this
  }

  // 0..1 function of the component a weapon instance lives on (1 = no mesh / unknown).
  _health(robotId, inst) {
    if (!inst.weaponMesh || !this._partHealth) return 1
    const h = this._partHealth(robotId, inst.weaponMesh)
    return Number.isFinite(h) ? h : 1
  }

  // The path of one shot from `origin` along `dir` (unit) up to `range`:
  // { targetId, res, point, dist } for the component it really meets, or
  // { targetId: null, point } where it ends (wall / floor / max range). A robot
  // box it only clips is passed through (excluded) and the trace continues.
  traceShot(shooterId, origin, dir, range) {
    const exclude = [shooterId]
    let from = origin.clone(), left = range
    for (let i = 0; i < 4 && left > 0.05; i++) {
      const hit = physicsManager.raycast(from, dir, left, exclude.length > 1 ? exclude : shooterId)
      if (!hit) break
      const P = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
      if (hit.id == null || !this._getActor?.(hit.id)) return { targetId: null, point: P, dist: origin.distanceTo(P) }   // wall / arena
      if (!this._resolveShot) return { targetId: hit.id, res: null, point: P, dist: origin.distanceTo(P) }
      const res = this._resolveShot(hit.id, P, dir)
      if (res) return { targetId: hit.id, res, point: res.point, dist: origin.distanceTo(res.point) }
      // Clipped the box, touched nothing: fly on past this robot.
      exclude.push(hit.id)
      const exit = this._exitPoint ? this._exitPoint(hit.id, P, dir) : P.clone().addScaledVector(dir, 4)
      left -= from.distanceTo(exit)
      from = exit
    }
    const end = origin.clone().addScaledVector(dir, range)
    return { targetId: null, point: end, dist: range }
  }

  _makeInst(def, weaponMesh = null) {
    const inst = {
      def, weaponMesh, ammo: def.magSize, cooldown: 0, reloading: false, reloadEndsAt: 0, recoilGrow: 0, flameMesh: null,
      forwardLocal: null, muzzleLocal: null,
      // Mount swivel (mouse aim): current yaw/pitch (rad), the local rotation they
      // make, and whether the last goal had to be clamped to the arc.
      aimYaw: 0, aimPitch: 0, aimQ: new THREE.Quaternion(), outOfArc: false, upLocal: null, sideLocal: null,
    }
    if (weaponMesh) this._measureMuzzle(inst)
    return inst
  }

  // ── Mouse aim ───────────────────────────────────────────────────────────────
  // point: THREE.Vector3 world aim point, or null (weapons return to rest).
  setAimTarget(robotId, point) { this._aimTargets[robotId] = point ? point.clone() : null }
  aimTargetOf(robotId) { return this._aimTargets?.[robotId] || null }

  // The mounted weapon instance driving `mesh` (CombatManager applies its aimQ).
  instForMesh(mesh) {
    for (const slots of Object.values(this._weapons)) for (const i of slots.all) if (i.weaponMesh === mesh) return i
    return null
  }

  // Turn one weapon toward the robot's aim target, within its def.aim arc and
  // at its swivel speed. Works in the weapon's REST frame (its live pose with the
  // current swivel removed), so the arc is always relative to how it's mounted.
  _stepAim(robotId, inst, dt) {
    const lim = inst.def.aim
    if (!lim || !inst.weaponMesh || !inst.forwardLocal || !inst.upLocal) return
    const health = this._health(robotId, inst)          // a damaged mount swivels slower
    const target = this._aimTargets?.[robotId] || null
    let goalYaw = 0, goalPitch = 0
    inst.outOfArc = false
    if (target) {
      const mesh = inst.weaponMesh
      mesh.updateWorldMatrix(true, false)
      const pivot = mesh.getWorldPosition(new THREE.Vector3())
      const restQ = mesh.getWorldQuaternion(new THREE.Quaternion()).multiply(inst.aimQ.clone().invert())
      const aimAt = target.clone()
      // Shells drop under gravity: aim high by the drop over the flight time.
      if (inst.def.strategy === 'shell' && inst.def.gravity) {
        const t = pivot.distanceTo(target) / (inst.def.projectileSpeed || 150)
        aimAt.y += 0.5 * inst.def.gravity * t * t
      }
      const d = aimAt.sub(pivot)
      if (d.lengthSq() > 1e-6) {
        d.applyQuaternion(restQ.invert())            // into the weapon's rest frame
        const f = d.dot(inst.forwardLocal), sd = d.dot(inst.sideLocal), u = d.dot(inst.upLocal)
        const wantYaw = Math.atan2(-sd, f), wantPitch = Math.atan2(u, Math.hypot(f, sd))
        goalYaw = THREE.MathUtils.clamp(wantYaw, -lim.yawDeg * DEG, lim.yawDeg * DEG)
        goalPitch = THREE.MathUtils.clamp(wantPitch, -lim.downDeg * DEG, lim.upDeg * DEG)
        inst.outOfArc = Math.abs(wantYaw - goalYaw) > DEG || Math.abs(wantPitch - goalPitch) > DEG
      }
    }
    const step = (cur, goal, rateDps) => { const m = rateDps * DEG * dt; return cur + THREE.MathUtils.clamp(goal - cur, -m, m) }
    const k = Math.max(0.25, health)
    inst.aimYaw = step(inst.aimYaw, goalYaw, lim.traverseDps * k)
    inst.aimPitch = step(inst.aimPitch, goalPitch, lim.elevateDps * k)
    // Local swivel: pitch about the side axis (+ = barrel up), then yaw about up.
    inst.aimQ.setFromAxisAngle(inst.upLocal, inst.aimYaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(inst.sideLocal, inst.aimPitch))
  }

  // Barrel axis + muzzle point in the weapon's OWN local frame, from the model.
  _measureMuzzle(inst) {
    const mesh = inst.weaponMesh, def = inst.def
    const spec = mountSpecFor(mesh.userData?.type || def.model)
    const forward = (spec?.forward || FWD).clone()
    let muzzle
    if (def.muzzle && Number.isFinite(def.muzzle.x)) {
      muzzle = new THREE.Vector3(def.muzzle.x, def.muzzle.y, def.muzzle.z)
    } else {
      // Local bounds of the model (child geometry boxes brought into the weapon's
      // frame) → the face at the forward end, centred laterally.
      mesh.updateWorldMatrix(true, true)
      const inv = mesh.matrixWorld.clone().invert()
      const box = new THREE.Box3(), c = new THREE.Vector3(), m = new THREE.Matrix4()
      mesh.traverse(o => {
        if (!o.isMesh || !o.geometry || o.userData?.isCombatDecal) return
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        const bb = o.geometry.boundingBox; if (!bb || bb.isEmpty()) return
        m.multiplyMatrices(inv, o.matrixWorld)
        for (let i = 0; i < 8; i++) { c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m); box.expandByPoint(c) }
      })
      if (box.isEmpty()) muzzle = forward.clone().multiplyScalar(0.6)
      else {
        const centre = box.getCenter(new THREE.Vector3())
        const ext = new THREE.Vector3(forward.x >= 0 ? box.max.x : box.min.x, forward.y >= 0 ? box.max.y : box.min.y, forward.z >= 0 ? box.max.z : box.min.z)
        const reach = Math.abs(ext.clone().sub(centre).dot(forward))      // half-length along the barrel
        muzzle = centre.addScaledVector(forward, reach + 0.05)
      }
    }
    inst.forwardLocal = forward
    inst.muzzleLocal = muzzle
    // Swivel axes in the weapon's own frame: its mount-up and the side axis
    // (forward × up) — pitching about it turns the barrel toward up.
    const up = spec?.up ? spec.up.clone() : new THREE.Vector3(...(AXES[def.mount?.up] || [0, 1, 0]))
    inst.upLocal = up.normalize()
    inst.sideLocal = new THREE.Vector3().crossVectors(forward, inst.upLocal).normalize()
  }

  // Equip a robot with EVERY weapon part mounted on it — one runtime instance
  // per part (own ammo / cooldown / reload / recoil / flame cone / muzzle). The
  // two attack buttons each drive a GROUP:
  //   LMB (primary)   → every mounted weapon except the one on RMB
  //   RMB (secondary) → the shortest-range mounted weapon when there are two or
  //                     more, else the built-in Melee Strike
  // So one weapon = LMB + melee; two = LMB/RMB (as before); three or more = the
  // extras join LMB instead of sitting inert. `primary` / `secondary` stay the
  // heads of the groups for the AI, HUD and crosshair.
  //   weapons: [{ key, mesh }] in any order (duplicates of a type are fine).
  equip(robotId, weapons = []) {
    const all = []
    for (const w of weapons) {
      const def = w?.key ? getWeapon(w.key) : null
      if (!def) continue
      if (w.mesh && all.some(i => i.weaponMesh === w.mesh)) continue   // never register one part twice
      all.push(this._makeInst(def, w.mesh || null))
    }
    const slots = { all, primaries: [], secondary: null, primary: null }
    this._weapons[robotId] = slots
    this._regroup(slots)
    console.log('[Combat] armed', robotId, '→', all.length ? all.map(i => `${i.def.name}${i.weaponMesh ? ' @' + String(i.weaponMesh.userData?.id || '').slice(0, 8) : ''}`).join(', ') : 'no weapon',
      '· LMB:', slots.primaries.map(i => i.def.name).join(' + ') || 'none', '· RMB:', slots.secondary?.def.name || 'none')
  }

  // Split `slots.all` into the LMB group + the RMB weapon (rule above). Keeps
  // live instances — regrouping after a loss never resets ammo or cooldowns.
  _regroup(slots) {
    const ranged = [...slots.all].sort((a, b) => (b.def.range || 0) - (a.def.range || 0))
    if (ranged.length >= 2) {
      slots.secondary = ranged[ranged.length - 1]
      slots.primaries = ranged.slice(0, -1)
    } else {
      slots.primaries = ranged
      if (!slots.secondary || slots.secondary.weaponMesh) slots.secondary = this._makeInst(getWeapon('melee'))
    }
    slots.primary = slots.primaries[0] || null
  }

  weaponsFor(id) { return this._weapons[id] || null }

  // A weapon part was physically torn off its robot (RobotDamageView): that
  // instance is gone for real; the others keep their state and are regrouped
  // (a lost RMB weapon falls back to melee; a lost LMB weapon leaves the group).
  dropWeapon(robotId, mesh) {
    const slots = this._weapons[robotId]
    if (!slots || !mesh) return false
    const i = slots.all.findIndex(inst => inst.weaponMesh === mesh)
    if (i < 0) return false
    const inst = slots.all[i]
    if (inst.flameMesh) inst.flameMesh.visible = false
    slots.all.splice(i, 1)
    if (slots.secondary === inst) slots.secondary = null
    this._regroup(slots)
    console.log('[Combat] weapon lost', robotId, '→', inst.def.name, '· LMB now:', slots.primaries.map(x => x.def.name).join(' + ') || 'none', '· RMB:', slots.secondary?.def.name || 'none')
    return true
  }

  // ── Per-frame ───────────────────────────────────────────────────────────────
  step(dt, now, fireInputs) {
    for (const [id, slots] of Object.entries(this._weapons)) {
      const robot = this._getRobot(id)
      const actor = this._getActor(id)
      if (!robot || !actor || actor.state === 'destroyed') {
        for (const inst of slots.all) if (inst.flameMesh) inst.flameMesh.visible = false
        if (slots.secondary?.flameMesh) slots.secondary.flameMesh.visible = false
        continue
      }
      // fireInputs[id] may be a boolean (legacy = primary) or { primary, secondary }.
      const fi = fireInputs[id]
      const wantPrimary = typeof fi === 'boolean' ? fi : !!fi?.primary
      const wantSecondary = typeof fi === 'boolean' ? false : !!fi?.secondary
      for (const inst of slots.all) this._stepAim(id, inst, dt)
      for (const inst of slots.primaries) this._stepSlot(id, robot, actor, inst, wantPrimary, dt, now)
      if (slots.secondary) this._stepSlot(id, robot, actor, slots.secondary, wantSecondary, dt, now)

      // Mirror weapon state to the HUD (the LMB group's head is the headline,
      // with the group size; the RMB weapon shown small).
      const p = slots.primary, s = slots.secondary
      useCombatStore.getState().patchActor(id, {
        weaponName: p ? (slots.primaries.length > 1 ? `${p.def.name} +${slots.primaries.length - 1}` : p.def.name) : null,
        ammo: p ? Math.ceil(p.ammo) : 0, magSize: p?.def.magSize ?? 0, reloading: !!p?.reloading,
        secondaryName: s?.def.name ?? null, secondaryReady: s ? (!s.reloading && s.cooldown <= 0) : false,
      })
    }
  }

  _stepSlot(id, robot, actor, inst, wantFire, dt, now) {
    if (inst.reloading) { if (now >= inst.reloadEndsAt) { inst.reloading = false; inst.ammo = inst.def.magSize } }
    inst.cooldown = Math.max(0, inst.cooldown - dt)
    inst.recoilGrow = Math.max(0, inst.recoilGrow - dt * 6)
    const health = this._health(id, inst)
    const firing = wantFire && health > 0 && !inst.reloading && inst.cooldown <= 0 && inst.ammo > 0 && !actor.overheated
    if (firing) this._fire(robot, actor, inst, now)
    else if (inst.flameMesh) inst.flameMesh.visible = false
  }

  // The exact ray a slot fires along. Mounted weapon: its muzzle + barrel axis
  // through its live world transform. No mesh (melee): the robot's facing from
  // the chassis nose. Shared by _fire and the HUD crosshair, so what the player
  // sees is what the shot does.
  aimRay(robot, inst, body = physicsManager.getBody(robot.bodyId)) {
    if (!body) return null
    const def = inst.def
    if (inst.weaponMesh && inst.forwardLocal && inst.muzzleLocal) {
      const mesh = inst.weaponMesh
      mesh.updateWorldMatrix(true, false)
      const forward = inst.forwardLocal.clone().applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion())).normalize()
      const muzzle = mesh.localToWorld(inst.muzzleLocal.clone())
      return { muzzle, forward, range: def.range, def }
    }
    const P = body.translation()
    const rot = body.rotation()
    const Q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
    const forward = FWD.clone().applyQuaternion(Q)   // robot facing
    const muzzle = new THREE.Vector3(P.x, P.y, P.z)
      .addScaledVector(forward, (robot.radius || 1) + 0.4)
      .addScaledVector(UP, def.muzzleY || 1.2)
    return { muzzle, forward, range: def.range, def }
  }

  // Yaw of a robot's LMB weapon relative to the robot's facing (0 when the gun
  // points down the nose). The AI steers so the gun, not the nose, bears on you.
  weaponYawOffset(robotId) {
    const slots = this._weapons[robotId]
    const inst = slots?.primary
    if (!inst?.weaponMesh || !inst.forwardLocal) return 0
    const robot = this._getRobot?.(robotId)
    const body = robot ? physicsManager.getBody(robot.bodyId) : null
    if (!body) return 0
    const r = body.rotation()
    const heading = Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y))
    const f = inst.forwardLocal.clone().applyQuaternion(inst.weaponMesh.getWorldQuaternion(new THREE.Quaternion()))
    if (f.x * f.x + f.z * f.z < 1e-6) return 0
    const d = Math.atan2(f.x, f.z) - heading
    return Math.atan2(Math.sin(d), Math.cos(d))
  }

  _fire(robot, actor, inst, now) {
    const def = inst.def
    const body = physicsManager.getBody(robot.bodyId)
    if (!body) return
    const { muzzle, forward } = this.aimRay(robot, inst, body)
    const mass = body.mass() || 1

    if (!this._firedOnce) { this._firedOnce = true; console.log('[Combat] first shot fired:', def.name) }
    if (this._onFire) this._onFire(robot.id, def, inst.weaponMesh)
    this._muzzleFlash(muzzle)
    if (def.strategy === 'ray')          this._fireRay(robot, actor, inst, muzzle, forward, now)
    else if (def.strategy === 'shell')   this._fireShell(robot, inst, muzzle, forward)
    else if (def.strategy === 'rocket')  this._fireRocket(robot, inst, muzzle, forward)
    else if (def.strategy === 'flame')   this._fireFlame(robot, actor, inst, muzzle, forward, now)

    // Recoil (self impulse), heat, self-status, ammo, cadence.
    if (def.recoil) physicsManager.applyImpulse(robot.id, { x: -forward.x * def.recoil * mass, y: 0, z: -forward.z * def.recoil * mass })
    actor.heat = Math.min(actor.heatMax, actor.heat + def.heatPerShot)
    for (const s of def.selfStatus || []) statusEffectSystem.add(actor, s, now)
    inst.ammo -= 1
    // A damaged weapon cycles slower (down to half rate when wrecked).
    inst.cooldown = 1 / (def.fireRateHz * (0.5 + 0.5 * this._health(robot.id, inst)))
    if (inst.ammo <= 0) { inst.reloading = true; inst.reloadEndsAt = now + def.reloadMs }
  }

  _fireRay(robot, actor, inst, muzzle, forward, now) {
    const def = inst.def
    const pellets = def.pellets || 1
    const wobble = (1 - this._health(robot.id, inst)) * 8      // a damaged barrel sprays
    for (let k = 0; k < pellets; k++) {
      const dir = perturb(forward, def.spreadDeg + inst.recoilGrow + wobble)
      const tr = this.traceShot(robot.id, muzzle, dir, def.range)
      if (tr.targetId) this._hitTarget(robot, tr.targetId, def, dir, now, tr.point, tr.res)
      this._tracer(muzzle, tr.point)
    }
    inst.recoilGrow = Math.min(6, inst.recoilGrow + 0.9)   // progressive recoil
  }

  // A physical round from the muzzle along the (aimed) barrel; damage only if
  // ProjectileManager's sweep actually meets a robot (onShellHit above).
  _fireShell(robot, inst, muzzle, forward) {
    const dir = perturb(forward, inst.def.spreadDeg + inst.recoilGrow + (1 - this._health(robot.id, inst)) * 8)
    projectileManager.spawnShell(muzzle, dir, robot.id, inst.def, inst)
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
      const tr = this.traceShot(robot.id, muzzle, dir, def.range)
      if (tr.targetId) this._hitTarget(robot, tr.targetId, def, dir, now, tr.point, tr.res)
    }
    this._flameVFX(inst, muzzle, forward)
  }

  // `point` = where the ray met the target's collision body; with `dir` it lets
  // the host localize the hit on the robot's real geometry (presentation only).
  // `res` = the component the shot met (traceShot / resolveShot) — damage is
  // shaped by the impact: angle of incidence, ricochet for grazing kinetic hits.
  _hitTarget(robot, targetId, def, dir, now, point = null, res = null) {
    const target = this._getActor(targetId)
    if (!target || target.state === 'destroyed') return
    let mul = 1, ricochet = false
    if (res?.normal) {
      const cos = Math.max(0, -(dir.x * res.normal.x + dir.y * res.normal.y + dir.z * res.normal.z))
      if (def.strategy === 'flame') mul = 1                              // fire wraps around
      else if (def.key === 'melee') mul = 0.7 + 0.3 * cos
      else if (cos < RICOCHET_COS) { ricochet = true; mul = RICOCHET_MUL }
      else mul = 0.6 + 0.4 * cos                                         // more armour along a slanted path
    }
    const amounts = {}
    for (const [k, v] of Object.entries(def.damage)) amounts[k] = k === 'heat' ? v : v * mul
    const crit = !ricochet && !!def.crit && target.armor <= 0
    const p = point ? { x: point.x, y: point.y, z: point.z } : null
    damageManager.apply({
      targetId, sourceId: robot.id, damageType: def.strategy === 'flame' ? 'burn' : 'core',
      amounts, crit, critMul: def.critMul,
      weaponKey: def.key, hitPoint: p, hitDir: { x: dir.x, y: dir.y, z: dir.z },
      partId: res?.partId ?? null, hitNormal: res?.normal ? { x: res.normal.x, y: res.normal.y, z: res.normal.z } : null,
      ricochet,
    })
    if (!ricochet) for (const e of def.statusEffects || []) statusEffectSystem.add(target, e, now)
    if (def.knockback) {
      const body = physicsManager.getBody(targetId)
      const mass = body ? body.mass() : 1
      const kb = def.knockback * mul
      physicsManager.applyImpulse(targetId, { x: dir.x * kb * mass, y: 0, z: dir.z * kb * mass })
    }
  }

  // Advance tracer + muzzle-flash VFX.
  stepVFX(dt) {
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i]
      t.life -= dt
      if (t.life <= 0) { t.line.visible = false; this._tracerPool.push(t.line); this._tracers.splice(i, 1) }
      else t.line.material.opacity = Math.max(0, t.life / 0.11)
    }
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i]
      f.t += dt
      const k = f.t / 0.09
      if (k >= 1) { f.mesh.visible = false; this._flashPool.push(f.mesh); this._flashes.splice(i, 1) }
      else { f.mesh.scale.setScalar(1 + k * 1.2); f.mesh.material.opacity = 1 - k }
    }
  }

  _muzzleFlash(pos) {
    let m = this._flashPool.pop()
    if (!m) {
      m = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffddaa, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
      )
      m.userData.isArena = true
      this._scene.add(m)
    }
    m.position.copy(pos); m.scale.setScalar(1); m.material.opacity = 1; m.visible = true
    this._flashes.push({ mesh: m, t: 0 })
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
    this._tracers.push({ line, life: 0.11 })
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
    for (const slots of Object.values(this._weapons)) {
      // No mounted mesh to remove — the weapon is a scene object restored by
      // CombatManager. Only the flame VFX cone needs disposal (per slot).
      for (const inst of [...slots.all, slots.secondary]) {
        if (inst?.flameMesh) { inst.flameMesh.geometry.dispose(); inst.flameMesh.material.dispose(); inst.flameMesh.removeFromParent(); inst.flameMesh = null }
      }
    }
    for (const t of this._tracers) t.line.removeFromParent()
    for (const l of this._tracerPool) { l.geometry.dispose(); l.material.dispose(); l.removeFromParent() }
    for (const f of this._flashes) f.mesh.removeFromParent()
    for (const m of this._flashPool) { m.geometry.dispose(); m.material.dispose(); m.removeFromParent() }
    this._weapons = {}; this._tracers = []; this._tracerPool = []; this._flashes = []; this._flashPool = []
    this._aimTargets = {}
    projectileManager.onShellHit = null
    this._resolveShot = this._exitPoint = this._partHealth = null
    this._firedOnce = false
    this._getRobot = this._getActor = this._onFire = null
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
