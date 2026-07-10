import * as THREE from 'three'
import { physicsManager } from './physics/PhysicsManager.js'
import { objectManager } from './ObjectManager.js'
import { sceneManager } from './SceneManager.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useGameStore } from '../stores/gameStore.js'
import { useCombatStore, makeActor } from '../stores/combatStore.js'
import { assemblyMembers } from '../utils/robotAssembly.js'
import { computeRobotStats } from '../combat/CombatStats.js'
import { damageManager } from '../combat/DamageManager.js'
import { stabilitySystem } from '../combat/StabilitySystem.js'
import { heatSystem } from '../combat/HeatSystem.js'
import { statusEffectSystem } from '../combat/StatusEffectSystem.js'
import { weaponManager } from './WeaponManager.js'
import { projectileManager } from '../combat/ProjectileManager.js'
import { explosionSystem } from '../combat/ExplosionSystem.js'
import { weaponForType, isWeaponType } from '../combat/weaponRegistry.js'
import { trackEvent } from '../utils/utmTracking.js'

// ─────────────────────────────────────────────────────────────────────────────
// CombatManager — Stage 1 of the physics-based Arena mode.
//
// Each combatant robot is ONE Rapier DYNAMIC body (a box approximating the whole
// assembly). Movement is velocity-driven via impulses (never teleport), so robots
// physically push and knock each other, and heavy robots shove light ones. Ram
// impacts deal damage through the armor→core layers (combatStore). This is the
// seam every later stage (weapons, damage pipeline, stability, heat, AI, teams,
// objectives, netcode) plugs into — it does NOT touch DriveManager or Sumo.
//
// Runs from App.onAnimationTick when combatStore.arenaActive is true.
// ─────────────────────────────────────────────────────────────────────────────

const UP = new THREE.Vector3(0, 1, 0)

// Tuning (scene units; 1 su = 5 cm). Tweak freely — all combat feel lives here.
const MAX_SPEED  = 16      // su/s top speed
const ACCEL_GAIN = 0.55    // fraction of velocity error corrected per frame
const TURN_RATE  = 3.0     // rad/s target yaw rate at full turn
const TURN_GAIN  = 0.5
const ARENA_HALF = 26      // half-width of the square arena (walls at ±26)
const SPAWN_X    = 12      // robots spawn at ±SPAWN_X

const IMPACT_MIN = 6       // min closing speed (su/s) to deal ram damage
const IMPACT_K   = 1.1     // damage per (su/s) of closing speed above the floor
const HIT_CD     = 0.4     // seconds between ram-damage events per pair

class CombatManager {
  constructor() {
    this._robots = []          // [{ id, name, team, bodyId, movers[], radius, mass }]
    this._actors = {}          // id -> runtime actor (armor/core/heat/stability/state)
    this._orig   = {}          // id -> saved transform (restore on stop)
    this._hidden = null        // meshes hidden during the match
    this._arena  = null        // visual arena group
    this._wallIds = []
    this._hitClock = {}        // pairKey -> next allowed damage time
    this._keys = new Set()
    this._active = false
    this._last = 0
    this._q = new THREE.Quaternion()
  }

  get isActive() { return this._active }

  // ── Start a local arena match. Weapons come from the robots themselves (a
  // `weapon_*` part attached to the assembly) — no in-battle picker. ───────────
  startArena(robotIds) {
    const ids = (robotIds || []).filter(Boolean)
    if (ids.length < 2) { console.warn('[Combat] need at least 2 robots'); return }
    if (this._active || useCombatStore.getState().arenaActive) this.stop()   // no re-entry orphans
    trackEvent('arena_started', { robots: ids.length })
    useCombatStore.getState().sync({ arenaActive: true, status: 'loading', message: '', winnerTeam: null })
    physicsManager.init().then(() => {
      if (!useCombatStore.getState().arenaActive) return   // cancelled meanwhile
      this._build(ids)
    })
  }

