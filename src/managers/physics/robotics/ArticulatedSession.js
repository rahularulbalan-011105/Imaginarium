// ArticulatedSession — runs a scene robot on the articulated physics engine for
// one simulation (enter → frames → exit). Owned by DriveManager.
//
//   enter: build physics graph from the scene → Rapier bodies/joints → reparent
//          each link's meshes under a link group whose transform is driven ONLY
//          by its rigid body (interpolated between fixed steps).
//   frame: choose the controller (firmware Servo.write, walk()/arrow-key gait,
//          or standing balance) → runtime.advance(dt) → sync render → debug.
//   exit:  remove bodies, put every mesh back EXACTLY where it was authored.
import * as THREE from 'three'
import { RoboticsRuntime } from './RoboticsRuntime.js'
import { buildGraphFromScene } from './sceneGraph.js'
import { validateGraph } from './PhysicsGraph.js'
import { PhysicsDebugDraw } from './DebugDraw.js'
import { roboticsTelemetry, roboticsHardware } from './telemetry.js'
import { gravityOf } from './config.js'
import { inferForward } from './forwardAxis.js'
import { walkabilityIssue, stuckIssue, idleCodeIssue, fallenIssue, tiltDeg, MotionWatchdog,
  servoLoads, weightIssues, looseIssue, graphWarningIssue, collapsedIssue } from './diagnosis.js'
import { L as SU_TO_M } from './units.js'

const PUBLISH_INTERVAL = 0.1   // s — telemetry snapshots for the UI (10 Hz)

export class ArticulatedSession {
  constructor({ scene, objectMgr, physicsManager, simulation }) {
    this.scene = scene
    this.objectMgr = objectMgr
    this.pm = physicsManager
    this.sim = simulation
    this.runtime = null
    this.robot = null
    this.linkGroups = new Map()
    this._restore = []          // { node, parent, position, quaternion, scale }
    this._pivots = []           // { pivot, rotation }
    this._obstacles = []
    this._publishAcc = 0
    this.debug = null
    this.warnings = []
    this.walk = { ok: true }      // can the gait step this robot? (walkability)
    this.wiring = null            // servo id → { signalPin, powered } (diagnosis.servoWiring)
    this.onIssue = null           // (issue) → void   · reported problems
    this.onResolve = null         // (idPrefix) → void · a reported problem went away
    this._watch = new MotionWatchdog()
    this._codeWas = false
    this._idleT = 0
    this._idleSent = false
    this._directT = 0
    this._lastTargets = 0
  }

