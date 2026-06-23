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
    if (body && this.world) this.world.removeRigidBody(body)
    this._bodies.delete(id)
  }

  step(dt) {
    if (!this.ready) return
    this.world.timestep = Math.min(Math.max(dt, 0.001), 0.05)
    this.world.step()
  }

  dispose() {
    if (this.world) { this.world.free(); this.world = null }
    this._bodies.clear()
    this.ready   = false
    this._initPromise = null
  }
}

export const physicsManager = new PhysicsManager()