  _build(ids) {
    // Drop focus from the launch button so Space/Enter fire weapons instead of
    // re-activating the focused button.
    if (typeof document !== 'undefined' && document.activeElement?.blur) document.activeElement.blur()
    this._saveOrig(ids.flatMap(id => assemblyMembers(id)))
    this._buildArena()

    this._robots = []
    this._actors = {}
    const n = ids.length
    ids.forEach((id, i) => {
      const startX = n === 2 ? (i === 0 ? -SPAWN_X : SPAWN_X)
                             : Math.cos((i / n) * Math.PI * 2) * SPAWN_X
      const startZ = n === 2 ? 0 : Math.sin((i / n) * Math.PI * 2) * SPAWN_X
      const robot = this._captureRobot(id, startX, startZ)
      if (!robot) return
      this._robots.push(robot)
      const name = useSceneStore.getState().objects.find(o => o.id === id)?.name || 'Robot'
      const s = robot.stats
      this._actors[id] = {
        ...makeActor({ id, name, team: i, armorMax: s.armorMax, coreMax: s.coreMax, heatMax: s.heatMax, stabilityMax: s.stabilityMax }),
        class: s.class,
      }
    })

    if (this._robots.length < 2) { this.stop(); return }

    // Route all damage through the single funnel.
    damageManager.configure({
      getActor: (id) => this._actors[id],
      onApplied: (id, result) => {
        const a = this._actors[id]
        if (!a) return
        useCombatStore.getState().patchActor(id, { armor: a.armor, core: a.core, heat: a.heat, stability: a.stability, state: a.state })
        if (result.destroyed) this._checkWin()
      },
    })

    // Weapons + projectiles + explosions. Each robot fires the weapon PART it was
    // built with (detected in _captureRobot); robots with no weapon just ram.
    projectileManager.init(sceneManager.scene)
    explosionSystem.configure({ scene: sceneManager.scene, camera: sceneManager.camera, getRobots: () => this._robots })
    weaponManager.configure({ getRobot: (id) => this._robots.find(r => r.id === id), getActor: (id) => this._actors[id] })
    for (const r of this._robots) if (r.weaponKey) weaponManager.equip(r.id, r.weaponKey, r.weaponMesh)

    this._hideNonCombatants()
    this._bindKeys()

    // Publish initial actor state to the HUD.
    const actors = {}
    for (const id in this._actors) {
      const a = this._actors[id]
      actors[id] = makeActorSnapshot(a)
    }
    useCombatStore.getState().sync({ status: 'fighting', actors, message: '' })

    // Point the camera at the arena (close enough to clearly see robots + weapons).
    if (sceneManager.orbitControls) {
      sceneManager.camera.position.set(0, 18, 26)
      sceneManager.orbitControls.target.set(0, 1, 0)
      sceneManager.orbitControls.update()
    }
    this._last = performance.now()
    this._active = true
  }

  // Capture an assembly as a rigid mover-set + a Rapier dynamic box body.
  _captureRobot(rootId, startX, startZ) {
    const rootMesh = objectManager.getMesh(rootId)
    if (!rootMesh) return null

    // World AABB of the whole assembly → box half-extents + centre. Also detect a
    // weapon PART attached to this robot (its mesh becomes the muzzle origin).
    const byId = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
    const box = new THREE.Box3()
    const memberMeshes = []
    let weaponKey = null, weaponMesh = null
    for (const mid of assemblyMembers(rootId)) {
      if (objectManager.attachedObjects.has(mid)) continue  // wheel → follows its motor (Three child)
      const m = objectManager.getMesh(mid)
      if (!m) continue
      m.updateMatrixWorld(true)
      box.expandByObject(m)
      memberMeshes.push(m)
      const t = byId.get(mid)?.type
      if (!weaponKey && isWeaponType(t)) { const def = weaponForType(t); if (def) { weaponKey = def.key; weaponMesh = m } }
    }
    if (memberMeshes.length === 0) { memberMeshes.push(rootMesh); box.expandByObject(rootMesh) }

    const size   = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const half   = { x: Math.max(0.3, size.x / 2), y: Math.max(0.3, size.y / 2), z: Math.max(0.3, size.z / 2) }

    // Movers: each part's offset + orientation relative to the AABB centre (at rest).
    const movers = memberMeshes.map(m => ({
      mesh: m,
      off:  m.getWorldPosition(new THREE.Vector3()).sub(center),
      quat0: m.getWorldQuaternion(new THREE.Quaternion()),
    }))

    // Class + stat block from real mass (drives HP, mobility, physics mass).
    const stats = computeRobotStats(rootId)

    // Spawn facing the arena centre; rest the box bottom on the ground (y=half.y).
    const yaw = Math.atan2(-startX, -startZ)
    this._q.setFromAxisAngle(UP, yaw)
    // Body id === rootId so contact events / raycasts (which return the physics
    // body id) resolve directly to the actor keyed by rootId. Combat is a separate
    // mode from drive, so there's no id collision.
    const bodyId = rootId
    const body = physicsManager.createCombatBody(
      bodyId,
      { x: startX, y: half.y + 0.05, z: startZ },
      { x: this._q.x, y: this._q.y, z: this._q.z, w: this._q.w },
      half,
      stats.mass,
    )
    if (!body) return null

    const robot = { id: rootId, bodyId, movers, stats, weaponKey, weaponMesh, radius: Math.max(size.x, size.z) / 2, mass: body.mass() }
    this._applyMesh(robot, body)
    return robot
  }

