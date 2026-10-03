// RoboticsRuntime — fixed-timestep orchestrator for articulated robots sharing
// one Rapier world (multi-robot: every robot collides with every other robot,
// terrain and obstacles; a robot's own links never self-collide).
//
// Frame (variable render dt) → accumulator → N fixed steps of h:
//   for each robot: control(h)          sensors → controller → actuators → torques
//   terrain.update (moving platforms)
//   world.step()                         Rapier: integrate, collide, solve contacts/joints
//   for each robot: postStep(h)          contacts → sensors → stability → power/thermal
// Rendering interpolates link poses between the last two physics states.
import * as THREE from 'three'
import { ArticulatedRobot } from './ArticulatedRobot.js'
import { buildTerrain } from './terrain.js'
import { getMaterial, applyMaterialToDesc, DEFAULT_GROUND_MATERIAL } from './materials.js'
import { L } from './units.js'
import { DEFAULT_WORLD_PHYSICS } from './config.js'

export { DEFAULT_WORLD_PHYSICS }   // defined in config.js (kept light for the stores)

export class RoboticsRuntime {
  /**
   * @param opts.R, opts.world    Rapier module + world (scene units)
   * @param opts.groundCollider   the existing ground collider (material + enable control)
   * @param opts.config           DEFAULT_WORLD_PHYSICS overrides
   */
  constructor({ R, world, groundCollider = null, config = {} }) {
    this.R = R; this.world = world
    this.config = { ...DEFAULT_WORLD_PHYSICS, ...config }
    this.robots = new Map()
    this._slots = new Set()
    this._materials = new Map()   // collider handle → material ref (non-robot colliders)
    this.ground = groundCollider
    this.terrain = null
    this.time = 0
    this._acc = 0
    this.stats = { stepsLastFrame: 0, stepMs: 0, stepMsAvg: 0, droppedTime: 0 }
    world.integrationParameters.numSolverIterations = this.config.solverIterations
    this.setGravity(this.config.gravity)
    if (this.ground) this.setGroundMaterial(DEFAULT_GROUND_MATERIAL)
  }

  // ── World configuration ─────────────────────────────────────────────────────
  setGravity(g) {
    const v = typeof g === 'number' ? { x: 0, y: g, z: 0 } : g
    this.gravitySI = new THREE.Vector3(v.x, v.y, v.z)
    try { this.world.gravity = { x: v.x / L, y: v.y / L, z: v.z / L } } catch { /* read-only build */ }
    for (const r of this.robots.values()) r.gravitySI.copy(this.gravitySI)
  }

  setTimestep(h) { this.config.timestep = Math.min(1 / 30, Math.max(1 / 2000, h)) }
  setSolverIterations(n) {
    this.config.solverIterations = Math.max(1, n | 0)
    this.world.integrationParameters.numSolverIterations = this.config.solverIterations
  }

  setGroundMaterial(ref) {
    if (!this.ground) return
    const m = getMaterial(ref)
    this.ground.setFriction(m.staticFriction)
    this.ground.setRestitution(m.restitution)
    this.ground.setFrictionCombineRule(this.R.CoefficientCombineRule.Min)
    this._materials.set(this.ground.handle, ref)
  }

  setTerrain(spec) {
    this.clearTerrain()
    if (!spec || spec.type === 'flat') {
      if (spec?.material) this.setGroundMaterial(spec.material)
      return null
    }
    this.terrain = buildTerrain(this.R, this.world, spec, { registerMaterial: (h, m) => this._materials.set(h, m) })
    if (this.terrain.disablesGround && this.ground) this.ground.setEnabled(false)
    return this.terrain
  }

  clearTerrain() {
    if (!this.terrain) return
    for (const c of this.terrain.colliders) this._materials.delete(c.handle)
    this.terrain.dispose()
    this.terrain = null
    if (this.ground) this.ground.setEnabled(true)
  }