  /**
   * @returns true if the robot is now physics-driven; false → caller falls back
   *          to the legacy kinematic path (e.g. no actuated joints, Rapier not ready).
   */
  start({ objects, allObjects, standalone = [], blueprint, attachments, bonds, joints, rootId, robotConfig, worldConfig, debugLayers, viewDir = null, wiring = null, wiringIssues = [], onIssue = null, onResolve = null }) {
    this.wiring = wiring; this.wiringIssues = wiringIssues; this.onIssue = onIssue; this.onResolve = onResolve
    this.failReason = null
    if (!this.pm.ready || !this.pm.R) { this.failReason = 'the physics engine is not ready'; return false }
    // Authored pose = every servo horn at its neutral (0 rad ⇔ Servo 90°).
    const hosts = new Set(Object.values(attachments ?? {}))
    for (const hid of hosts) {
      const pv = this.objectMgr.getMesh(hid)?.userData?.rotorGroup
      if (pv) { this._pivots.push({ pivot: pv, rotation: pv.rotation.clone() }); pv.rotation.set(0, 0, 0) }
    }
    for (const o of allObjects) this.objectMgr.getMesh(o.id)?.updateMatrixWorld(true)

    const { graph, linkNodes, warnings, loose = [] } = buildGraphFromScene({
      objects, allObjects, objectMgr: this.objectMgr, attachments, bonds, joints, robotConfig, rootId, id: 'robot',
    })
    this.warnings = warnings

    // Face the way the robot is BUILT unless the author chose a Forward axis
    // (forwardAxis.js): the default −Z sent a robot built facing ±X stepping
    // sideways against its own hinges until it fell.
    if (!allObjects.some(o => o.physics?.robot?.forward)) {
      const acts = new Set(graph.actuators.map(a => a.jointId))
      const hinges = graph.joints.filter(j => acts.has(j.id) && j.type === 'revolute')
      if (hinges.length) {
        const center = { x: 0, z: 0 }
        for (const j of hinges) { center.x += j.anchor.x / hinges.length; center.z += j.anchor.z / hinges.length }
        const standaloneIds = new Set(standalone.map(o => o.id))
        const eyes = []
        const p = new THREE.Vector3()
        for (const o of allObjects) {
          if ((o.type !== 'ultrasonic' && o.type !== 'ir_sensor') || standaloneIds.has(o.id)) continue
          const m = this.objectMgr.getMesh(o.id)
          if (m) { m.getWorldPosition(p); eyes.push({ x: p.x, z: p.z }) }
        }
        const f = inferForward(hinges, center, eyes, viewDir)
        if (f) graph.forward = f
      }
    }

    const errs = validateGraph(graph)
    if (errs.length || graph.actuators.length === 0) {
      if (errs.length) console.warn('[Articulated] graph rejected:', errs)
      this.failReason = errs.length ? errs.join('; ') : 'no servo-driven joints found'
      this._restorePivots()
      return false
    }

    // Telemetry is sampled for the UI (5–10 Hz by device profile), never per step.
    this._publishInterval = worldConfig.telemetryHz ? 1 / worldConfig.telemetryHz : PUBLISH_INTERVAL
    const R = this.pm.R, world = this.pm.world, ground = this.pm.groundCollider
    this._groundSaved = ground ? { friction: ground.friction(), restitution: ground.restitution() } : null
    this.runtime = new RoboticsRuntime({
      R, world, groundCollider: ground,
      config: { timestep: worldConfig.timestep, solverIterations: worldConfig.solverIterations, gravity: gravityOf(worldConfig) },
    })
    this.runtime.setTerrain(worldConfig.terrain)
    try {
      this.robot = this.runtime.addRobot(graph, { blueprint })
    } catch (e) {
      console.error('[Articulated] build failed:', e)
      this.failReason = String(e?.message ?? e)
      this.runtime.dispose(); this.runtime = null
      this._restoreGround(); this._restorePivots()
      return false
    }

    // Legs that cannot lift a foot (one hip servo per leg) or a biped that
    // can't lean over one foot can't be stepped by the gait. STRICT physics:
    // the robot stays on the real engine anyway — walk()/arrows then can't
    // fake a walk, Servo.write() still moves the joints for real, and the user
    // is told why (a CAD issue) instead of being handed a scripted walk.
    this.walk = this.robot.legs.length ? this.robot.walkability() : { ok: true }
    if (!this.walk.ok) {
      console.warn(`[Articulated] ${this.walk.reason} — the gait can't step this robot (strict physics: it won't walk)`)
      this.onIssue?.(walkabilityIssue(this.walk))
    }
    this._buildChecks(graph, allObjects, warnings, loose)

    // Standalone objects are fixed obstacles with their own material.
    for (const o of standalone) {
      const m = this.objectMgr.getMesh(o.id)
      if (!m) continue
      const box = new THREE.Box3().setFromObject(m)
      const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
      this._obstacles.push(this.runtime.addStaticBox(c, h, o.physics?.material ?? 'wood'))
    }

    // Render: one group per link, posed from its body; meshes keep their offset.
    for (const nodes of linkNodes.values()) for (const n of nodes) {
      this._restore.push({ node: n, parent: n.parent, position: n.position.clone(), quaternion: n.quaternion.clone(), scale: n.scale.clone() })
    }
    for (const ls of graph.links) {
      const g = new THREE.Group()
      g.name = `link:${ls.id}`
      g.position.set(ls.origin.x, ls.origin.y, ls.origin.z)
      this.scene.add(g)
      g.updateMatrixWorld(true)
      this.linkGroups.set(ls.id, g)
    }
    for (const [lid, nodes] of linkNodes) {
      const g = this.linkGroups.get(lid)
      for (const n of nodes) { n.updateMatrixWorld(true); g.attach(n) }   // keeps the world transform
    }

    // Firmware Servo.write() now commands actuators — never the meshes.
    this.objectMgr.setServoRouter?.((id, deg) => this.robot?.commandServo(id, deg) ?? false)
    roboticsHardware.attach(this.robot)
    this.debug = new PhysicsDebugDraw(this.scene)
    if (debugLayers) this.debug.setLayers(debugLayers)
    this._p = new THREE.Vector3(); this._q = new THREE.Quaternion()
    console.log(`[Articulated] ${graph.links.length} links, ${graph.joints.length} joints, ${graph.actuators.length} servos, ${this.robot.legs.length} legs` +
      (warnings.length ? ` — ${warnings.join('; ')}` : ''))
    return true
  }

