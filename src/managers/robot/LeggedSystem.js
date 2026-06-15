import * as THREE from 'three'
import { GaitEngine } from './GaitEngine.js'
import { PhysicsIntegrator } from '../physics/PhysicsIntegrator.js'
import { totalMass, totalMomentOfInertia, maxFrontalArea } from '../physics/MassCalculator.js'

const DEFAULT_ARM_LEN = 2.5
const SWING_RANGE_DEG = 30   // servo sweeps ±30° from neutral (90°)
const LIFT_ADD_DEG    = 25   // extra degrees during swing lift

export class LeggedSystem {
  constructor() {
    this.legs        = []
    this._gaitEngine = null
    this._physics    = null
    this._bodyYaw    = 0
    this._gaitType   = 'none'
  }

  get numLegs()  { return this.legs.length }
  get gaitType() { return this._gaitType }

  /**
   * Detect legs from scene objects + attachments map, then build the gait engine.
   * @param {object[]} topLevel   filtered scene objects (no planes, no standalones)
   * @param {object}   objectMgr  ObjectManager instance
   * @param {object}   attachments  { childId: servoId } from electronicsStore
   * @returns {boolean} true if a valid legged robot was detected
   */
  build(topLevel, objectMgr, attachments) {
    const legDescs = []

    for (const [childId, motorId] of Object.entries(attachments)) {
      const servoObj = topLevel.find(o => o.id === motorId && o.type === 'servo')
      if (!servoObj) continue
      const armObj = topLevel.find(o => o.id === childId)
      if (!armObj) continue

      const servoMesh = objectMgr.getMesh(motorId)
      const armMesh   = objectMgr.getMesh(childId)
      if (!servoMesh || !armMesh) continue

      servoMesh.updateMatrixWorld(true)
      const servoWPos = new THREE.Vector3()
      servoMesh.getWorldPosition(servoWPos)

      armMesh.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(armMesh)
      const sz  = new THREE.Vector3()
      box.getSize(sz)
      const armLength = Math.max(sz.x, sz.y, sz.z, DEFAULT_ARM_LEN * 0.5)

      legDescs.push({
        id:      motorId,
        servoId: motorId,
        armId:   childId,
        armLength,
        mountX:  servoWPos.x,
        mountZ:  servoWPos.z,
      })
    }

    if (legDescs.length < 2) return false

    // Compute body centroid and sort legs by angle around it for phase ordering
    const cx = legDescs.reduce((s, l) => s + l.mountX, 0) / legDescs.length
    const cz = legDescs.reduce((s, l) => s + l.mountZ, 0) / legDescs.length
    legDescs.sort((a, b) =>
      Math.atan2(a.mountZ - cz, a.mountX - cx) -
      Math.atan2(b.mountZ - cz, b.mountX - cx)
    )

    // Rest position in body-local frame (relative to centroid)
    for (const l of legDescs) {
      l.restPosition = { x: l.mountX - cx, y: 0, z: l.mountZ - cz }
    }
    this.legs = legDescs

    const n = legDescs.length
    let phases, stanceRatio
    if (n >= 6) {
      this._gaitType = 'tripod'
      phases         = legDescs.map((_, i) => (i % 2 === 0) ? 0 : 0.5)
      stanceRatio    = 0.5
    } else if (n >= 4) {
      this._gaitType = 'trot'
      phases         = legDescs.map((_, i) => (i % 2 === 0) ? 0 : 0.5)
      stanceRatio    = 0.6
    } else {
      this._gaitType = 'alternating'
      phases         = legDescs.map((_, i) => i / n)
      stanceRatio    = 0.5
    }

    this._gaitEngine = new GaitEngine(
      legDescs.map(l => ({ id: l.id, restPosition: l.restPosition })),
      phases,
      { stepHeight: 2.0, stepLength: 2.5, cycleFreq: 1.5, stanceRatio }
    )

    const robotMass = Math.max(0.1, totalMass(topLevel))
    this._physics = new PhysicsIntegrator({
      mass:            robotMass,
      momentOfInertia: Math.max(0.001, totalMomentOfInertia(topLevel, cx, cz)),
      frontalArea:     maxFrontalArea(topLevel),
    })
    console.log(`[LeggedSystem] ${n} legs, gait=${this._gaitType}, mass=${robotMass.toFixed(2)} kg`)
    return true
  }

  /**
   * Advance one tick.
   * @param {number}  dt        delta time (s)
   * @param {number}  speed     commanded forward speed (scene u/s)
   * @param {number}  turn      commanded yaw rate (rad/s)
   * @param {boolean} skipGait  if true, skip servo animation (user code controls them)
   * @param {object}  physEnv   { gravity, airDensity, rollingFriction, wind }
   * @param {object}  objectMgr ObjectManager instance
   * @returns {{ v: number, omega: number }} smoothed body velocity for Rapier
   */
  step(dt, speed, turn, skipGait, physEnv, objectMgr) {
    if (!this._gaitEngine || !this._physics) return { v: 0, omega: 0 }

    if (!skipGait) {
      const targets = this._gaitEngine.step(dt, speed, turn)
      const stride  = this._gaitEngine.stepLength || 2.5
      const height  = this._gaitEngine.stepHeight || 2.0

      for (const leg of this.legs) {
        const t = targets[leg.id]
        if (!t) continue

        // dz in body frame: negative = forward, positive = backward (w.r.t. body +Z forward)
        const dz   = t.z - leg.restPosition.z
        const lift = Math.max(0, t.y)

        // Map body-local z-offset → servo angle (90° = neutral/down)
        const norm  = Math.max(-1, Math.min(1, dz / Math.max(0.1, stride)))
        let   angle = 90 + norm * SWING_RANGE_DEG
        angle      += (lift / Math.max(0.1, height)) * LIFT_ADD_DEG
        objectMgr.animateServo(leg.servoId, Math.max(0, Math.min(180, angle)))
      }
    } else {
      // Advance clock at idle so phases stay consistent, but don't animate servos
      this._gaitEngine.step(dt, 0, 0)
    }

    return this._physics.step(speed, turn, dt, this._bodyYaw, physEnv)
  }

  setBodyYaw(yaw) { this._bodyYaw = yaw }

  reset() {
    if (this._physics)    this._physics.reset()
    if (this._gaitEngine) this._gaitEngine.reset()
  }
}
