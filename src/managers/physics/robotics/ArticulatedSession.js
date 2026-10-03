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
  }

  /**
   * @returns true if the robot is now physics-driven; false → caller falls back
   *          to the legacy kinematic path (e.g. no actuated joints, Rapier not ready).
   */
  start({ objects, allObjects, standalone = [], blueprint, attachments, bonds, joints, rootId, robotConfig, worldConfig, debugLayers }) {
    if (!this.pm.ready || !this.pm.R) return false
    // Authored pose = every servo horn at its neutral (0 rad ⇔ Servo 90°).
    const hosts = new Set(Object.values(attachments ?? {}))
    for (const hid of hosts) {
      const pv = this.objectMgr.getMesh(hid)?.userData?.rotorGroup
      if (pv) { this._pivots.push({ pivot: pv, rotation: pv.rotation.clone() }); pv.rotation.set(0, 0, 0) }
    }
    for (const o of allObjects) this.objectMgr.getMesh(o.id)?.updateMatrixWorld(true)

    const { graph, linkNodes, warnings } = buildGraphFromScene({
      objects, allObjects, objectMgr: this.objectMgr, attachments, bonds, joints, robotConfig, rootId, id: 'robot',
    })
    this.warnings = warnings
    const errs = validateGraph(graph)
    if (errs.length || graph.actuators.length === 0) {
      if (errs.length) console.warn('[Articulated] graph rejected — using kinematic path:', errs)
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
      console.error('[Articulated] build failed — using kinematic path:', e)
      this.runtime.dispose(); this.runtime = null
      this._restoreGround(); this._restorePivots()
      return false
    }

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

  get active() { return !!this.robot }

  /** input: { forward, turn } in −1…1 from the drive controls (0 = none). */
  frame(dt, input = {}) {
    const r = this.robot
    if (!r) return
    const sim = this.sim
    // Controller selection — who produces the joint targets this frame.
    const codeWalk = sim?.isRunning?.() && sim._leggedCmd
    if (codeWalk) {
      r.setMode('gait')
      r.setCommand({ forward: (sim.leggedDrive.speed || 0) / 8, turn: (sim.leggedDrive.turn || 0) / 1.8, strafe: 0 })
    } else if (input.forward || input.turn) {
      r.setMode('gait')
      r.setCommand({ forward: input.forward || 0, turn: input.turn || 0, strafe: 0 })
    } else if (r.directTargets.size) {
      r.setMode('direct')                      // the sketch is driving the servos itself
    } else {
      r.setMode('gait')                        // stand, with active balance
      r.setCommand({ forward: 0, turn: 0, strafe: 0 })
    }

    const alpha = this.runtime.advance(dt)
    for (const [lid, g] of this.linkGroups) {
      if (this.runtime.interpolatedPose(r, lid, alpha, this._p, this._q)) {
        g.position.copy(this._p); g.quaternion.copy(this._q)
      }
    }
    this.debug?.update([r], this.debug.layers.colliders ? this.pm.world : null)

    this._publishAcc += dt
    if (this._publishAcc >= this._publishInterval) {
      this._publishAcc = 0
      const t = r.telemetry()
      t.runtime = { ...this.runtime.stats, timestep: this.runtime.config.timestep, time: this.runtime.time }
      t.warnings = this.warnings
      roboticsTelemetry.publish(t)
    }
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