  // ── Per-frame simulation ────────────────────────────────────────────────────
  step() {
    if (!this._active) return
    const now = performance.now()
    let dt = (now - this._last) / 1000
    this._last = now
    if (dt <= 0) return
    if (dt > 0.05) dt = 0.05

    const ctrl = useGameStore.getState().controls
    const inputs = [this._readInput(ctrl.p1), this._readInput(ctrl.p2)]

    // 1. Apply drive impulses to each live robot.
    this._robots.forEach((r, i) => {
      const a = this._actors[r.id]
      if (a.state === 'destroyed') return
      const body = physicsManager.getBody(r.bodyId)
      if (!body) return
      const input = inputs[i] || { fwd: 0, turn: 0 }   // >2 robots idle until AI (later stage)
      this._drive(body, r, input)
    })

    // 2. Step the world ONCE, then resolve ram damage from contact events.
    physicsManager.step(dt)
    physicsManager.drainContactEvents((idA, idB, started) => {
      if (started) this._resolveImpact(idA, idB, now)
    })

    // 2b. Tick per-robot combat systems: stability drain/stagger, heat cooling,
    // status effects — then mirror the live meters/flags to the HUD.
    for (const r of this._robots) {
      const a = this._actors[r.id]
      if (!a) continue
      stabilitySystem.tick(a, r.stats, dt, now)
      heatSystem.tick(a, dt)
      statusEffectSystem.tick(a, now, dt, (id, amt) =>
        damageManager.apply({ targetId: id, damageType: 'burn', amounts: { core: amt } }))
      useCombatStore.getState().patchActor(r.id, {
        heat: a.heat, stability: a.stability, staggered: a.staggered, overheated: a.overheated,
      })
    }

    // 2c. Weapons: fire (raycast damage / spawn rockets), advance rockets +
    // explosions, and tracer/flame VFX.
    const fireInputs = {}
    this._robots.forEach((r, i) => { fireInputs[r.id] = !!inputs[i]?.fire })
    weaponManager.step(dt, now, fireInputs)
    projectileManager.step(dt)
    explosionSystem.step(dt)
    weaponManager.stepVFX(dt)

    // 3. Read bodies back → place assembly meshes rigidly; keep robots in-bounds.
    for (const r of this._robots) {
      const body = physicsManager.getBody(r.bodyId)
      if (body) this._applyMesh(r, body)
    }

    this._checkWin()
  }

  _drive(body, r, input) {
    const rot = body.rotation()
    this._q.set(rot.x, rot.y, rot.z, rot.w)
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this._q)   // local +Z
    const v = body.linvel()
    const mass = r.mass || body.mass() || 1
    // Stagger (stability), overheat (heat) and slows (status) throttle control.
    const actor = this._actors[r.id]
    const auth = stabilitySystem.authority(actor)
    const moveMult = auth.move * heatSystem.moveMult(actor) * statusEffectSystem.moveMult(actor)
    const maxSpeed = (r.stats?.maxSpeed ?? MAX_SPEED) * moveMult
    const accel    = r.stats?.accelGain ?? ACCEL_GAIN
    const turn     = (r.stats?.turnRate ?? TURN_RATE) * auth.turn

