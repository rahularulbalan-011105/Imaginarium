import { ENVIRONMENTS, SCENE_TO_M } from './EnvironmentConfig.js'

let _rapier = null

async function getRapier() {
  if (_rapier) return _rapier
  const R = await import('@dimforge/rapier3d-compat')
  await R.init()
  _rapier = R
  return R
}

class PhysicsManager {
  constructor() {
    this.world   = null
    this._R      = null
    this._bodies = new Map()
    this._idByHandle = new Map()   // rigidBody.handle -> id (for contact-event lookup)
    this._eventQueue = null        // Rapier collision-event queue (combat)
    this.ready   = false
    this._initPromise = null
  }

  init() {
    if (this._initPromise) return this._initPromise
    this._initPromise = getRapier().then(R => {
      this._R = R
      const earth = ENVIRONMENTS.earth
      // Use scene-unit gravity (1 scene unit = 0.05 m → g = 9.81/0.05 ≈ 196 su/s²).
      // Dynamic bodies need this to fall at the correct visual speed.
      // Kinematic bodies (wheeled robot) ignore gravity entirely, so this is safe.
      this.world  = new R.World({ x: 0.0, y: earth.gravity / SCENE_TO_M, z: 0.0 })
      // Static ground plane
      // Large flat cuboid centred at y = -0.5 → top face flush with y = 0.
      // ColliderDesc.halfSpace was removed in newer Rapier builds; cuboid is equivalent
      // for robot-scale scenes (500×500 units, larger than any scene the user builds).
      // Ground plane: thick cuboid (2 units tall) so fast-moving objects don't
      // tunnel through. Top face flush at y=0. 200×200 su covers any scene
      // while keeping Rapier's broad-phase numerically reliable.
      const gDesc = R.RigidBodyDesc.fixed().setTranslation(0, -1.0, 0)
      const gBody = this.world.createRigidBody(gDesc)
      const gCol  = R.ColliderDesc
        .cuboid(200, 1.0, 200)
        .setFriction(earth.groundFriction)
        .setRestitution(0.0)
      this.world.createCollider(gCol, gBody)
      this._eventQueue = new R.EventQueue(true)   // for combat contact events
      this.ready = true
    }).catch(err => {
      console.error('[PhysicsManager] Rapier init failed:', err)
    })
    return this._initPromise
  }

  /** Update world gravity. Pass m/s² (e.g. -9.81); converts to scene units internally. */
  setGravity(y_m_s2) {
    if (!this.world) return
    if (!Number.isFinite(y_m_s2)) return   // guard against NaN/undefined → frozen physics
    try {
      this.world.gravity = { x: 0, y: y_m_s2 / SCENE_TO_M, z: 0 }
    } catch {
      // Some Rapier builds expose gravity as read-only; silently ignore.
    }
  }

  /**
   * Create a dynamic (free-falling, fully physics-driven) rigid body.
   * Position and halfExtents are in scene units.
   * rotation is a quaternion { x, y, z, w }.
   */
  createDynamicBody(id, position, rotation, halfExtents) {
    if (!this.ready) return null
    this.removeBody(id)
    const R    = this._R
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinearDamping(0.15)
      .setAngularDamping(2.0)
      .setCanSleep(false)   // never sleep — a mid-air body must keep falling and
                            // must respond to gravity/environment changes instantly
    const body = this.world.createRigidBody(desc)
    const col  = R.ColliderDesc
      .cuboid(
        Math.max(0.01, halfExtents.x),
        Math.max(0.01, halfExtents.y),
        Math.max(0.01, halfExtents.z),
      )
      .setFriction(0.7)
      .setRestitution(0.1)
    this.world.createCollider(col, body)
    this._bodies.set(id, body)
    return body
  }

  /**
   * Create ONE dynamic body with MULTIPLE box colliders — a compound rigid body,
   * for a welded/bonded assembly that should fall and tumble as a single object.
   * `parts`: [{ halfExtents:{x,y,z}, offset:{x,y,z}, rotation:{x,y,z,w} }] in body-local.
   * Rapier derives mass + centre-of-mass from the colliders automatically.
   */
  createCompoundBody(id, position, rotation, parts) {
    if (!this.ready) return null
    this.removeBody(id)
    const R    = this._R
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinearDamping(0.12)
      .setAngularDamping(0.5)   // low enough to tumble to a stable resting face
      .setCanSleep(false)
    const body = this.world.createRigidBody(desc)
    for (const p of parts) {
      const col = R.ColliderDesc
        .cuboid(Math.max(0.02, p.halfExtents.x), Math.max(0.02, p.halfExtents.y), Math.max(0.02, p.halfExtents.z))
        .setTranslation(p.offset.x, p.offset.y, p.offset.z)
        .setFriction(0.8)
        .setRestitution(0.04)
      if (p.rotation) col.setRotation(p.rotation)
      this.world.createCollider(col, body)
    }
    this._bodies.set(id, body)
    return body
  }

  createRobotBody(id, position, halfExtents = { x: 0.5, y: 0.25, z: 0.75 }) {
    if (!this.ready) return null
    this.removeBody(id)
    const R    = this._R
    const desc = R.RigidBodyDesc.kinematicVelocityBased()
      .setTranslation(position.x, position.y ?? 0, position.z)
    const body = this.world.createRigidBody(desc)
    const col  = R.ColliderDesc
      .cuboid(
        Math.max(0.05, halfExtents.x),
        Math.max(0.05, halfExtents.y),
        Math.max(0.05, halfExtents.z),
      )
      .setFriction(ENVIRONMENTS.earth.groundFriction)
    this.world.createCollider(col, body)
    this._bodies.set(id, body)
    return body
  }

