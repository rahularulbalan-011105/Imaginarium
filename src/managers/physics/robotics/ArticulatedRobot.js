// ArticulatedRobot — a physics graph instantiated in the shared Rapier world.
//
// Every link is ONE dynamic rigid body (compound colliders, real mass). Joints
// are Rapier impulse joints (limits enforced by the solver). Servos are NOT
// Rapier motors (those have no torque limit in the JS API): each servo computes
// a torque from its model and applies equal-and-opposite torque impulses to the
// child and parent links about the joint axis. Physics then decides what moves.
//
// Per fixed step (driven by RoboticsRuntime):
//   control(h)   sensors(prev) → gait → balance → IK → servo torques   [ModuleHost]
//   <world.step>                                                          [runtime]
//   postStep(h)  contacts → sensors → stability → power/thermal → pose history
import * as THREE from 'three'
import { ServoActuator, servoDegToRad } from './ServoActuator.js'
import { BatteryModel } from './BatteryModel.js'
import { IMUSensor, EncoderSensor } from './sensors.js'
import { KinematicChain } from './kinematics.js'
import { GaitController } from './gait.js'
import { BalanceController } from './balance.js'
import { centerOfMass, analyzeSupport } from './stability.js'
import { applyMaterialToDesc, getMaterial, pairFriction, DEFAULT_FOOT_MATERIAL } from './materials.js'
import { validateGraph, topology, jointPathTo, linkLowestPoint } from './PhysicsGraph.js'
import { L, torqueToSU, forceToN, inertiaToSI } from './units.js'
import { ModuleHost } from '../../../robot/ModuleHost.js'

const SLIP_SPEED_SU = 0.2      // 1 cm/s — stick/slip threshold for foot friction
const MOTOR_OFF_DAMPING = 1e-9 // effectively zero force (see _applyServo)
const FOOT_HEIGHT_FRACTION = 0.3

function twistAngle(qRel, axis) {
  const d = qRel.x * axis.x + qRel.y * axis.y + qRel.z * axis.z
  let a = 2 * Math.atan2(d, qRel.w)
  if (a > Math.PI) a -= 2 * Math.PI
  if (a < -Math.PI) a += 2 * Math.PI
  return a
}

function axisInvInertia(M, a) {
  // SdpMatrix3: upper-triangular m11 m12 m13 m22 m23 m33
  return M.m11 * a.x * a.x + M.m22 * a.y * a.y + M.m33 * a.z * a.z
    + 2 * (M.m12 * a.x * a.y + M.m13 * a.x * a.z + M.m23 * a.y * a.z)
}

export class ArticulatedRobot {
  /**
   * @param opts.R       Rapier module
   * @param opts.world   Rapier World (scene units)
   * @param opts.graph   PhysicsGraphSpec
   * @param opts.slot    collision-group slot 1…15 (links of one robot never self-collide)
   * @param opts.materialOf  (colliderHandle) → material ref for non-robot colliders
   * @param opts.blueprint   capability blueprint (selects ModuleHost modules)
   */
  constructor({ R, world, graph, slot = 1, materialOf = null, blueprint = null }) {
    const errs = validateGraph(graph)
    if (errs.length) throw new Error('[ArticulatedRobot] invalid physics graph: ' + errs.join('; '))
    this.R = R; this.world = world; this.graph = graph
    this.id = graph.id ?? 'robot'
    this.slot = Math.max(1, Math.min(15, slot | 0))
    this.materialOf = materialOf ?? (() => null)
    // Capabilities come from the blueprint; without one they're derived from the
    // graph itself (servo actuators → ServoPhysics etc.), never from geometry.
    this.blueprint = blueprint ?? {
      locomotion: { type: graph.locomotion?.type ?? 'legs' },
      actuators: (graph.actuators ?? []).map(a => ({ role: 'servo', type: a.kind ?? 'servo', componentId: a.componentId })),
      sensors: graph.imu === false ? [] : [{ role: 'imu', type: 'imu' }],
    }

    this.links = new Map()        // linkId → { spec, body, colliders[], material[], prev, curr }
    this.bodyGroundContact = false // a non-foot link is touching something (e.g. fallen)
    this.joints = new Map()       // jointId → { spec, joint, parent, child, axis(Vector3), anchor1, anchor2 }
    this.actuators = new Map()    // actuatorId → { spec, jointId, servo, encoder, componentId }
    this.byComponent = new Map()  // servo object id → actuatorId
    this.legs = []
    this.colliderOwner = new Map() // collider handle → linkId
    this.feet = new Map()          // linkId → foot contact state

    // Control state
    this.mode = 'hold'             // 'hold' | 'direct' | 'gait'
    this.command = { forward: 0, strafe: 0, turn: 0 }
    this.jointTargets = new Map()  // actuatorId → rad (from IK)
    this.directTargets = new Map() // actuatorId → rad (from firmware / Servo.write)

    const fw = graph.forward ?? { x: 0, y: 0, z: -1 }
    const up = new THREE.Vector3(0, 1, 0)
    const forward = new THREE.Vector3(fw.x, fw.y, fw.z)
    forward.addScaledVector(up, -forward.dot(up)).normalize()
    if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1)
    this.axes = { forward, up, right: new THREE.Vector3().crossVectors(forward, up).normalize() }

