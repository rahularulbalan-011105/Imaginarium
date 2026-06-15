import { ENVIRONMENTS } from './EnvironmentConfig.js'

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
      this.world  = new R.World({ x: 0.0, y: earth.gravity, z: 0.0 })
      // Static ground plane
      // Large flat cuboid centred at y = -0.5 → top face flush with y = 0.
      // ColliderDesc.halfSpace was removed in newer Rapier builds; cuboid is equivalent
      // for robot-scale scenes (500×500 units, larger than any scene the user builds).
      const gDesc = R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)
      const gBody = this.world.createRigidBody(gDesc)
      const gCol  = R.ColliderDesc
        .cuboid(500, 0.5, 500)
        .setFriction(earth.groundFriction)
        .setRestitution(0.2)
      this.world.createCollider(gCol, gBody)
      this.ready = true
    }).catch(err => {
      console.error('[PhysicsManager] Rapier init failed:', err)
    })
    return this._initPromise
  }

  /** Update world gravity (call from DriveManager when environment changes). */
  setGravity(y) {
    if (!this.world) return
    try {
      this.world.gravity = { x: 0, y, z: 0 }
    } catch {
      // Some Rapier builds expose gravity as read-only; silently ignore.
    }
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