  materialOf(handle) {
    if (this._materials.has(handle)) return this._materials.get(handle)
    for (const r of this.robots.values()) {
      const linkId = r.colliderOwner.get(handle)
      if (linkId) {
        const Lk = r.links.get(linkId)
        const i = Lk?.colliders.findIndex(c => c.handle === handle) ?? -1
        return i >= 0 ? Lk.materials[i] : null
      }
    }
    return null
  }

  /** A static obstacle (e.g. a standalone scene object) with a material. */
  addStaticBox(center, halfExtents, material = 'wood', rotation = null) {
    const R = this.R
    const b = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
    if (rotation) b.setRotation(rotation, false)
    const d = R.ColliderDesc.cuboid(Math.max(0.01, halfExtents.x), Math.max(0.01, halfExtents.y), Math.max(0.01, halfExtents.z))
    applyMaterialToDesc(R, d, material)
    const c = this.world.createCollider(d, b)
    this._materials.set(c.handle, material)
    return b
  }

  // ── Robots ──────────────────────────────────────────────────────────────────
  addRobot(graph, { blueprint = null } = {}) {
    let slot = 1
    while (this._slots.has(slot) && slot < 15) slot++
    if (this._slots.has(slot)) throw new Error('[RoboticsRuntime] too many robots (15 max)')
    this._slots.add(slot)
    const robot = new ArticulatedRobot({
      R: this.R, world: this.world, graph, slot, blueprint,
      materialOf: (h) => this.materialOf(h),
    })
    robot.gravitySI.copy(this.gravitySI)
    robot.build()
    robot._slot = slot
    this.robots.set(robot.id, robot)
    return robot
  }

  removeRobot(id) {
    const r = this.robots.get(id)
    if (!r) return
    r.dispose()
    this._slots.delete(r._slot)
    this.robots.delete(id)
  }

  // ── Stepping ────────────────────────────────────────────────────────────────
  /** Exactly one fixed physics step of h seconds. */
  step(h = this.config.timestep) {
    for (const r of this.robots.values()) r.control(h)
    this.terrain?.update(this.time + h)
    this.world.timestep = h
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    this.world.step()
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    this.stats.stepMs = ms
    this.stats.stepMsAvg = this.stats.stepMsAvg * 0.95 + ms * 0.05
    this.time += h
    for (const r of this.robots.values()) r.postStep(h)
  }

  /** Run n fixed steps (tests / headless). */
  run(n, h = this.config.timestep, beforeStep = null) {
    for (let i = 0; i < n; i++) { beforeStep?.(i, this.time); this.step(h) }
  }

  /**
   * Advance by a variable render frame. Returns the interpolation alpha (0…1)
   * between the previous and current physics states.
   */
  advance(frameDt) {
    const h = this.config.timestep
    this._acc += Math.min(Math.max(0, frameDt), 0.25)
    let n = 0
    while (this._acc >= h && n < this.config.maxSubsteps) { this.step(h); this._acc -= h; n++ }
    if (this._acc >= h) { this.stats.droppedTime += this._acc; this._acc = this._acc % h }   // slow-mo, not spiral
    this.stats.stepsLastFrame = n
    return this._acc / h
  }

  /** Interpolated world pose of a link for rendering. */
  interpolatedPose(robot, linkId, alpha, outP, outQ) {
    const Lk = robot.links.get(linkId)
    if (!Lk) return false
    const a = Lk.prev, b = Lk.curr
    outP.set(a.p[0] + (b.p[0] - a.p[0]) * alpha, a.p[1] + (b.p[1] - a.p[1]) * alpha, a.p[2] + (b.p[2] - a.p[2]) * alpha)
    _qa.set(a.q[0], a.q[1], a.q[2], a.q[3]); _qb.set(b.q[0], b.q[1], b.q[2], b.q[3])
    outQ.slerpQuaternions(_qa, _qb, alpha)
    return true
  }

  dispose() {
    for (const id of [...this.robots.keys()]) this.removeRobot(id)
    this.clearTerrain()
    this._materials.clear()
  }
}

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion()