    this.gravitySI = new THREE.Vector3(0, -9.81, 0)
    this.stability = { com: { x: 0, y: 0, z: 0 }, comBody: { x: 0, y: 0, z: 0 }, comVelocity: { x: 0, y: 0, z: 0 }, mass: 0, hull: [], margin: -Infinity, state: 'unstable', centroid: null }
    this.metrics = { stepCount: 0, time: 0 }
    this.stabilityMargin = graph.stabilityMargin ?? 0.3   // su (1.5 cm)
    this.controllerLoad = graph.controllerLoad_A ?? 0.08  // MCU + logic (A)
    this.battery = new BatteryModel(graph.power ?? {})
    this.extraSolverIterations = graph.extraSolverIterations ?? 16
    this.brownout = false
    this.built = false

    // scratch
    this._q1 = new THREE.Quaternion(); this._q2 = new THREE.Quaternion()
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3()
  }

  // ── Construction ────────────────────────────────────────────────────────────
  build() {
    const { R, world, graph } = this
    const groups = (((1 << this.slot) & 0xffff) << 16) | (0xffff & ~(1 << this.slot))
    this.collisionGroups = groups >>> 0

    for (const ls of graph.links) {
      const o = ls.origin
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(o.x, o.y, o.z)
        .setCanSleep(false)
        .setLinearDamping(0.02)
        .setAngularDamping(0.05)
        // Articulated chains with light links (servo horns, yokes) next to a heavy
        // body are badly conditioned for an iterative solver; extra iterations on
        // THIS robot's bodies only keep the chain stiff without taxing the world.
        .setAdditionalSolverIterations(this.extraSolverIterations)
      const body = world.createRigidBody(desc)
      const colliders = [], materials = []
      for (const cs of ls.colliders) {
        const desc = this._colliderDesc(cs)
        if (!desc) continue
        const matRef = cs.material ?? (ls.isFoot ? DEFAULT_FOOT_MATERIAL : undefined)
        const mat = applyMaterialToDesc(R, desc, matRef)
        const p = cs.offset?.p ?? { x: 0, y: 0, z: 0 }
        desc.setTranslation(p.x, p.y, p.z)
        if (cs.offset?.q) desc.setRotation(cs.offset.q)
        if (cs.mass > 0) desc.setMass(cs.mass)
        else desc.setDensity(mat.density * L * L * L)   // kg/m³ → kg/su³
        desc.setCollisionGroups(this.collisionGroups)
        const col = world.createCollider(desc, body)
        colliders.push(col); materials.push(matRef ?? mat.name)
        this.colliderOwner.set(col.handle, ls.id)
      }
      const pos = [o.x, o.y, o.z], rot = [0, 0, 0, 1]
      this.links.set(ls.id, { spec: ls, body, colliders, materials, prev: { p: pos.slice(), q: rot.slice() }, curr: { p: pos.slice(), q: rot.slice() } })
    }

    for (const js of graph.joints ?? []) this._createJoint(js)

    for (const as of graph.actuators ?? []) {
      const j = this.joints.get(as.jointId)
      // The servo's electrical travel (spec.minAngle/maxAngle, default ±90°) is
      // independent of the mechanism's hard stops (joint.limits): commanded past a
      // stop, a servo pushes into it and stalls — exactly as a real one does.
      const servo = new ServoActuator({ ...(as.spec ?? {}) }, as.thermal ?? {})
      const encoder = as.encoder === false ? null : new EncoderSensor({ seed: 11 + this.actuators.size, ...(as.encoder ?? {}) })
      this.actuators.set(as.id, { spec: as, jointId: as.jointId, servo, encoder, componentId: as.componentId })
      if (j) { j.actuatorId = as.id; this._addArmature(j, servo.spec.rotorInertia) }
      if (as.componentId) this.byComponent.set(as.componentId, as.id)
    }

    // IMU on the controller's link (or the base).
    const imuCfg = graph.imu === false ? null : (graph.imu ?? {})
    this.imu = imuCfg ? new IMUSensor(imuCfg.spec ?? {}) : null
    this.imuLinkId = imuCfg?.linkId ?? graph.baseLinkId

    this._discoverLegs()

    // Capability-driven controller pipeline: the blueprint's modules run each step.
    this.host = new ModuleHost()
    this.host.enter(this.blueprint, { robot: this })
    // Joint dynamics (passive damping/friction) and actuators belong to the
    // articulated body itself, independent of its locomotion capability.
    if ((graph.joints ?? []).length && !this.host.hasModule('JointConstraints')) this.host.ensureModule('JointPhysics')
    if (this.actuators.size) this.host.ensureModule('ServoPhysics')
    this.built = true
    return this
  }

  _colliderDesc(cs) {
    const R = this.R
    const e = 0.01
    switch (cs.shape) {
      case 'sphere':   return R.ColliderDesc.ball(Math.max(e, cs.radius))
      case 'capsule':  return R.ColliderDesc.capsule(Math.max(e, cs.halfHeight), Math.max(e, cs.radius))
      case 'cylinder': return R.ColliderDesc.cylinder(Math.max(e, cs.halfHeight), Math.max(e, cs.radius))
      case 'convex': {
        const d = cs.points?.length >= 12 ? R.ColliderDesc.convexHull(Float32Array.from(cs.points)) : null
        if (d) return d
        break
      }
      case 'mesh': {
        // Trimesh on a DYNAMIC body is unreliable in Rapier (no volume, tunnels),
        // so dynamic links use the convex hull of the mesh instead.
        const d = cs.points?.length >= 12 ? R.ColliderDesc.convexHull(Float32Array.from(cs.points)) : null
        if (d) return d
        break
      }
      default: break
    }
    const h = cs.halfExtents ?? { x: 0.5, y: 0.5, z: 0.5 }
    return R.ColliderDesc.cuboid(Math.max(e, h.x), Math.max(e, h.y), Math.max(e, h.z))
  }

  _createJoint(js) {
    const { R, world } = this
    const P = this.links.get(js.parent), C = this.links.get(js.child)
    if (!P || !C) return
    const po = P.spec.origin, co = C.spec.origin
    const a1 = { x: js.anchor.x - po.x, y: js.anchor.y - po.y, z: js.anchor.z - po.z }
    const a2 = { x: js.anchor.x - co.x, y: js.anchor.y - co.y, z: js.anchor.z - co.z }
    const axis = new THREE.Vector3(js.axis?.x ?? 0, js.axis?.y ?? 1, js.axis?.z ?? 0).normalize()
    let data
    switch (js.type) {
      case 'revolute':
      case 'continuous': data = R.JointData.revolute(a1, a2, axis); break
      case 'prismatic':  data = R.JointData.prismatic(a1, a2, axis); break
      case 'ball':       data = R.JointData.spherical(a1, a2); break
      case 'universal': {
        // Two rotational DOF about axis & axis2; lock translation + the twist about axis×axis2.
        const ax2 = new THREE.Vector3(js.axis2?.x ?? 0, js.axis2?.y ?? 0, js.axis2?.z ?? 1)
        const twist = new THREE.Vector3().crossVectors(axis, ax2).normalize()
        data = R.JointData.generic(a1, a2, twist, R.JointAxesMask.LinX | R.JointAxesMask.LinY | R.JointAxesMask.LinZ | R.JointAxesMask.AngX)
        break
      }
      case 'fixed':
      default:           data = R.JointData.fixed(a1, { x: 0, y: 0, z: 0, w: 1 }, a2, { x: 0, y: 0, z: 0, w: 1 }); break
    }
    const joint = world.createImpulseJoint(data, P.body, C.body, true)
    joint.setContactsEnabled(false)
    // Servo spring-dampers are specified in real torque units, not mass-normalised.
    if (joint.configureMotorModel) joint.configureMotorModel(R.MotorModel.ForceBased)
    if (js.limits && (js.type === 'revolute' || js.type === 'prismatic')) joint.setLimits(js.limits.min, js.limits.max)
    this.joints.set(js.id, { spec: js, joint, parent: P, child: C, axis, a1, a2, actuatorId: null, angle: 0, velocity: 0 })
  }

  /**
   * Armature: the gearbox's reflected rotor inertia (J_rotor·N²). In joint space
   * it only resists RELATIVE rotation; Rapier has no joint-space armature, so it
   * is added to the child link's inertia about the joint axis. Approximation:
   * it also slightly resists whole-body rotation about that axis. It is physically
   * real (a geared servo is "heavy" to accelerate) and it makes light links
   * (horns, brackets) well-conditioned for the iterative joint solver.
   */
  _addArmature(J, rotorInertiaSI) {
    if (!(rotorInertiaSI > 0) || J.spec.type === 'prismatic') return
    const body = J.child.body
    const Iax = rotorInertiaSI / (L * L)                      // kg·m² → kg·su²
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), J.axis)
    J.child._armature = (J.child._armature ?? 0) + Iax
    // Principal inertia (Iax, ε, ε) in a frame whose X is the joint axis; zero extra
    // mass so the link's mass and centre of mass are unchanged.
    body.setAdditionalMassProperties(0, body.localCom(), { x: J.child._armature, y: 1e-9, z: 1e-9 },
      { x: q.x, y: q.y, z: q.z, w: q.w }, true)
  }

  /** Legs = actuated chains from the base to a leaf link whose lowest point is near the ground. */
  _discoverLegs() {
    const g = this.graph
    const topo = topology(g)
    const base = g.links.find(l => l.id === g.baseLinkId)
    const bo = base.origin
    const leaves = g.links.filter(l => l.id !== g.baseLinkId && (topo.childJoints.get(l.id)?.length ?? 0) === 0)
    let minY = Infinity, maxY = -Infinity
    for (const l of g.links) {
      const lp = linkLowestPoint(l); minY = Math.min(minY, lp.y)
      maxY = Math.max(maxY, l.origin.y)
    }
    const footBand = Math.max(0.5, (maxY - minY) * FOOT_HEIGHT_FRACTION)
    for (const leaf of leaves) {
      const path = jointPathTo(g, leaf.id, topo)
      if (!path || path.length === 0) continue
      const movable = path.filter(j => j.type === 'revolute' || j.type === 'continuous' || j.type === 'prismatic')
      if (movable.length === 0) continue
      const foot = leaf.footPoint ?? linkLowestPoint(leaf)
      const isFoot = leaf.isFoot ?? (foot.y - minY <= footBand)
      if (!isFoot) continue
      const chain = new KinematicChain(movable.map(j => ({
        id: j.id,
        type: j.type === 'prismatic' ? 'prismatic' : 'revolute',
        axis: j.axis,
        point: { x: j.anchor.x - bo.x, y: j.anchor.y - bo.y, z: j.anchor.z - bo.z },
        min: j.limits?.min, max: j.limits?.max,
      })), { x: foot.x - bo.x, y: foot.y - bo.y, z: foot.z - bo.z })
      const actuatorIds = movable.map(j => this.joints.get(j.id)?.actuatorId ?? null)
      const footLocal = { x: foot.x - leaf.origin.x, y: foot.y - leaf.origin.y, z: foot.z - leaf.origin.z }
      this.legs.push({
        id: leaf.id, footLinkId: leaf.id, jointIds: movable.map(j => j.id), actuatorIds, chain,
        neutral: new THREE.Vector3(foot.x - bo.x, foot.y - bo.y, foot.z - bo.z),
        footLocal, lastIK: null, target: null,
      })
      const L_ = this.links.get(leaf.id)
      if (L_) L_.isFoot = true
      this.feet.set(leaf.id, this._emptyContact())
      // Feet default to rubber unless the author chose a material.
      for (let i = 0; i < (L_?.colliders.length ?? 0); i++) {
        if (!leaf.colliders[i]?.material) {
          L_.materials[i] = DEFAULT_FOOT_MATERIAL
          const m = getMaterial(DEFAULT_FOOT_MATERIAL)
          L_.colliders[i].setFriction(m.staticFriction); L_.colliders[i].setRestitution(m.restitution)
        }
      }
    }
    if (this.legs.length) {
      this.gait = new GaitController(this.legs.map(l => l.neutral), this.axes, g.locomotion?.gait ?? {})
      this.balance = new BalanceController(g.locomotion?.balance ?? {})
    }
  }

  _emptyContact() {
    return {
      contact: false, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 },
      force: { x: 0, y: 0, z: 0 }, torque: { x: 0, y: 0, z: 0 }, normalForce: 0, frictionForce: 0,
      slipSpeed: 0, slipping: false, penetration: 0, friction: 0, otherMaterial: null, points: [],
    }
  }

  // ── Measurements ────────────────────────────────────────────────────────────
  /** Measure a joint's angle/velocity from the two bodies (the only source of truth). */
  measureJoint(J) {
    const P = J.parent.body, C = J.child.body
    const qp = P.rotation(), qc = C.rotation()
    this._q1.set(qp.x, qp.y, qp.z, qp.w)
    this._q2.set(qc.x, qc.y, qc.z, qc.w)
    const axisW = this._v3.copy(J.axis).applyQuaternion(this._q1)
    let angle, velocity
    if (J.spec.type === 'prismatic') {
      const tp = P.translation(), tc = C.translation()
      const pa = this._v1.set(J.a1.x, J.a1.y, J.a1.z).applyQuaternion(this._q1).add(tp)
      const ca = this._v2.set(J.a2.x, J.a2.y, J.a2.z).applyQuaternion(this._q2).add(tc)
      angle = ca.sub(pa).dot(axisW)
      const vp = P.linvel(), vc = C.linvel()
      velocity = (vc.x - vp.x) * axisW.x + (vc.y - vp.y) * axisW.y + (vc.z - vp.z) * axisW.z
    } else {
      const rel = this._q1.clone().invert().multiply(this._q2)
      angle = twistAngle(rel, J.axis)
      const wp = P.angvel(), wc = C.angvel()
      velocity = (wc.x - wp.x) * axisW.x + (wc.y - wp.y) * axisW.y + (wc.z - wp.z) * axisW.z
    }
    J.angle = angle; J.velocity = velocity; J.axisWorld = J.axisWorld ?? new THREE.Vector3()
    J.axisWorld.copy(axisW)
    return J
  }

  /** Effective inertia (kg·m²) of the joint DOF from Rapier's world inverse inertias. */
  jointInertiaSI(J) {
    const a = J.axisWorld
    let inv = axisInvInertia(J.child.body.effectiveWorldInvInertia(), a)
    inv += axisInvInertia(J.parent.body.effectiveWorldInvInertia(), a)
    return inv > 1e-12 ? inertiaToSI(1 / inv) : 1e-6
  }

  // ── Control (one fixed step) ────────────────────────────────────────────────
  setCommand(cmd = {}) { Object.assign(this.command, cmd) }
  setMode(mode) { this.mode = mode }

  /** Firmware path: Servo.write(deg) on the servo object `componentId`. */
  commandServo(componentId, deg) {
    const id = this.byComponent.get(componentId)
    if (!id) return false
    this.directTargets.set(id, servoDegToRad(deg))
    return true
  }

  control(h) {
    this.host.step(h, { robot: this })
  }

  // Stage helpers the ModuleHost modules call (kept here so they're testable and
  // shared by every module implementation).
  computeFootTargets(h) {
    if (!this.gait || this.mode !== 'gait') return null
    return this.gait.step(h, this.command)
  }

  applyBalance(targets) {
    if (!targets || !this.balance || !this.imu) return targets
    const s = this.stability
    let comOff = null
    if (s.centroid && s.state !== 'unstable') {
      // (COM − support centroid) horizontal, rotated into the body frame.
      const B = this.links.get(this.graph.baseLinkId).body
      const q = B.rotation()
      this._q1.set(q.x, q.y, q.z, q.w).invert()
      comOff = this._v1.set(s.com.x - s.centroid.x, 0, s.com.z - s.centroid.z).applyQuaternion(this._q1)
      comOff.addScaledVector(this.axes.up, -comOff.dot(this.axes.up))
    }
    return this.balance.apply(targets, this.legs.map(l => l.neutral), this.imu, this.axes, comOff, this.gait?.stance)
  }

  solveIK(targets) {
    if (!targets) return
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]
      // Seed from ENCODERS (what a real controller can read), not internal state.
      const seed = leg.actuatorIds.map((aid, k) => {
        const A = aid && this.actuators.get(aid)
        return A?.encoder ? A.encoder.angle : (this.joints.get(leg.jointIds[k])?.angle ?? 0)
      })
      const res = leg.chain.ik(targets[i], seed, { tolerance: 0.02, maxIterations: 25 })
      leg.lastIK = res
      leg.target = targets[i].clone()
      res.theta.forEach((th, k) => { const aid = leg.actuatorIds[k]; if (aid) this.jointTargets.set(aid, th) })
    }
  }

  driveActuators(h) {
    const V = this.battery.voltage
    const env = { busVoltage: V, supplyScale: this.battery.supplyScale, enabled: !this.battery.brownout }
    for (const [aid, A] of this.actuators) {
      const J = this.joints.get(A.jointId)
      if (!J) continue
      this.measureJoint(J)
      let tgt
      if (this.mode === 'direct' && this.directTargets.has(aid)) tgt = this.directTargets.get(aid)
      else if (this.mode === 'gait' && this.jointTargets.has(aid)) tgt = this.jointTargets.get(aid)
      else if (this.directTargets.has(aid)) tgt = this.directTargets.get(aid)
      if (tgt != null) A.servo.setTarget(tgt)
      A.servo.update(h, J.angle, J.velocity, this.jointInertiaSI(J), env)
      this._applyServo(J, A.servo, h)
    }
  }

  /** Passive (un-actuated) joints: viscous damping + Coulomb friction. */
  passiveJoints(h) {
    for (const J of this.joints.values()) {
      if (J.actuatorId || J.spec.type === 'fixed' || J.spec.type === 'ball') continue
      const c = J.spec.damping ?? 0, f = J.spec.friction ?? 0
      if (c === 0 && f === 0) continue
      this.measureJoint(J)
      const I = J.spec.type === 'prismatic' ? null : this.jointInertiaSI(J)
      let tau = -(c * J.velocity + f * Math.tanh(J.velocity / 0.05))
      if (I) { const lim = I * Math.abs(J.velocity) / h; tau = Math.max(-lim, Math.min(lim, tau)) }
      this._applyJointTorque(J, tau, h)
    }
  }

  /**
   * Hand the servo's torque-limited spring-damper to the joint solver (solved
   * implicitly with the true articulated effective mass), plus gear friction as
   * an explicit torque. Units: N·m/rad → kg·su²/s²/rad.
   */
  _applyServo(J, servo, h) {
    const m = servo.motor
    const prismatic = J.spec.type === 'prismatic'
    const k = prismatic ? m.stiffness / L : torqueToSU(m.stiffness)
    const c = prismatic ? m.damping / L : torqueToSU(m.damping)
    if (m.active) J.joint.configureMotor(m.targetPos, m.targetVel, k, c)
    else if (J._motorOn) {
      // "Off" must NOT be stiffness = damping = 0: Rapier then computes a zero
      // constraint-force-mixing term and the motor becomes a RIGID velocity lock
      // (unlimited force). A vanishing damper is a truly free joint.
      J.joint.configureMotor(m.targetPos, 0, 0, MOTOR_OFF_DAMPING)
    }
    J._motorOn = m.active
    if (servo.friction) this._applyJointTorque(J, -servo.friction, h)
  }

  _applyJointTorque(J, tauSI, h) {
    if (!tauSI) return
    const a = J.axisWorld
    if (J.spec.type === 'prismatic') {
      const f = (tauSI / L) * h            // N → kg·su/s² impulse
      J.child.body.applyImpulse({ x: a.x * f, y: a.y * f, z: a.z * f }, true)
      J.parent.body.applyImpulse({ x: -a.x * f, y: -a.y * f, z: -a.z * f }, true)
      return
    }
    const imp = torqueToSU(tauSI) * h
    J.child.body.applyTorqueImpulse({ x: a.x * imp, y: a.y * imp, z: a.z * imp }, true)
    J.parent.body.applyTorqueImpulse({ x: -a.x * imp, y: -a.y * imp, z: -a.z * imp }, true)
  }

  // ── After world.step ────────────────────────────────────────────────────────
  postStep(h) {
    this.metrics.stepCount++
    this.metrics.time += h
    this._updateContacts(h)
    this._updateSensors(h)
    this._updateStability()
    this._updatePower(h)
    for (const Lk of this.links.values()) {
      const t = Lk.body.translation(), q = Lk.body.rotation()
      const pv = Lk.prev, cu = Lk.curr
      pv.p[0] = cu.p[0]; pv.p[1] = cu.p[1]; pv.p[2] = cu.p[2]
      pv.q[0] = cu.q[0]; pv.q[1] = cu.q[1]; pv.q[2] = cu.q[2]; pv.q[3] = cu.q[3]
      cu.p[0] = t.x; cu.p[1] = t.y; cu.p[2] = t.z
      cu.q[0] = q.x; cu.q[1] = q.y; cu.q[2] = q.z; cu.q[3] = q.w
    }
  }

  _pointVelocity(body, p, out) {
    if (!body || body.isFixed?.()) return out.set(0, 0, 0)
    const v = body.linvel(), w = body.angvel(), c = body.worldCom()
    const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z
    return out.set(v.x + w.y * rz - w.z * ry, v.y + w.z * rx - w.x * rz, v.z + w.x * ry - w.y * rx)
  }

  /**
   * Contacts for every link. Rapier's JS API exposes per-contact NORMAL impulses
   * (accumulated over the TGS substeps, reading (N+1)/N x the true value for N
   * solver iterations -- corrected here exactly) but not friction impulses. So:
   *   - normal force  = corrected normal impulse / h (exact)
   *   - slipping feet = Coulomb friction mu_d * N opposing the slip (exact under Coulomb)
   *   - sticking feet = share of the robot's Newton residual
   *                     F_ext = dP/dt - M g - sum(normal) - sum(slip friction),
   *                     split by normal load, clamped to the friction cone
   * so the per-foot Fx/Fy/Fz are consistent with the robot's momentum change.
   */
  _updateContacts(h) {
    const world = this.world
    const n = this._v1, vrel = this._v2, vo = this._v3
    const N = (world.integrationParameters.numSolverIterations ?? 4) + this.extraSolverIterations
    const impulseScale = N / (N + 1)
    const contacts = this._contacts ?? (this._contacts = [])
    contacts.length = 0
    let groundedBody = false

    for (const [linkId, Lk] of this.links) {
      const isFoot = this.feet.has(linkId)
      let lamSum = 0, nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0, np = 0, pen = 0
      let sx = 0, sy = 0, sz = 0, slipMax = 0, otherMat = null
      const points = []
      for (const col of Lk.colliders) {
        world.contactPairsWith(col, (other) => {
          if (this.colliderOwner.has(other.handle)) return   // own links never collide (groups) -- safety
          world.contactPair(col, other, (m, flipped) => {
            const nc = m.numContacts()
            if (nc === 0) return
            let lam = 0
            for (let i = 0; i < nc; i++) { lam += m.contactImpulse(i); pen = Math.min(pen, m.contactDist(i)) }
            lam *= impulseScale
            const mn = m.normal()
            const sgn = flipped ? 1 : -1        // manifold normal points collider1 -> collider2
            n.set(mn.x * sgn, mn.y * sgn, mn.z * sgn)
            lamSum += lam
            nx += n.x * lam; ny += n.y * lam; nz += n.z * lam
            const otherBody = other.parent?.() ?? other.parent
            const ns = m.numSolverContacts()
            for (let i = 0; i < ns; i++) {
              const sp = m.solverContactPoint(i)
              points.push({ x: sp.x, y: sp.y, z: sp.z })
              px += sp.x; py += sp.y; pz += sp.z; np++
              this._pointVelocity(Lk.body, sp, vrel)
              this._pointVelocity(otherBody, sp, vo)
              vrel.sub(vo)
              vrel.addScaledVector(n, -vrel.dot(n))
              const sl = vrel.length()
              if (sl > slipMax) { slipMax = sl; sx = vrel.x; sy = vrel.y; sz = vrel.z }
            }
            otherMat = this.materialOf(other.handle) ?? otherMat
          })
        })
      }
      if (lamSum <= 0 && np === 0) {
        if (isFoot) this._clearFoot(this.feet.get(linkId))
        continue
      }
      const nl = Math.hypot(nx, ny, nz) || 1
      const c = {
        linkId, isFoot, lam: lamSum,
        nForce: { x: nx / h, y: ny / h, z: nz / h },            // su force units
        normal: { x: nx / nl, y: ny / nl, z: nz / nl },
        point: np ? { x: px / np, y: py / np, z: pz / np } : null, points,
        slip: slipMax, slipDir: { x: sx, y: sy, z: sz }, otherMat, pen,
        friction: { x: 0, y: 0, z: 0 },
      }
      c.slipping = c.slip > SLIP_SPEED_SU
      const mine = Lk.materials[0]
      c.muS = pairFriction(mine, otherMat ?? 'concrete', false)
      c.muD = pairFriction(mine, otherMat ?? 'concrete', true)
      if (c.slipping && slipMax > 0) {
        const f = -c.muD * (lamSum / h) / slipMax
        c.friction.x = sx * f; c.friction.y = sy * f; c.friction.z = sz * f
      }
      if (!isFoot && c.lam > 0) groundedBody = true
      contacts.push(c)
    }

    // Newton residual -> friction of sticking contacts.
    let M = 0, Px = 0, Py = 0, Pz = 0
    for (const Lk of this.links.values()) {
      const m = Lk.body.mass(), v = Lk.body.linvel()
      M += m; Px += m * v.x; Py += m * v.y; Pz += m * v.z
    }
    const g = this.world.gravity
    if (this._Pprev) {
      let rx = (Px - this._Pprev.x) / h - M * g.x
      let ry = (Py - this._Pprev.y) / h - M * g.y
      let rz = (Pz - this._Pprev.z) / h - M * g.z
      let wsum = 0
      for (const c of contacts) {
        rx -= c.nForce.x + c.friction.x; ry -= c.nForce.y + c.friction.y; rz -= c.nForce.z + c.friction.z
        if (!c.slipping) wsum += c.lam
      }
      if (wsum > 0) {
        for (const c of contacts) {
          if (c.slipping) continue
          const w = c.lam / wsum
          let fx = rx * w, fy = ry * w, fz = rz * w
          const d = fx * c.normal.x + fy * c.normal.y + fz * c.normal.z     // tangential part only
          fx -= d * c.normal.x; fy -= d * c.normal.y; fz -= d * c.normal.z
          const fm = Math.hypot(fx, fy, fz), cap = c.muS * c.lam / h
          const k = fm > cap && fm > 0 ? cap / fm : 1
          c.friction.x = fx * k; c.friction.y = fy * k; c.friction.z = fz * k
        }
      }
    }
    this._Pprev = { x: Px, y: Py, z: Pz }
    this.bodyGroundContact = groundedBody

    for (const c of contacts) {
      if (!c.isFoot) continue
      const st = this.feet.get(c.linkId)
      const Lk = this.links.get(c.linkId)
      st.contact = true
      st.points = c.points
      if (c.point) { st.point.x = c.point.x; st.point.y = c.point.y; st.point.z = c.point.z }
      st.normal.x = c.normal.x; st.normal.y = c.normal.y; st.normal.z = c.normal.z
      st.normalForce = forceToN(c.lam / h)
      st.force.x = forceToN(c.nForce.x + c.friction.x)
      st.force.y = forceToN(c.nForce.y + c.friction.y)
      st.force.z = forceToN(c.nForce.z + c.friction.z)
      st.frictionForce = forceToN(Math.hypot(c.friction.x, c.friction.y, c.friction.z))
      // Moment of the contact about the contact centroid (equal share per point).
      let Tx = 0, Ty = 0, Tz = 0
      if (c.points.length > 1) {
        const k = 1 / c.points.length
        for (const p of c.points) {
          const rx = (p.x - st.point.x) * L, ry = (p.y - st.point.y) * L, rz = (p.z - st.point.z) * L
          const fx = st.force.x * k, fy = st.force.y * k, fz = st.force.z * k
          Tx += ry * fz - rz * fy; Ty += rz * fx - rx * fz; Tz += rx * fy - ry * fx
        }
      }
      st.torque.x = Tx; st.torque.y = Ty; st.torque.z = Tz
      st.penetration = -Math.min(0, c.pen) * L
      st.slipSpeed = c.slip * L
      st.slipping = c.slipping
      st.otherMaterial = c.otherMat
      st.friction = c.slipping ? c.muD : c.muS
      // Stick/slip coefficient switching (see materials.js).
      Lk.colliders.forEach((col, i) => {
        const mine = Lk.materials[i]
        const mu = c.slipping ? pairFriction(mine, c.otherMat ?? 'concrete', true) : getMaterial(mine).staticFriction
        if (Math.abs(col.friction() - mu) > 1e-6) col.setFriction(mu)
      })
    }
  }

  _clearFoot(st) {
    st.contact = false; st.normalForce = 0; st.frictionForce = 0; st.slipping = false; st.slipSpeed = 0
    st.force.x = st.force.y = st.force.z = 0; st.torque.x = st.torque.y = st.torque.z = 0; st.points = []
  }

  _updateSensors(h) {
    for (const A of this.actuators.values()) {
      const J = this.joints.get(A.jointId)
      if (!J) continue
      this.measureJoint(J)
      A.encoder?.update(h, J.angle)
    }
    if (this.imu) {
      const B = this.links.get(this.imuLinkId)?.body
      if (B) {
        const q = B.rotation(), v = B.linvel(), w = B.angvel()
        this._q1.set(q.x, q.y, q.z, q.w)
        this.imu.update(h, this._q1, new THREE.Vector3(v.x * L, v.y * L, v.z * L), new THREE.Vector3(w.x, w.y, w.z), this.gravitySI, this.axes)
      }
    }
  }

  _updateStability() {
    const parts = []
    for (const Lk of this.links.values()) {
      const b = Lk.body
      parts.push({ mass: b.mass(), com: b.worldCom(), velocity: b.linvel() })
    }
    const c = centerOfMass(parts)
    const feet = []
    // A foot counts as grounded when it carries a meaningful share of the weight.
    const minLoad = Math.max(1e-3, c.mass * 9.81 * 0.02)
    for (const st of this.feet.values()) if (st.contact && st.normalForce > minLoad) feet.push(st.point)
    const sup = analyzeSupport(c.com, feet, this.stabilityMargin)
    const S = this.stability
    S.com.x = c.com.x; S.com.y = c.com.y; S.com.z = c.com.z
    S.comVelocity.x = c.velocity.x * L; S.comVelocity.y = c.velocity.y * L; S.comVelocity.z = c.velocity.z * L
    S.mass = c.mass
    S.hull = sup.hull; S.margin = sup.margin; S.state = sup.state; S.centroid = sup.centroid
    S.groundedFeet = feet.length
    const B = this.links.get(this.graph.baseLinkId).body
    const bt = B.translation(), bq = B.rotation()
    this._q1.set(bq.x, bq.y, bq.z, bq.w).invert()
    const cb = this._v1.set(c.com.x - bt.x, c.com.y - bt.y, c.com.z - bt.z).applyQuaternion(this._q1)
    S.comBody.x = cb.x; S.comBody.y = cb.y; S.comBody.z = cb.z
  }

  _updatePower(h) {
    let demand = this.controllerLoad
    for (const A of this.actuators.values()) demand += A.servo.current
    this.battery.step(h, demand)
    this.brownout = this.battery.brownout
  }

  // ── Queries ─────────────────────────────────────────────────────────────────
  linkPose(linkId) {
    const Lk = this.links.get(linkId)
    if (!Lk) return null
    const t = Lk.body.translation(), q = Lk.body.rotation()
    return { p: { x: t.x, y: t.y, z: t.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } }
  }

  basePose() { return this.linkPose(this.graph.baseLinkId) }

  /** World-space foot position of each leg (from the physics bodies). */
  footWorld(leg) {
    const Lk = this.links.get(leg.footLinkId)
    const t = Lk.body.translation(), q = Lk.body.rotation()
    return new THREE.Vector3(leg.footLocal.x, leg.footLocal.y, leg.footLocal.z)
      .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(t.x, t.y, t.z))
  }

  telemetry() {
    const acts = []
    let maxJointErr = 0
    for (const [id, A] of this.actuators) {
      const J = this.joints.get(A.jointId)
      const err = Math.abs(A.servo.target - (J?.angle ?? 0))
      maxJointErr = Math.max(maxJointErr, err)
      acts.push({
        id, componentId: A.componentId, angle: J?.angle ?? 0, target: A.servo.target, error: err,
        velocity: J?.velocity ?? 0, torque: A.servo.torque, torqueLimit: A.servo.torqueLimit,
        current: A.servo.current, power: A.servo.power, temperature: A.servo.temperature,
        stalled: A.servo.stalled, overheated: A.servo.overheated, saturated: A.servo.saturated,
        encoder: A.encoder ? A.encoder.angle : null,
      })
    }
    // Foot tracking error: IK target vs forward kinematics of the MEASURED angles.
    let maxFootErr = 0
    for (const leg of this.legs) {
      if (!leg.target) continue
      const th = leg.jointIds.map(jid => this.joints.get(jid)?.angle ?? 0)
      const fk = leg.chain.fk(th)
      maxFootErr = Math.max(maxFootErr, fk.distanceTo(leg.target))
    }
    const b = this.basePose()
    return {
      id: this.id, mode: this.mode, time: this.metrics.time, steps: this.metrics.stepCount,
      base: b,
      imu: this.imu ? { ...this.imu.read(), trueRoll: this.imu.trueRoll, truePitch: this.imu.truePitch } : null,
      stability: {
        bodyContact: this.bodyGroundContact,
        state: this.stability.state, margin_m: this.stability.margin * L, com: { ...this.stability.com },
        comVelocity: { ...this.stability.comVelocity }, mass: this.stability.mass, groundedFeet: this.stability.groundedFeet ?? 0,
      },
      feet: [...this.feet.entries()].map(([id, f]) => ({ id, contact: f.contact, normalForce: f.normalForce, frictionForce: f.frictionForce, slipping: f.slipping, force: { ...f.force }, torque: { ...f.torque }, point: { ...f.point } })),
      actuators: acts,
      legs: this.legs.map(l => ({ id: l.id, ik: l.lastIK?.status ?? null, ikError: l.lastIK?.error ?? null, stance: this.gait ? this.gait.stance[this.legs.indexOf(l)] : true })),
      battery: {
        voltage: this.battery.voltage, current: this.battery.current, power: this.battery.power, soc: this.battery.soc,
        energyUsed_J: this.battery.energyUsed_J, brownout: this.battery.brownout, currentLimited: this.battery.currentLimited,
      },
      validation: { maxJointError: maxJointErr, maxFootError_m: maxFootErr * L },
    }
  }

  dispose() {
    this.host?.exit()
    for (const J of this.joints.values()) { try { this.world.removeImpulseJoint(J.joint, true) } catch { /* already gone */ } }
    for (const Lk of this.links.values()) { try { this.world.removeRigidBody(Lk.body) } catch { /* already gone */ } }
    this.joints.clear(); this.links.clear(); this.actuators.clear(); this.feet.clear()
    this.built = false
  }
}