    // Linear: impulse toward desired forward velocity (leaves Y to gravity, keeps
    // knockback because we only correct a fraction of the error each frame).
    const desX = fwd.x * input.fwd * maxSpeed
    const desZ = fwd.z * input.fwd * maxSpeed
    physicsManager.applyImpulse(r.bodyId, {
      x: (desX - v.x) * mass * accel,
      y: 0,
      z: (desZ - v.z) * mass * accel,
    })

    // Angular: torque impulse toward a target yaw rate.
    const w = body.angvel().y
    const targetW = -input.turn * turn
    physicsManager.applyTorqueImpulse(r.bodyId, { x: 0, y: (targetW - w) * mass * TURN_GAIN, z: 0 })
  }

  // Turn a ram contact into DamageEvents and route them through the funnel.
  _resolveImpact(idA, idB, now) {
    const a = this._actors[idA], b = this._actors[idB]
    if (!a || !b) return                       // one side is a wall/ground
    if (a.state === 'destroyed' || b.state === 'destroyed') return
    const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`
    if (now < (this._hitClock[key] || 0)) return

    const va = physicsManager.getLinvel(idA), vb = physicsManager.getLinvel(idB)
    if (!va || !vb) return
    const closing = Math.hypot(va.x - vb.x, va.z - vb.z)   // relative speed on XZ
    if (closing < IMPACT_MIN) return
    this._hitClock[key] = now + HIT_CD * 1000

    const dmg = Math.round(IMPACT_K * (closing - IMPACT_MIN))
    if (dmg <= 0) return

    // Faster mover is the aggressor: defender takes full, aggressor takes chip damage.
    // Damage enters as armor-type (funnel spills overflow into core) + some stability.
    const sa = Math.hypot(va.x, va.z), sb = Math.hypot(vb.x, vb.z)
    const defender = sa >= sb ? idB : idA
    const aggressor = defender === idB ? idA : idB
    damageManager.apply({
      targetId: defender, sourceId: aggressor, damageType: 'collision',
      amounts: { armor: dmg, stability: Math.round(dmg * 0.6), heat: Math.round(dmg * 0.5) },
    })
    damageManager.apply({
      targetId: aggressor, sourceId: defender, damageType: 'collision',
      amounts: { armor: Math.round(dmg * 0.3), stability: Math.round(dmg * 0.3), heat: Math.round(dmg * 0.35) },
    })
  }

  _checkWin() {
    const alive = this._robots.filter(r => this._actors[r.id]?.state !== 'destroyed')
    if (alive.length <= 1 && this._robots.length >= 2) {
      const winner = alive[0]
      const name = winner ? this._actors[winner.id]?.name : null
      useCombatStore.getState().sync({
        status: 'over',
        winnerTeam: winner ? this._actors[winner.id]?.team : null,
        message: name ? `${name} WINS! 🏆` : 'Draw',
      })
      this._active = false   // freeze sim; UI shows Exit
    }
  }

  // Rigidly place every captured part from the body's pose.
  _applyMesh(r, body) {
    const P = body.translation()
    const rot = body.rotation()
    this._q.set(rot.x, rot.y, rot.z, rot.w)
    for (const mv of r.movers) {
      const p = mv.off.clone().applyQuaternion(this._q)
      mv.mesh.position.set(P.x + p.x, P.y + p.y, P.z + p.z)
      mv.mesh.quaternion.copy(this._q).multiply(mv.quat0)
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  _bindKeys() {
    const ctrl = useGameStore.getState().controls
    this._activeKeys = new Set()
    ;['up', 'down', 'left', 'right'].forEach(act => {
      this._activeKeys.add(ctrl.p1[act]); this._activeKeys.add(ctrl.p2[act])
    })
    this._activeKeys.add(ctrl.p1.fire || ' ')      // P1 fire: Space
    this._activeKeys.add(ctrl.p2.fire || 'Enter')  // P2 fire: Enter
    this._keys.clear()
    this._onKeyDown = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (this._activeKeys.has(k)) { this._keys.add(k); e.preventDefault() }
    }
    this._onKeyUp = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this._keys.delete(k)
    }
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
  }

  _readInput(c) {
    const has = (k) => this._keys.has(k)
    return {
      fwd:  (has(c.up) ? 1 : 0) - (has(c.down) ? 1 : 0),
      turn: (has(c.right) ? 1 : 0) - (has(c.left) ? 1 : 0),
      fire: has(c.fire || ' '),
    }
  }

  // ── Arena visuals + boundary walls ──────────────────────────────────────────
  _buildArena() {
    this._clearArena()
    const g = new THREE.Group()
    g.userData.isArena = true
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o })
    const floor = new THREE.Mesh(new THREE.BoxGeometry(ARENA_HALF * 2, 0.4, ARENA_HALF * 2), mat(0x2b2f38))
    floor.position.y = -0.2; floor.receiveShadow = true; g.add(floor)
    const wallH = 3
    const wallMat = mat(0x3a4048, { emissive: 0x11151a })
    const walls = [
      { x: 0, z: -ARENA_HALF, sx: ARENA_HALF * 2, sz: 0.6 },
      { x: 0, z:  ARENA_HALF, sx: ARENA_HALF * 2, sz: 0.6 },
      { x: -ARENA_HALF, z: 0, sx: 0.6, sz: ARENA_HALF * 2 },
      { x:  ARENA_HALF, z: 0, sx: 0.6, sz: ARENA_HALF * 2 },
    ]
    this._wallIds = []
    walls.forEach((w, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.sx, wallH, w.sz), wallMat)
      m.position.set(w.x, wallH / 2, w.z); g.add(m)
      const wid = `arena_wall_${i}`
      physicsManager.createStaticObstacle(wid, { x: w.x, y: wallH / 2, z: w.z }, { x: w.sx / 2, y: wallH / 2, z: w.sz / 2 })
      this._wallIds.push(wid)
    })
    sceneManager.scene.add(g)
    this._arena = g
  }

  _clearArena() {
    for (const wid of this._wallIds) physicsManager.removeBody(wid)
    this._wallIds = []
    if (!this._arena) return
    this._arena.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose?.() })
    this._arena.removeFromParent()
    this._arena = null
  }

  _hideNonCombatants() {
    const keep = new Set()
    for (const r of this._robots) for (const mv of r.movers) keep.add(mv.mesh)
    const isKept = (m) => { let n = m; while (n) { if (keep.has(n)) return true; n = n.parent } return false }
    this._hidden = []
    for (const m of objectManager.getAllMeshes()) {
      if (m.userData.isArena || isKept(m)) continue
      if (m.visible) { this._hidden.push(m); m.visible = false }
    }
  }

  _saveOrig(ids) {
    this._orig = {}
    for (const id of ids) {
      const o = useSceneStore.getState().objects.find(x => x.id === id)
      if (o) this._orig[id] = { position: { ...o.position }, rotation: { ...o.rotation } }
    }
  }

  // ── Teardown ────────────────────────────────────────────────────────────────
  stop() {
    this._active = false
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    this._keys.clear()
    weaponManager.clear()
    projectileManager.clear()
    explosionSystem.clear()
    for (const r of this._robots) physicsManager.removeBody(r.bodyId)
    this._clearArena()
    if (this._hidden) { this._hidden.forEach(m => { m.visible = true }); this._hidden = null }
    // Restore original transforms.
    for (const [id, t] of Object.entries(this._orig)) {
      const mesh = objectManager.getMesh(id)
      if (mesh) { mesh.position.set(t.position.x, t.position.y, t.position.z); mesh.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z) }
      useSceneStore.getState().updateObject(id, { position: t.position, rotation: t.rotation })
    }
    this._orig = {}
    this._robots = []
    this._actors = {}
    this._hitClock = {}
    damageManager.reset()
    useCombatStore.getState().reset()
  }
}

// HUD-facing snapshot of a runtime actor (drops private _ fields).
function makeActorSnapshot(a) {
  return {
    id: a.id, name: a.name, team: a.team, class: a.class,
    armor: a.armor, armorMax: a.armorMax,
    core: a.core, coreMax: a.coreMax,
    heat: a.heat, heatMax: a.heatMax,
    stability: a.stability, stabilityMax: a.stabilityMax,
    staggered: !!a.staggered, overheated: !!a.overheated,
    state: a.state, effects: [],
  }
}

export const combatManager = new CombatManager()