  /**
   * Create a DYNAMIC combat robot body: one box approximating the assembly, that
   * pushes/knocks other robots via real Rapier contacts. X/Z rotation is LOCKED so
   * the robot drives upright and can't topple (physical toppling arrives with the
   * Stability system in a later stage). Collision events are enabled so ram damage
   * can be resolved (see drainContactEvents).
   */
  createCombatBody(id, position, rotation, halfExtents) {
    if (!this.ready) return null
    this.removeBody(id)
    const R    = this._R
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.6)
      .setAngularDamping(4.0)
      .setCanSleep(false)
      .enabledRotations(false, true, false)   // yaw only — stay upright (Stage 1)
    if (rotation) desc.setRotation(rotation)
    const body = this.world.createRigidBody(desc)
    const col  = R.ColliderDesc
      .cuboid(Math.max(0.05, halfExtents.x), Math.max(0.05, halfExtents.y), Math.max(0.05, halfExtents.z))
      .setFriction(0.9)
      .setRestitution(0.25)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
    this.world.createCollider(col, body)
    this._bodies.set(id, body)
    this._idByHandle.set(body.handle, id)
    return body
  }

  /** Apply a linear impulse (scene-unit·mass) at the body's centre of mass. */
  applyImpulse(id, imp) {
    const b = this._bodies.get(id)
    if (b) b.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true)
  }

  /** Apply an angular impulse about the given axis (used for turning / spin). */
  applyTorqueImpulse(id, t) {
    const b = this._bodies.get(id)
    if (b) b.applyTorqueImpulse({ x: t.x, y: t.y, z: t.z }, true)
  }

  /**
   * Cast a ray; returns { id, toi, point } of the first body hit, or null.
   * `excludeId` skips a body (e.g. the shooter). Used by weapons/AI later.
   */
  raycast(origin, dir, maxToi = 1000, excludeId = null) {
    if (!this.ready) return null
    const R   = this._R
    const ray = new R.Ray(origin, dir)
    const excl = excludeId != null ? this._bodies.get(excludeId) : null
    const hit = this.world.castRay(ray, maxToi, true, undefined, undefined, undefined, excl || undefined)
    if (!hit) return null
    const collider = hit.collider
    const rb = collider?.parent?.() ?? collider?.parent
    const id = rb ? this._idByHandle.get(rb.handle) ?? null : null
    const toi = hit.toi ?? hit.timeOfImpact
    return { id, toi, point: { x: origin.x + dir.x * toi, y: origin.y + dir.y * toi, z: origin.z + dir.z * toi } }
  }

  /**
   * Drain this frame's collision-start events. `cb(idA, idB, started)` is called
   * for each pair where BOTH colliders belong to registered bodies. Call once
   * right after step().
   */
  drainContactEvents(cb) {
    if (!this._eventQueue) return
    this._eventQueue.drainCollisionEvents((h1, h2, started) => {
      const c1 = this.world.getCollider(h1)
      const c2 = this.world.getCollider(h2)
      if (!c1 || !c2) return
      const rb1 = c1.parent?.() ?? c1.parent
      const rb2 = c2.parent?.() ?? c2.parent
      if (!rb1 || !rb2) return
      const idA = this._idByHandle.get(rb1.handle)
      const idB = this._idByHandle.get(rb2.handle)
      if (idA != null && idB != null) cb(idA, idB, started)
    })
  }

  /** Linear velocity of a body as {x,y,z} in scene-units/s, or null. */
  getLinvel(id) {
    const b = this._bodies.get(id)
    return b ? b.linvel() : null
  }

  /** Create a static (fixed) collider for a world obstacle. */
  createStaticObstacle(id, center, halfExtents) {
    if (!this.ready) return null
    this.removeBody(id)
    const R    = this._R
    const desc = R.RigidBodyDesc.fixed()
      .setTranslation(center.x, center.y, center.z)
    const body = this.world.createRigidBody(desc)
    const col  = R.ColliderDesc
      .cuboid(
        Math.max(0.05, halfExtents.x),
        Math.max(0.05, halfExtents.y),
        Math.max(0.05, halfExtents.z),
      )
      .setFriction(ENVIRONMENTS.earth.groundFriction)
      .setRestitution(0.2)
    this.world.createCollider(col, body)
    this._bodies.set(id, body)
    return body
  }

  getBody(id)    { return this._bodies.get(id) ?? null }

  removeBody(id) {
    const body = this._bodies.get(id)
    if (body) {
      this._idByHandle.delete(body.handle)
      if (this.world) this.world.removeRigidBody(body)
    }
    this._bodies.delete(id)
  }

  step(dt) {
    if (!this.ready) return
    this.world.timestep = Math.min(Math.max(dt, 0.001), 0.05)
    // Pass the event queue so combat contact events are collected; harmless for
    // the drive path (which never drains it).
    this.world.step(this._eventQueue || undefined)
  }

  dispose() {
    if (this.world) { this.world.free(); this.world = null }
    this._bodies.clear()
    this.ready   = false
    this._initPromise = null
  }
}

export const physicsManager = new PhysicsManager()
