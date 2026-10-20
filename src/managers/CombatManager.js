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
import { arenaCameraManager } from './arena/ArenaCameraManager.js'
import { CombatEffectsManager } from './arena/CombatEffectsManager.js'
import { ArenaAIController } from './arena/ArenaAIController.js'
import { arenaAudio } from './arena/ArenaAudio.js'
import { smoothDampScalar } from './arena/smoothing.js'
import { spawnStockOpponent, spawnOpponentFromProject, removeStockOpponent } from '../combat/stockOpponent.js'
import { expandByRobust } from '../utils/robustBounds.js'
import { robotHeading } from '../combat/robotFront.js'
import { useUiStore } from '../stores/uiStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { driveManager } from './DriveManager.js'
import { simulationManager } from './SimulationManager.js'
import { loadWeaponModel } from '../utils/modelLoader.js'
import { aiScaleFor } from '../combat/robotScale.js'

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
const ACCEL_GAIN = 0.62    // fraction of velocity error corrected per frame (responsive, weighty)
const TURN_RATE  = 5.0     // rad/s target yaw rate at full turn (fallback; per-robot stat overrides)
const TURN_GAIN  = 0.9     // steering responsiveness — how hard we drive toward the target yaw rate
// Forward/reverse speed. Kept IDENTICAL for balanced testing (retreat as fast as advance).
// Both multiply the same maxSpeed; tune REVERSE_SCALE down later for real "backpedal" feel.
const REVERSE_SCALE = 1.0
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
    // Player-vs-AI: the local player owns exactly one robot; the rest are AI.
    this._playerId = null
    this._enemyId = null
    this._mouse = { primary: false, secondary: false }
    this._effects = new CombatEffectsManager()
    this._ai = new ArenaAIController()
    this._config = null        // { ids, difficulty, stock } — what startArena was asked for (rematch)
    this._stockIds = null      // transient stock-opponent part ids (removed on stop)
    this._paused = false
    this._startAt = 0
    this._pausedFor = 0
    this._stats = {}           // id -> { hits, dealt, taken, partsLost }
    // HUD aim state, mutated per frame (the crosshair reads it imperatively —
    // no React state per frame). Screen px of the player's real firing ray.
    this.aim = {
      visible: false, x: 0, y: 0,            // crosshair = the mouse (screen px)
      onTarget: false,                       // the mouse ray is on an enemy robot
      impactVisible: false, ix: 0, iy: 0,    // where the head weapon's REAL barrel ray lands
      willHit: false,                        // …and that ray meets an enemy in range
      outOfArc: false,                       // aim point beyond the weapon's swivel limits
      inRange: false, dist: 0, range: 0, ready: false, reloading: false, weapon: null, blocked: false,
    }
    this.aimPoint = null       // world aim point under the mouse (THREE.Vector3)
    this.aimTargetId = null    // robot id under the mouse, if any
    this._pointer = { x: 0, y: 0, has: false }
    this._raycaster = new THREE.Raycaster()
  }

  get isActive() { return this._active }
  get paused() { return this._paused }
  get config() { return this._config }

  // ── Start a local arena match. Weapons come from the robots themselves (a
  // `weapon_*` part attached to the assembly) — no in-battle picker. ───────────
  // opts.difficulty: 'easy' | 'normal' | 'hard' (AI tier). opts.stock: when the
  // list holds only the player's robot, fight a built-in stock AI opponent.
  startArena(robotIds, opts = {}) {
    let ids = (robotIds || []).filter(Boolean)
    // opts.opponentData: a robot/project JSON (parsed) to fight as the AI —
    // spawned for this match only, like the stock bot (transient parts).
    const fileOpp = opts.opponentData && ids.length === 1 ? opts.opponentData : null
    const stock = !fileOpp && !!opts.stock && ids.length === 1
    if (ids.length < 2 && !stock && !fileOpp) { console.warn('[Combat] need at least 2 robots'); return }
    if (this._active || this._over || useCombatStore.getState().arenaActive) this.stop()   // no re-entry orphans
    // ONE owner of the robot meshes: a running Simulation re-parents every part
    // into its drive group (or gives each part its own free-fall body) and moves
    // them every frame — left running, it and the arena would both drive the same
    // meshes and the robot comes apart. End it through its own exit path first
    // (restores the design pose, removes its bodies / group), then build.
    this._endSimulation()
    this._config = { ids: [...ids], difficulty: opts.difficulty || 'normal', stock, opponentData: fileOpp }
    trackEvent('arena_started', { robots: ids.length + (stock ? 1 : 0), difficulty: this._config.difficulty, stock })
    useCombatStore.getState().sync({ arenaActive: true, status: 'loading', message: '', winnerTeam: null, difficulty: this._config.difficulty, result: null, paused: false, elapsed: 0, notices: [] })
    const token = this._startToken = (this._startToken || 0) + 1
    Promise.resolve()
      .then(() => physicsManager.init())
      .then(async () => {
        if (stock) { const so = await spawnStockOpponent('brawler'); this._stockIds = so.ids; ids = [ids[0], so.rootId] }
        else if (fileOpp) { const so = await spawnOpponentFromProject(fileOpp); this._stockIds = so.ids; ids = [ids[0], so.rootId] }
        // Weapons need their REAL model before muzzles / swivel axes are measured.
        await this._weaponsReady(ids)
      })
      .then(() => {
        if (token !== this._startToken || !useCombatStore.getState().arenaActive) return   // cancelled meanwhile
        this._build(ids)
      })
      .catch((e) => { console.error('[Combat] arena start failed:', e); this.stop() })
  }

  // Resolve once every weapon part on these robots shows its real GLB (or its
  // model is missing for good) — bounded by frames, never a guessed delay.
  async _weaponsReady(ids) {
    const byId = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
    const parts = ids.flatMap(id => assemblyMembers(id)).filter(id => isWeaponType(byId.get(id)?.type))
    await Promise.all([...new Set(parts.map(id => byId.get(id).type))].map(t => loadWeaponModel(t).catch(() => null)))
    const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()))
    for (let i = 0; i < 120; i++) {
      if (parts.every(id => { const m = objectManager.getMesh(id); return !m || m.userData.modelReady })) return
      await nextFrame()
    }
  }

  _endSimulation() {
    if (simulationManager.isRunning?.()) {
      simulationManager.stop()
      useElectronicsStore.getState().stopSimulation?.()
    }
    if (useUiStore.getState().simActive) {
      // Exit now (synchronously) — the App's simActive effect runs after React
      // re-renders, too late for the build that follows. exit() is idempotent,
      // so the effect's own call later is a no-op.
      driveManager.exit((id, updates) => useSceneStore.getState().updateObject(id, updates))
      useUiStore.getState().setSimActive(false)
    }
  }

  // Same robots, same difficulty, fresh everything (damage, loose parts, marks,
  // timers, input). The user's design is restored by stop() first.
  restart() {
    const cfg = this._config
    if (!cfg) return
    this.stop()
    this.startArena(cfg.ids, { difficulty: cfg.difficulty, stock: cfg.stock, opponentData: cfg.opponentData })
  }

  // Esc / HUD pause. Freezes the simulation (no input, AI, weapons, physics),
  // releases held keys so nothing is "stuck" when play resumes.
  togglePause(force) {
    if (!this._active) return
    const next = typeof force === 'boolean' ? force : !this._paused
    if (next === this._paused) return
    this._paused = next
    this._releaseInput()
    if (next) this._setCursorHidden(false)
    if (next) { this._pauseAt = performance.now(); arenaAudio.stopMove() }
    else { this._pausedFor += performance.now() - this._pauseAt; this._last = performance.now() }
    useCombatStore.getState().sync({ paused: next })
  }

  _build(ids) {
    // Drop focus from the launch button so Space/Enter fire weapons instead of
    // re-activating the focused button.
    if (typeof document !== 'undefined' && document.activeElement?.blur) document.activeElement.blur()
    // Capture from the CANONICAL assembly: bonds are the authority for where a
    // bonded part sits (the editor loop re-applies them every frame). A build
    // can run between frames — right after a gizmo drag, or after a simulation
    // exit baked its last pose — so apply them here first, then snapshot.
    objectManager.propagateAllBonds(useRigidStore.getState().getBonds())
    this._saveOrig(ids.flatMap(id => assemblyMembers(id)))
    // The editor's selection/gizmo would sit on a fighting part.
    useSceneStore.getState().clearSelection()
    sceneManager.detachTransform()
    this._buildArena()

    this._robots = []
    this._actors = {}
    const n = ids.length
    // Measure every robot as built (unscaled editor pose), then size the AI
    // opponent(s) to the player's robot — the player is never scaled. One
    // uniform factor per AI, applied once at capture; stop() restores it, so a
    // restart re-measures the original and never compounds.
    const measured = ids.map(id => this._measureRobot(id))
    const pSize = measured[0]?.box.getSize(new THREE.Vector3())
    const scales = ids.map((id, i) => (i === 0 || !measured[i] || !pSize) ? 1 : aiScaleFor(pSize, measured[i].box.getSize(new THREE.Vector3())))
    // Spawn far enough apart for the (scaled) footprints, inside the walls.
    const radius = (i) => { const m = measured[i]; if (!m) return 1.5; const sz = m.box.getSize(new THREE.Vector3()).multiplyScalar(scales[i]); return Math.max(sz.x, sz.z) / 2 }
    const rMax = Math.max(...ids.map((_, i) => radius(i)))
    const spawnR = Math.min(Math.max(SPAWN_X, (n === 2 ? (radius(0) + radius(1)) / 2 : rMax) + 3), Math.max(2, ARENA_HALF - rMax - 1))
    ids.forEach((id, i) => {
      const startX = n === 2 ? (i === 0 ? -spawnR : spawnR)
                             : Math.cos((i / n) * Math.PI * 2) * spawnR
      const startZ = n === 2 ? 0 : Math.sin((i / n) * Math.PI * 2) * spawnR
      const robot = this._captureRobot(id, startX, startZ, scales[i], measured[i])
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
    const ai = this._robots[1]
    if (ai && ai.scale !== 1) console.log(`[Combat] AI "${useSceneStore.getState().objects.find(o => o.id === ai.id)?.name}" scaled ×${ai.scale.toFixed(2)} to match the player's robot`)

    // ── Player vs AI: robot[0] is the LOCAL PLAYER, robot[1] is the AI enemy.
    // (Any extra robots idle until multi-AI; the seam already supports N.)
    this._playerId = this._robots[0].id
    this._enemyId  = this._robots[1].id
    for (const id in this._actors) { this._actors[id]._prevArmor = this._actors[id].armor; this._actors[id]._prevCore = this._actors[id].core }
    this._prevOverheat = {}
    this._lastCamMode = 'default'

    // Route all damage through the single funnel + fan combat FEEDBACK off it.
    damageManager.configure({
      getActor: (id) => this._actors[id],
      onApplied: (id, result, evt) => {
        const a = this._actors[id]
        if (!a) return
        useCombatStore.getState().patchActor(id, { armor: a.armor, core: a.core, heat: a.heat, stability: a.stability, state: a.state })
        // Effects: impact VFX, damage numbers, hit flash, shake.
        const body = physicsManager.getBody(id)
        const pos = new THREE.Vector3()
        if (body) { const t = body.translation(); pos.set(t.x, t.y + 1, t.z) }
        const armorBreak = (a._prevArmor > 0 && a.armor <= 0)
        // Match stats (result screen) — HP that actually came off (overkill
        // past zero doesn't count).
        const dealt = Math.max(0, (a._prevArmor ?? a.armor) - a.armor) + Math.max(0, (a._prevCore ?? a.core) - a.core)
        a._prevArmor = a.armor
        a._prevCore = a.core
        this._effects.onHit(id, pos, result, evt, { armorBreak, isPlayerTarget: id === this._playerId })
        const st = this._stats[id] || (this._stats[id] = { hits: 0, dealt: 0, taken: 0, partsLost: 0 })
        st.taken += dealt
        if (evt?.sourceId && evt.sourceId !== id && this._stats[evt.sourceId]) { this._stats[evt.sourceId].hits++; this._stats[evt.sourceId].dealt += dealt }
        // Hit marker when the PLAYER lands damage on someone else.
        if (evt?.sourceId === this._playerId && id !== this._playerId) {
          useCombatStore.getState().sync({ hitMarkerAt: performance.now() })
        }
        if (result.destroyed) { this._effects.onDestroyed(id); this._checkWin() }
      },
    })

    // Weapons + projectiles + explosions. Primary = built weapon, secondary =
    // second weapon or the built-in melee; onFire drives recoil audio/shake.
    projectileManager.init(sceneManager.scene)
    explosionSystem.configure({
      scene: sceneManager.scene, camera: sceneManager.camera, getRobots: () => this._robots,
      onDetonate: (pos) => this._effects.onExplosion(pos, this._nearPlayer(pos)),
    })
    weaponManager.configure({
      getRobot: (id) => this._robots.find(r => r.id === id),
      getActor: (id) => this._actors[id],
      onFire: (id, def, mesh) => this._effects.onFire(id, def, id === this._playerId, mesh),
      // The robot component model (RobotDamageView via the effects seam) is the
      // one authority for which part a shot meets and how well a part works.
      resolveShot: (id, entry, dir) => this._effects.resolveShot(id, entry, dir),
      exitPoint: (id, entry, dir) => this._effects.exitPoint(id, entry, dir),
      partHealth: (id, mesh) => this._effects.partHealthForMesh(id, mesh),
    })
    for (const r of this._robots) {
      weaponManager.equip(r.id, r.weapons)   // every mounted weapon part
      for (const mv of r.movers) mv.aim = weaponManager.instForMesh(mv.mesh)   // its swivel (aimQ) rides on the mounted pose
    }
    // Mouse-aim raycast set: the arena + every OTHER robot (never your own).
    this._aimMeshes = [this._arena, ...this._robots.filter(r => r.id !== this._playerId).flatMap(r => r.movers.map(mv => mv.mesh))].filter(Boolean)
    this._meshOwner = new Map()
    for (const r of this._robots) for (const mv of r.movers) this._meshOwner.set(mv.mesh, r.id)
    this._ai.configure({ level: this._config?.difficulty || 'normal' })
    this._stats = {}
    for (const id in this._actors) this._stats[id] = { hits: 0, dealt: 0, taken: 0, partsLost: 0 }

    this._hideNonCombatants()
    this._bindKeys()

    // Arena camera (third-person chase) + combat effects — snapshots & restores the
    // shared editor camera itself, so nothing outside arena mode is touched.
    arenaCameraManager.activate({
      camera: sceneManager.camera, orbitControls: sceneManager.orbitControls,
      playerRobot: this._robots[0],
    })
    this._effects.configure({
      scene: sceneManager.scene, camera: sceneManager.camera,
      canvas: sceneManager.renderer?.domElement, shake: arenaCameraManager.shake,
      getRobot: (id) => this._robots.find(r => r.id === id),
      getActor: (id) => this._actors[id], playerId: this._playerId, robots: this._robots,
      onDetach: (robotId, mesh, part) => this._onPartDetached(robotId, mesh, part),
    })
    arenaAudio.resume()

    // Publish initial actor state + player/enemy ids to the HUD.
    const actors = {}
    for (const id in this._actors) actors[id] = makeActorSnapshot(this._actors[id])
    useCombatStore.getState().sync({
      status: 'fighting', actors, message: '',
      playerId: this._playerId, enemyId: this._enemyId, cameraMode: arenaCameraManager.mode,
    })

    this._last = performance.now()
    this._startAt = this._last
    this._pausedFor = 0
    this._paused = false
    this._over = false
    this._active = true
  }


  // A part was physically torn off a robot (RobotDamageView → its own rigid body).
  // It stops riding the chassis, and a lost weapon can no longer fire.
  _onPartDetached(robotId, mesh, part = null) {
    const r = this._robots.find(x => x.id === robotId)
    if (!r) return
    const i = r.movers.findIndex(mv => mv.mesh === mesh)
    if (i >= 0) r.movers.splice(i, 1)
    // The robot no longer carries that part's mass (bounded: the chassis stays).
    if (part?.mass > 0 && r.mass > 0) {
      const m = Math.max((r.mass0 || r.mass) * 0.4, r.mass - part.mass)
      if (physicsManager.setBodyMass(r.bodyId, m)) { r.inertiaY *= m / r.mass; r.mass = m }
    }
    this._aimMeshes = this._aimMeshes?.filter(x => x !== mesh) ?? null
    const wasWeapon = weaponManager.dropWeapon(robotId, mesh)
    if (this._stats[robotId]) this._stats[robotId].partsLost++
    const partObj = useSceneStore.getState().objects.find(o => o.id === mesh?.userData?.id)
    const who = robotId === this._playerId ? 'You' : (this._actors[robotId]?.name || 'Enemy')
    const what = partObj?.name ? partObj.name.replace(/_\d+$/, '').replace(/^Weapon_/, '').replace(/_/g, ' ') : 'a part'
    useCombatStore.getState().notify(`${who} lost ${wasWeapon ? 'the ' : ''}${what}${wasWeapon ? ' — weapon offline' : ''}`)
  }

  // True if a world point is close to the player (for near-explosion shake).
  _nearPlayer(pos) {
    const b = physicsManager.getBody(this._playerId)
    if (!b) return false
    const t = b.translation()
    return Math.hypot(t.x - pos.x, t.z - pos.z) < 16
  }

  _playerRobot() { return this._robots.find(r => r.id === this._playerId) }

  // The assembly as the arena sees it, measured in the robot's own frame: +Z =
  // its declared front (robotFront.js), from the root part's live pose, so the
  // body's drive axis is the robot's nose whatever way it was built or turned
  // in the editor — and the spawn yaw is the only rotation the arena adds.
  // Returns { rootMesh, heading, qEditor, invQ, box, memberMeshes, weapons }.
  _measureRobot(rootId) {
    const rootMesh = objectManager.getMesh(rootId)
    if (!rootMesh) return null
    const heading = robotHeading(rootId)
    const qEditor = heading?.q ?? new THREE.Quaternion()
    const invQ = qEditor.clone().invert()
    const toFrame = new THREE.Matrix4().makeRotationFromQuaternion(invQ)

    // Oriented box of the whole assembly (in the robot frame) → half-extents +
    // centre. Also collect every weapon PART (its mesh is the muzzle origin).
    const byId = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
    const box = new THREE.Box3()
    const memberMeshes = []
    const weapons = []   // every weapon PART on this assembly → { def, mesh }
    for (const mid of assemblyMembers(rootId)) {
      if (objectManager.attachedObjects.has(mid)) continue  // wheel → follows its motor (Three child)
      const m = objectManager.getMesh(mid)
      if (!m) continue
      m.updateMatrixWorld(true)
      expandByRobust(box, m, toFrame)   // visible meshes, stray-vertex-trimmed (GLB outliers / editor helpers ignored)
      memberMeshes.push(m)
      const t = byId.get(mid)?.type
      if (isWeaponType(t)) { const def = weaponForType(t); if (def) weapons.push({ def, mesh: m }) }
    }
    // Every weapon part is handed to WeaponManager, which groups them per button.
    if (memberMeshes.length === 0) { memberMeshes.push(rootMesh); expandByRobust(box, rootMesh, toFrame) }
    if (box.isEmpty()) box.expandByObject(rootMesh).applyMatrix4(toFrame)   // nothing visible: raw fallback
    return { rootMesh, heading, qEditor, invQ, box, memberMeshes, weapons }
  }

  // Capture an assembly as a rigid mover-set + a Rapier dynamic box body.
  // `scale` (AI size normalisation) is one uniform factor about the assembly's
  // centre: every part's offset and mesh scale grow together (proportions,
  // orientation and mass/class stay as designed) and the physics box is built
  // from the scaled size, so collisions match what's drawn.
  _captureRobot(rootId, startX, startZ, scale = 1, measured = null) {
    const m0 = measured || this._measureRobot(rootId)
    if (!m0) return null
    const { heading, qEditor, invQ, box, memberMeshes, weapons } = m0
    const s = scale > 0 ? scale : 1

    const size   = box.getSize(new THREE.Vector3()).multiplyScalar(s)
    const center = box.getCenter(new THREE.Vector3())            // robot frame (unscaled pose)
    const centerWorld = center.clone().applyQuaternion(qEditor)
    const half   = { x: Math.max(0.3, size.x / 2), y: Math.max(0.3, size.y / 2), z: Math.max(0.3, size.z / 2) }

    // Movers: each part's offset + orientation relative to the box centre, in the
    // robot frame (at rest). _applyMesh then places them as body × (off, quat0).
    const movers = memberMeshes.map(m => ({
      mesh: m,
      off:  m.getWorldPosition(new THREE.Vector3()).sub(centerWorld).applyQuaternion(invQ).multiplyScalar(s),
      quat0: invQ.clone().multiply(m.getWorldQuaternion(new THREE.Quaternion())),
      scale0: m.scale.clone().multiplyScalar(s),
      aim: null,
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

    const robot = {
      id: rootId, bodyId, movers, stats, front: heading?.front ?? '+z',
      // Yaw moment of inertia of the body's box (m·(w²+l²)/12): steering must
      // be scaled by THIS, not by mass — a 6×12 su robot is ~15× harder to spin
      // than its mass alone suggests, and floor friction + angular damping ate
      // mass-scaled turns entirely.
      inertiaY: body.mass() * ((2 * half.x) ** 2 + (2 * half.z) ** 2) / 12,
      weapons: weapons.map(w => ({ key: w.def.key, mesh: w.mesh })),
      radius: Math.max(size.x, size.z) / 2, mass: body.mass(), mass0: body.mass(), scale: s,
      size: { x: size.x, y: size.y, z: size.z },
    }
    this._applyMesh(robot, body)
    return robot
  }

  // ── Per-frame simulation ────────────────────────────────────────────────────
  step() {
    if (!this._active) { if (this._over) this._stepAftermath(); return }
    const now = performance.now()
    if (this._paused) { this._last = now; return }
    let dt = (now - this._last) / 1000
    this._last = now
    if (dt <= 0) return
    if (dt > 0.05) dt = 0.05
    const elapsed = Math.floor((now - this._startAt - this._pausedFor) / 1000)
    if (elapsed !== useCombatStore.getState().elapsed) useCombatStore.getState().sync({ elapsed })

    // 1. Compute this frame's input per robot: the player robot from WASD + mouse,
    // the enemy from the AI controller, any extras idle. Then drive.
    const fireInputs = {}
    this._robots.forEach((r) => {
      const a = this._actors[r.id]
      if (a.state === 'destroyed') { fireInputs[r.id] = { primary: false, secondary: false }; return }
      const body = physicsManager.getBody(r.bodyId)
      if (!body) return
      let input
      if (r.id === this._playerId) input = this._readPlayerInput()
      else if (r.id === this._enemyId) input = this._ai.update(dt, r, a, this._playerRobot(), now, weaponManager.weaponsFor(r.id))
      else input = { fwd: 0, turn: 0 }
      this._drive(body, r, input)
      fireInputs[r.id] = { primary: !!input.primary, secondary: !!input.secondary }
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
      const wasOverheated = this._prevOverheat[r.id]
      stabilitySystem.tick(a, r.stats, dt, now)
      heatSystem.tick(a, dt)
      statusEffectSystem.tick(a, now, dt, (id, amt) =>
        damageManager.apply({ targetId: id, damageType: 'burn', amounts: { core: amt } }))
      if (!wasOverheated && a.overheated) this._effects.onOverheat()   // overheat warning sting
      this._prevOverheat[r.id] = a.overheated
      useCombatStore.getState().patchActor(r.id, {
        heat: a.heat, stability: a.stability, staggered: a.staggered, overheated: a.overheated,
      })
    }

    // 2b'. AI weapons: ELEVATION only — each AI gun keeps its mounted heading
    // (its accuracy still comes from how the AI steers, as before) but pitches
    // toward the player's centre, so level-mounted guns still meet a shorter or
    // taller robot now that only real component hits count.
    this._aiElevation()

    // 2c. Weapons: fire (raycast damage / spawn rockets), advance rockets +
    // explosions, and tracer/flame VFX. fireInputs was computed in step 1.
    weaponManager.step(dt, now, fireInputs)
    projectileManager.step(dt)
    explosionSystem.step(dt)
    weaponManager.stepVFX(dt)

    // 3. Read bodies back → update chassis lean/sway/suspension, then place meshes.
    for (const r of this._robots) {
      const body = physicsManager.getBody(r.bodyId)
      if (body) { this._updateLean(r, body, dt); this._applyMesh(r, body) }
    }

    // 4. Arena camera (chase the player), combat VFX/damage-numbers, movement audio.
    arenaCameraManager.update(dt)
    this._effects.step(dt)
    if (arenaCameraManager.mode !== this._lastCamMode) {
      this._lastCamMode = arenaCameraManager.mode
      useCombatStore.getState().sync({ cameraMode: arenaCameraManager.mode })
    }
    const pb = physicsManager.getBody(this._playerId)
    if (pb) { const v = pb.linvel(); arenaAudio.move(Math.min(1, Math.hypot(v.x, v.z) / 14)) }
    this._updateAim()

    this._checkWin()
  }

  // Mouse aim, every frame:
  //  1. the crosshair is the mouse; a ray from THIS frame's camera through it
  //     finds the intended aim point — the first arena surface or OTHER robot
  //     part it meets (your own robot is never a target), else the floor plane,
  //     else a far point along the ray;
  //  2. that point is handed to WeaponManager, which swivels each weapon toward
  //     it within its arc/speed (the shot still leaves the real muzzle along the
  //     real barrel);
  //  3. the head weapon's ACTUAL barrel ray is resolved by the same physics
  //     raycast a shot uses and projected for the HUD's impact pip — so the HUD
  //     shows both where you aim and where the gun will really hit.
  _updateAim() {
    const aim = this.aim
    const r = this._playerRobot(), a = this._actors[this._playerId]
    const cam = sceneManager.camera, canvas = sceneManager.renderer?.domElement
    if (!r || !a || !cam || !canvas || a.state === 'destroyed') { aim.visible = false; aim.impactVisible = false; this._setCursorHidden(false); return }
    const rect = canvas.getBoundingClientRect()
    // The chase camera moved this frame; ray-cast / project with THIS frame's view.
    cam.updateMatrixWorld(true)
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()

    // 1. Pointer → camera ray → aim point. Mouse aiming starts the first time the
    // pointer enters the 3D view in this match — until then nothing swivels
    // (the weapons sit exactly as mounted) and the crosshair shows where the
    // barrel points, as before. While the pointer is outside the 3D view (HUD,
    // side panel) the last aim is kept.
    const ptr = this._pointer
    const inside = ptr.has && ptr.x >= rect.left && ptr.x <= rect.right && ptr.y >= rect.top && ptr.y <= rect.bottom
    if (inside) this._aiming = true
    if (this._aiming && inside) {
      const ndc = new THREE.Vector2(((ptr.x - rect.left) / rect.width) * 2 - 1, -((ptr.y - rect.top) / rect.height) * 2 + 1)
      this._raycaster.setFromCamera(ndc, cam)
      const ray = this._raycaster.ray
      let point = null, targetId = null
      const hits = this._aimMeshes ? this._raycaster.intersectObjects(this._aimMeshes, true) : []
      for (const h of hits) {
        if (!h.object.visible || h.object.userData?.isCombatDecal) continue
        point = h.point.clone()
        for (let n = h.object; n; n = n.parent) { const id = this._meshOwner?.get(n); if (id) { targetId = id; break } }
        break
      }
      if (!point && ray.direction.y < -1e-3) point = ray.origin.clone().addScaledVector(ray.direction, -ray.origin.y / ray.direction.y)   // floor plane
      if (!point) point = ray.origin.clone().addScaledVector(ray.direction, 120)                                                         // open sky
      this.aimPoint = point
      this.aimTargetId = targetId && targetId !== this._playerId && this._actors[targetId]?.state !== 'destroyed' ? targetId : null
      aim.x = ptr.x; aim.y = ptr.y
    }
    weaponManager.setAimTarget(this._playerId, this._aiming ? this.aimPoint : null)
    this._setCursorHidden(!this._paused && inside)

    // 2. Where the head weapon will REALLY hit (its live barrel ray).
    const slots = weaponManager.weaponsFor(this._playerId)
    const inst = slots?.primary || slots?.secondary
    const bray = inst ? weaponManager.aimRay(r, inst) : null
    if (!bray) { aim.visible = false; aim.impactVisible = false; aim.weapon = null; return }
    // Same trace a shot makes (robot box → real component; boxes it only clips
    // are passed through), so the pip is where the round would really land.
    const tr = weaponManager.traceShot(this._playerId, bray.muzzle, bray.forward, Math.max(bray.range, 60))
    const hit = tr.dist < Math.max(bray.range, 60) - 1e-3 || tr.targetId ? tr : null
    const dist = hit ? tr.dist : Infinity
    const hitActor = tr.targetId && tr.targetId !== this._playerId ? tr.targetId : null
    const ip = tr.point.clone()
    ip.project(cam)
    const ipVisible = ip.z < 1 && Math.abs(ip.x) < 1.2 && Math.abs(ip.y) < 1.2
    aim.ix = rect.left + (ip.x + 1) / 2 * rect.width
    aim.iy = rect.top + (1 - ip.y) / 2 * rect.height
    aim.willHit = !!hitActor && dist <= bray.range
    aim.outOfArc = this._aiming && !!inst.outOfArc
    aim.blocked = !!hit && !hitActor
    aim.range = bray.range
    aim.reloading = !!inst.reloading
    aim.ready = !inst.reloading && inst.cooldown <= 0 && inst.ammo > 0 && !a.overheated
    aim.weapon = inst.def.key
    if (this._aiming) {
      // Crosshair = the mouse; pip = the gun's real impact.
      const aimDist = bray.muzzle.distanceTo(this.aimPoint)
      aim.visible = true
      aim.impactVisible = ipVisible
      aim.onTarget = !!this.aimTargetId
      aim.inRange = aimDist <= bray.range
      aim.dist = aimDist
    } else {
      // Not aiming yet: the crosshair sits on the barrel's impact point.
      aim.visible = ipVisible
      aim.impactVisible = false
      aim.x = aim.ix; aim.y = aim.iy
      aim.onTarget = !!hitActor
      aim.inRange = !!hitActor && dist <= bray.range
      aim.dist = Number.isFinite(dist) ? dist : bray.range
    }
  }

  // Over the 3D view the OS cursor is replaced by the crosshair.
  _setCursorHidden(hide) {
    const c = sceneManager.renderer?.domElement
    if (!c) return
    const want = hide ? 'none' : ''
    if (c.style.cursor !== want) c.style.cursor = want
  }

  _aiElevation() {
    const e = this._robots.find(r => r.id === this._enemyId), p = physicsManager.getBody(this._playerId)
    if (!e || !p) return
    const inst = weaponManager.weaponsFor(e.id)?.primary
    const ray = inst ? weaponManager.aimRay(e, inst) : null
    if (!ray) return
    const t = p.translation()
    const h = new THREE.Vector3(ray.forward.x, 0, ray.forward.z)
    if (h.lengthSq() < 1e-6) return
    h.normalize()
    const dist = Math.hypot(t.x - ray.muzzle.x, t.z - ray.muzzle.z)
    weaponManager.setAimTarget(e.id, ray.muzzle.clone().addScaledVector(h, dist).setY(t.y))
  }

  // The match is decided (combat is frozen: no input, weapons, damage or AI), but
  // the world keeps moving so the destruction plays out: robots coast to a stop,
  // loose parts fall and settle, smoke/sparks/camera keep running.
  _stepAftermath() {
    const now = performance.now()
    let dt = (now - this._last) / 1000
    this._last = now
    if (dt <= 0) return
    if (dt > 0.05) dt = 0.05
    if (!this._aftermath) {
      this._aftermath = true
      projectileManager.clear()                                  // rockets still in flight can't change the result
      for (const r of this._robots) {
        const w = weaponManager.weaponsFor(r.id)
        for (const inst of [...(w?.all || []), w?.secondary]) if (inst?.flameMesh) inst.flameMesh.visible = false
      }
      arenaAudio.stopMove()
    }
    physicsManager.step(dt)
    physicsManager.drainContactEvents(() => {})
    for (const r of this._robots) {
      const body = physicsManager.getBody(r.bodyId)
      if (body) { this._updateLean(r, body, dt); this._applyMesh(r, body) }
    }
    weaponManager.stepVFX(dt)
    explosionSystem.step(dt)
    arenaCameraManager.update(dt)
    this._effects.step(dt)
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
    // Drivetrain from the robot's real drive units (component model): damaged /
    // lost units cut speed and turning, and a dead side drags the robot toward
    // it. A design with no drive components keeps the plain movement model.
    const ds = this._effects.driveState(r.id)
    const driveMul = ds.units ? (ds.left + ds.right) / 2 : 1
    const pull = ds.units ? ds.right - ds.left : 0          // + → the left side is weaker → veers left
    const maxSpeed = (r.stats?.maxSpeed ?? MAX_SPEED) * moveMult * driveMul
    const accel    = r.stats?.accelGain ?? ACCEL_GAIN
    const baseTurn = (r.stats?.turnRate ?? TURN_RATE) * auth.turn
    const turn     = baseTurn * driveMul
    // One working side still pushes, brakes and steers; authority fades only as
    // the drivetrain drops below half, reaching zero when nothing drives.
    const authority = Math.min(1, 2 * driveMul)

    // Linear: impulse toward desired forward velocity (leaves Y to gravity, keeps
    // knockback because we only correct a fraction of the error each frame).
    // Forward and reverse use the SAME speed (REVERSE_SCALE = 1.0) for balanced testing.
    const dirSpeed = maxSpeed * (input.fwd < 0 ? REVERSE_SCALE : 1)
    const desX = fwd.x * input.fwd * dirSpeed
    const desZ = fwd.z * input.fwd * dirSpeed
    // Drive authority = what the drivetrain can still do: lost wheels can neither
    // push nor brake, so a robot with no working drive just coasts under physics
    // (a blast or a ram still shoves it). Intact robots: driveMul = 1, unchanged.
    physicsManager.applyImpulse(r.bodyId, {
      x: (desX - v.x) * mass * accel * authority,
      y: 0,
      z: (desZ - v.z) * mass * accel * authority,
    })

    // Angular: torque impulse toward a target yaw rate, scaled by the body's
    // yaw inertia so every robot size reaches its turn rate (A = left / anti-
    // clockwise seen from above, D = right / clockwise).
    const w = body.angvel().y
    const targetW = -input.turn * turn + input.fwd * pull * baseTurn * 0.45
    const inertia = r.inertiaY || mass
    physicsManager.applyTorqueImpulse(r.bodyId, { x: 0, y: (targetW - w) * inertia * TURN_GAIN * authority, z: 0 })
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
    // Contact direction + the point on each robot facing the other (for the host's
    // localized impact presentation; does not affect the damage).
    const pd = physicsManager.getBody(defender)?.translation(), pg = physicsManager.getBody(aggressor)?.translation()
    let into = null, atDef = null, atAgg = null
    if (pd && pg) {
      const dx = pd.x - pg.x, dz = pd.z - pg.z, len = Math.hypot(dx, dz) || 1
      into = { x: dx / len, y: 0, z: dz / len }
      const rd = this._robots.find(r => r.id === defender)?.radius || 1.5, rg = this._robots.find(r => r.id === aggressor)?.radius || 1.5
      atDef = { x: pd.x - into.x * rd, y: pd.y, z: pd.z - into.z * rd }
      atAgg = { x: pg.x + into.x * rg, y: pg.y, z: pg.z + into.z * rg }
    }
    damageManager.apply({
      targetId: defender, sourceId: aggressor, damageType: 'collision',
      amounts: { armor: dmg, stability: Math.round(dmg * 0.6), heat: Math.round(dmg * 0.5) },
      hitPoint: atDef, hitDir: into,
    })
    damageManager.apply({
      targetId: aggressor, sourceId: defender, damageType: 'collision',
      amounts: { armor: Math.round(dmg * 0.3), stability: Math.round(dmg * 0.3), heat: Math.round(dmg * 0.35) },
      hitPoint: atAgg, hitDir: into ? { x: -into.x, y: 0, z: -into.z } : null,
    })
  }

  _checkWin() {
    const alive = this._robots.filter(r => this._actors[r.id]?.state !== 'destroyed')
    if (alive.length <= 1 && this._robots.length >= 2) {
      const winner = alive[0]
      const name = winner ? this._actors[winner.id]?.name : null
      const elapsed = Math.floor((performance.now() - this._startAt - this._pausedFor) / 1000)
      const outcome = !winner ? 'draw' : winner.id === this._playerId ? 'victory' : 'defeat'
      const stats = {}
      for (const id in this._stats) stats[id] = { ...this._stats[id], dealt: Math.round(this._stats[id].dealt), taken: Math.round(this._stats[id].taken), name: this._actors[id]?.name }
      useCombatStore.getState().sync({
        status: 'over',
        winnerTeam: winner ? this._actors[winner.id]?.team : null,
        message: '',
        result: { outcome, winnerId: winner?.id ?? null, winnerName: name, elapsed, stats, playerId: this._playerId, enemyId: this._enemyId },
      })
      trackEvent('arena_over', { outcome, elapsed })
      this._releaseInput()
      this.aim.visible = false; this.aim.impactVisible = false
      this._setCursorHidden(false)
      this._active = false   // combat frozen; UI shows the result
      this._over = true      // …but the aftermath (physics + effects) keeps playing
    }
  }

  // Compute a subtle VISUAL-ONLY chassis lean from motion: acceleration lean
  // (nose dips accelerating, rocks back braking), turn/lateral weight-shift (bank
  // into turns), and a gentle suspension bob while moving. Never touches physics
  // (the body stays yaw-locked upright) or weapon aim — purely how the robot reads.
  _updateLean(r, body, dt) {
    const rot = body.rotation()
    this._q.set(rot.x, rot.y, rot.z, rot.w)
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this._q)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this._q)
    const v = body.linvel()
    const w = body.angvel().y
    if (!r._prevVel) r._prevVel = new THREE.Vector3(v.x, v.y, v.z)
    const ax = (v.x - r._prevVel.x) / dt, az = (v.z - r._prevVel.z) / dt
    r._prevVel.set(v.x, v.y, v.z)
    const fwdAccel = ax * fwd.x + az * fwd.z          // + accelerating, − braking
    const latAccel = ax * right.x + az * right.z      // sideways shove
    const speed = Math.hypot(v.x, v.z)
    // Angle limits shrink for big robots so the nose / sides never dip more than
    // ~0.15 su (the lean pivots on the body centre; 0.08 rad on a 12 su-long
    // robot would sink its nose ~0.5 su into the floor).
    const halfL = Math.max(0.5, (r.size?.z ?? 2) / 2), halfW = Math.max(0.5, (r.size?.x ?? 2) / 2)
    const maxPitch = Math.min(0.08, 0.15 / halfL), maxRoll = Math.min(0.10, 0.15 / halfW)
    const targetPitch = THREE.MathUtils.clamp(-fwdAccel * 0.010, -maxPitch, maxPitch)
    const targetRoll  = THREE.MathUtils.clamp(w * 0.045 + latAccel * 0.005, -maxRoll, maxRoll)
    r._bobT = (r._bobT || 0) + dt * (7 + speed * 0.5)
    const targetBob = Math.sin(r._bobT) * 0.05 * Math.min(1, speed / 10)
    if (!r._lean) { r._lean = { pitch: 0, roll: 0, bob: 0 }; r._leanState = { pitch: { v: 0 }, roll: { v: 0 }, bob: { v: 0 } } }
    r._lean.pitch = smoothDampScalar(r._lean.pitch, targetPitch, r._leanState.pitch, 0.12, dt)
    r._lean.roll  = smoothDampScalar(r._lean.roll,  targetRoll,  r._leanState.roll,  0.12, dt)
    r._lean.bob   = smoothDampScalar(r._lean.bob,   targetBob,   r._leanState.bob,   0.05, dt)
  }

  // Rigidly place every captured part from the body's pose (+ subtle visual lean/bob).
  _applyMesh(r, body) {
    const P = body.translation()
    const rot = body.rotation()
    this._q.set(rot.x, rot.y, rot.z, rot.w)
    const lean = r._lean
    let q = this._q, bob = 0
    if (lean && (lean.pitch || lean.roll || lean.bob)) {
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean.pitch, 0, lean.roll, 'XYZ'))
      q = this._q.clone().multiply(tilt)
      bob = lean.bob
    }
    for (const mv of r.movers) {
      const p = mv.off.clone().applyQuaternion(q)
      mv.mesh.position.set(P.x + p.x, P.y + bob + p.y, P.z + p.z)
      mv.mesh.quaternion.copy(q).multiply(mv.quat0)
      if (mv.aim) mv.mesh.quaternion.multiply(mv.aim.aimQ)   // mouse-aim swivel on the mount
      // Scale every frame too: an editor store sync (e.g. the selection clear at
      // match start) re-applies design transforms to all meshes.
      if (mv.scale0) mv.mesh.scale.copy(mv.scale0)
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  // The player drives with WASD (movement only — mouse never rotates the robot)
  // and attacks with the mouse: LMB = primary weapon, RMB = secondary. Camera-mode
  // hotkeys (F1–F4) + free-orbit look are owned by ArenaCameraManager.
  _bindKeys() {
    const ctrl = useGameStore.getState().controls
    this._activeKeys = new Set()
    ;['up', 'down', 'left', 'right'].forEach(act => this._activeKeys.add(ctrl.p1[act]))
    this._keys.clear()
    this._mouse.primary = this._mouse.secondary = false
    this._onKeyDown = (e) => {
      if (e.key === 'Escape') { if (this._active && !e.repeat) { e.preventDefault(); this.togglePause() } return }
      if (this._paused) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (this._activeKeys.has(k)) { this._keys.add(k); e.preventDefault() }
    }
    this._onKeyUp = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this._keys.delete(k)
    }
    // Mouse attacks. Ignore clicks that land on HUD buttons (e.g. Exit).
    this._onMouseDown = (e) => {
      if (this._paused || e.target?.closest?.('button, select, input, a, [data-hud-ui]')) return
      if (e.button === 0) this._mouse.primary = true
      else if (e.button === 2) this._mouse.secondary = true
    }
    // Focus loss (alt-tab, tab switch, devtools) → nothing stays held down.
    this._onBlur = () => this._releaseInput()
    this._onVis = () => { if (document.hidden) this._releaseInput() }
    this._onMouseUp = (e) => {
      if (e.button === 0) this._mouse.primary = false
      else if (e.button === 2) this._mouse.secondary = false
    }
    this._onContext = (e) => e.preventDefault()   // RMB is the secondary attack, not a menu
    // Mouse aim: the crosshair IS the pointer (visible-cursor model — the mouse
    // never steers the robot or the chase camera; F3 orbit reads movementX/Y).
    this._pointer.has = false
    this._aiming = false
    this._onPointerMove = (e) => { this._pointer.x = e.clientX; this._pointer.y = e.clientY; this._pointer.has = true }
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mouseup', this._onMouseUp)
    window.addEventListener('contextmenu', this._onContext)
    window.addEventListener('blur', this._onBlur)
    document.addEventListener('visibilitychange', this._onVis)
  }

  _releaseInput() {
    this._keys.clear()
    this._mouse.primary = this._mouse.secondary = false
  }

  _readPlayerInput() {
    const c = useGameStore.getState().controls.p1
    const has = (k) => this._keys.has(k)
    return {
      fwd:  (has(c.up) ? 1 : 0) - (has(c.down) ? 1 : 0),
      turn: (has(c.right) ? 1 : 0) - (has(c.left) ? 1 : 0),
      primary: this._mouse.primary,
      secondary: this._mouse.secondary,
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
      // A part riding a motor shaft (wheel) is a Three child of the rotor and is
      // never moved by the arena (it follows its motor) — and its store position
      // is WORLD while its mesh transform is ROTOR-LOCAL, so it must not be
      // "restored" from the store either.
      if (objectManager.attachedObjects.has(id)) continue
      const o = useSceneStore.getState().objects.find(x => x.id === id)
      const mesh = objectManager.getMesh(id)
      if (!o) continue
      if (mesh && mesh.parent === sceneManager.scene) {
        // Mesh pose = the canonical (bond-propagated) pose; the store can lag it
        // by a frame (e.g. a simulation exit baked its last pose there).
        this._orig[id] = { position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z }, scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z } }
      } else this._orig[id] = { position: { ...o.position }, rotation: { ...o.rotation }, scale: o.scale ? { ...o.scale } : null }
    }
  }

  // ── Teardown ────────────────────────────────────────────────────────────────
  stop() {
    this._active = false
    this._over = false
    this._aftermath = false
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('mousedown', this._onMouseDown)
    window.removeEventListener('mouseup', this._onMouseUp)
    window.removeEventListener('contextmenu', this._onContext)
    window.removeEventListener('blur', this._onBlur)
    document.removeEventListener('visibilitychange', this._onVis)
    window.removeEventListener('pointermove', this._onPointerMove)
    this._onPointerMove = null
    this._setCursorHidden(false)
    this._aimMeshes = null; this._meshOwner = null
    this.aimPoint = null; this.aimTargetId = null
    this._releaseInput()
    this._paused = false
    this.aim.visible = false; this.aim.impactVisible = false
    // Restore the shared camera + tear down arena camera/effects/audio.
    arenaCameraManager.stop()
    this._effects.clear()
    arenaAudio.clear()
    weaponManager.clear()
    projectileManager.clear()
    explosionSystem.clear()
    for (const r of this._robots) physicsManager.removeBody(r.bodyId)
    this._clearArena()
    if (this._hidden) { this._hidden.forEach(m => { m.visible = true }); this._hidden = null }
    // Restore original transforms.
    for (const [id, t] of Object.entries(this._orig)) {
      const mesh = objectManager.getMesh(id)
      if (mesh) {
        mesh.position.set(t.position.x, t.position.y, t.position.z); mesh.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z)
        if (t.scale) mesh.scale.set(t.scale.x, t.scale.y, t.scale.z)
      }
      // The arena only ever moves MESHES; the store (the saved design) is never
      // written by a battle — restoring the mesh pose is the whole job.
    }
    this._orig = {}
    this._robots = []
    this._actors = {}
    this._hitClock = {}
    this._stats = {}
    damageManager.reset()
    // The stock opponent only ever existed for this match.
    if (this._stockIds) { removeStockOpponent(this._stockIds); this._stockIds = null }
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