  /**
   * Things that are physically wrong before anything moves (CAD):
   * parts that aren't attached, joints that couldn't be built, and a robot
   * too heavy for its servos (static load check, diagnosis.servoLoads).
   */
  _buildChecks(graph, allObjects, warnings, loose) {
    const byId = new Map(allObjects.map(o => [o.id, o]))
    const nameOf = (id) => byId.get(id)?.name || id
    const r = this.robot
    this.onIssue?.(looseIssue([...new Set(loose)].map(nameOf)))
    this.onIssue?.(graphWarningIssue(warnings))
    let massKg = 0
    for (const Lk of r.links.values()) massKg += Lk.body.mass()
    this.massKg = massKg
    const jointById = new Map(graph.joints.map(j => [j.id, j]))
    const legs = r.legs.map(leg => ({
      foot: r.footWorld(leg),
      joints: leg.jointIds.map((jid, k) => {
        const gj = jointById.get(jid), A = leg.actuatorIds[k] && r.actuators.get(leg.actuatorIds[k])
        return gj && { anchor: gj.anchor, axis: gj.axis, servo: A ? { name: nameOf(A.componentId), maxTorque: A.servo.spec.maxTorque } : null }
      }).filter(Boolean),
    }))
    this.loads = servoLoads({ massKg, legs }, SU_TO_M)
    for (const i of weightIssues(massKg, this.loads)) this.onIssue?.(i)
  }

  get active() { return !!this.robot }

  /** input: { forward, turn } in −1…1 from the drive controls (0 = none). */
  frame(dt, input = {}) {
    const r = this.robot
    if (!r) return
    const sim = this.sim
    const codeOn = !!sim?.isRunning?.()
    if (codeOn !== this._codeWas) this._onCodeToggle(codeOn)

    // Controller selection — who produces the joint targets this frame.
    const codeWalk = codeOn && sim._leggedCmd
    let cmd = null
    if (codeWalk) cmd = { forward: (sim.leggedDrive.speed || 0) / 8, turn: (sim.leggedDrive.turn || 0) / 1.8 }
    else if (input.forward || input.turn) cmd = { forward: input.forward || 0, turn: input.turn || 0 }
    const wantsWalk = !!cmd && (cmd.forward !== 0 || cmd.turn !== 0)
    if (cmd && this.walk.ok) {
      r.setMode('gait')
      r.setCommand({ ...cmd, strafe: 0 })
    } else if (r.directTargets.size) {
      r.setMode('direct')                      // the sketch is driving the servos itself
    } else if (this.walk.ok) {
      r.setMode('gait')                        // stand, with active balance
      r.setCommand({ forward: 0, turn: 0, strafe: 0 })
    } else {
      r.setMode('hold')                        // the gait can't work these legs: servos just hold
    }

    const alpha = this.runtime.advance(dt)
    for (const [lid, g] of this.linkGroups) {
      if (this.runtime.interpolatedPose(r, lid, alpha, this._p, this._q)) {
        g.position.copy(this._p); g.quaternion.copy(this._q)
      }
    }
    this.debug?.update([r], this.debug.layers.colliders ? this.pm.world : null)
    this._diagnose(dt, codeOn, wantsWalk)

    this._publishAcc += dt
    if (this._publishAcc >= this._publishInterval) {
      this._publishAcc = 0
      const t = r.telemetry()
      t.runtime = { ...this.runtime.stats, timestep: this.runtime.config.timestep, time: this.runtime.time }
      t.warnings = this.warnings
      roboticsTelemetry.publish(t)
    }
  }

  /**
   * Strict electronics apply only to a running SKETCH: the drive controls are a
   * stand-in controller, but code reaches a servo only through its wires. A
   * servo with no power or no signal wire goes limp while the sketch runs.
   */
  _onCodeToggle(on) {
    this._codeWas = on
    this._idleT = 0
    this._watch.reset()
    this.onResolve?.('run:'); this.onResolve?.('code:idle'); this._idleSent = false; this._fallSent = false; this._downT = 0; this._collapseSent = false; this._sunkT = 0
    for (const id of this.robot.byComponent.keys()) {
      const w = this.wiring?.get(id)
      this.robot.setServoPowered(id, !on || !w || (w.powered && (w.signalPin != null || w.pca != null)))
    }
    if (on) for (const i of this.wiringIssues ?? []) this.onIssue?.(i)
    else { this.onResolve?.('elec:servo-'); this.robot.directTargets.clear() }   // a stopped sketch no longer commands the servos
  }

  /** Told to move but not moving → say why (diagnosis.js). */
  _diagnose(dt, codeOn, wantsWalk) {
    const r = this.robot
    // Direct (Servo.write) commanding: are the targets still changing?
    let sum = 0
    for (const v of r.directTargets.values()) sum += v
    const changing = r.mode === 'direct' && Math.abs(sum - this._lastTargets) > 1e-4
    this._lastTargets = sum
    this._directT = changing ? 0.6 : Math.max(0, this._directT - dt)   // bridge short delay()s
    const directCmd = r.mode === 'direct' && this._directT > 0

    // A sketch that never commands anything.
    if (codeOn && !this.sim._leggedCmd && !this.sim.actuatorCalls) {
      this._idleT += dt
      if (this._idleT > 3 && !this._idleSent) { this._idleSent = true; this.onIssue?.(idleCodeIssue()) }
    } else if (this._idleSent) { this._idleSent = false; this._idleT = 0; this.onResolve?.('code:idle') }

    // Fallen over? (tipped past 55° with its body on the ground for 0.5 s) —
    // checked on its own: a fall MOVES the body, which the watchdog below
    // would otherwise count as progress.
    const b = r.basePose()
    const tilt = b ? tiltDeg(b.q) : 0

    // Collapsed under its weight? Body sank below 60% of its authored height
    // above the floor while still upright, for 0.5 s. The reference is taken on
    // the FIRST frame: an overloaded robot folds within a fraction of a second.
    // (Floor = the lowest authored foot, never above y = 0, the ground plane.)
    if (b && this._standY == null) {
      let footY = Infinity
      for (const leg of r.legs) footY = Math.min(footY, r.footWorld(leg).y)
      this._groundY = Math.min(Number.isFinite(footY) ? footY : 0, 0)
      this._standY = b.p.y
    }
    if (b && this._standY != null && this._standY - this._groundY > 0.5) {
      const sunk = b.p.y < this._groundY + 0.6 * (this._standY - this._groundY) && tilt < 55
      this._sunkT = sunk ? (this._sunkT ?? 0) + dt : 0
      if (this._sunkT > 0.5 && !this._collapseSent) { this._collapseSent = true; this.onIssue?.(collapsedIssue(this.massKg)) }
    }
    const down = tilt > 55 && r.bodyGroundContact
    this._downT = down ? (this._downT ?? 0) + dt : 0
    if (this._downT > 0.5 && !this._fallSent) { this._fallSent = true; this.onIssue?.(fallenIssue(tilt)) }
    else if (!down && tilt < 30 && this._fallSent) { this._fallSent = false; this.onResolve?.('run:fallen') }
    if (this._fallSent || tilt > 55) { this._watch.reset(); return }

    // A robot whose legs can't step was asked to walk: the CAD issue says why.
    if (wantsWalk && !this.walk.ok) { this._watch.reset(); return }

    let yaw = 0
    if (b) { const q = b.q; yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) }
    let stalled = false, slipping = false
    for (const A of r.actuators.values()) if (A.servo.stalled) { stalled = true; break }
    for (const f of r.feet.values()) if (f.contact && f.slipping) { slipping = true; break }
    const ev = this._watch.update(dt, wantsWalk || directCmd, b && { x: b.p.x, z: b.p.z, yaw }, { stalled, slipping })
    if (ev === 'stuck') {
      this.onIssue?.(stuckIssue(r.telemetry(), {
        mode: directCmd && !wantsWalk ? 'direct' : 'gait', walkable: this.walk.ok,
        stalledFrac: this._watch.stalledFrac, slipFrac: this._watch.slipFrac,
      }))
    } else if (ev === 'moving') this.onResolve?.('run:')
  }

  setDebugLayers(layers) { this.debug?.setLayers(layers) }

  _restorePivots() {
    for (const { pivot, rotation } of this._pivots) pivot.rotation.copy(rotation)
    this._pivots = []
  }

  _restoreGround() {
    const g = this.pm.groundCollider
    if (!g || !this._groundSaved) return
    g.setFriction(this._groundSaved.friction)
    g.setRestitution(this._groundSaved.restitution)
    g.setFrictionCombineRule(this.pm.R.CoefficientCombineRule.Average)
    g.setEnabled(true)
  }

  stop() {
    this.objectMgr.setServoRouter?.(null)
    roboticsHardware.detach()
    roboticsTelemetry.clear()
    if (this.runtime) {
      for (const b of this._obstacles) { try { this.pm.world.removeRigidBody(b) } catch { /* gone */ } }
      this.runtime.dispose()
    }
    this._obstacles = []
    // Put every mesh back under its original parent with its authored local pose.
    for (const { node, parent, position, quaternion, scale } of this._restore) {
      if (parent) parent.add(node)
      node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale)
      node.updateMatrixWorld(true)
    }
    this._restore = []
    for (const g of this.linkGroups.values()) g.removeFromParent()
    this.linkGroups.clear()
    this._restorePivots()
    this._restoreGround()
    this.debug?.dispose(); this.debug = null
    this.runtime = null; this.robot = null
  }
}
