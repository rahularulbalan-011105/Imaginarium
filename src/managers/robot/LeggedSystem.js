import * as THREE from 'three'
import { GaitEngine } from './GaitEngine.js'
import { PhysicsIntegrator } from '../physics/PhysicsIntegrator.js'
import { totalMass, totalMomentOfInertia, maxFrontalArea } from '../physics/MassCalculator.js'

const DEFAULT_ARM_LEN = 2.5
const SWING_RANGE_DEG = 30   // hip sweeps ±30° from neutral (90°)
const LIFT_ADD_DEG    = 40   // knee lifts up to 40° during swing phase

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
   * Automatically handles 1 or 2 servos per leg (hip+knee).
   *
   * Detection strategy:
   *  1. Collect all servo+arm pairs with world positions.
   *  2. Compute the coefficient of variation (CV) of centroid distances.
   *     - High CV (> 0.3) + even count → two groups exist (inner=hips, outer=knees).
   *     - Low CV → all servos are roughly equidistant → each is its own leg.
   *  3. In hip+knee mode, split by centroid distance and pair each inner servo
   *     with its nearest outer servo → 2-DOF leg.
   */
  build(topLevel, objectMgr, attachments) {
    // ── Step 1: collect servo+arm pairs ─────────────────────────────────────
    const pairs = []

    for (const [childId, motorId] of Object.entries(attachments)) {
      const servoObj = topLevel.find(o => o.id === motorId && o.type === 'servo')
      if (!servoObj) continue
      // Arms live inside servo rotorGroups (not scene-direct), so topLevel won't
      // contain them — use getMesh which works regardless of parent.
      const servoMesh = objectMgr.getMesh(motorId)
      const armMesh   = objectMgr.getMesh(childId)
      if (!servoMesh || !armMesh) continue

      servoMesh.updateMatrixWorld(true)
      const wp = new THREE.Vector3()
      servoMesh.getWorldPosition(wp)

      armMesh.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(armMesh)
      const sz  = new THREE.Vector3()
      box.getSize(sz)
      const armLength = Math.max(sz.x, sz.y, sz.z, DEFAULT_ARM_LEN * 0.5)

      pairs.push({ servoId: motorId, armId: childId, armLength, x: wp.x, z: wp.z })
    }

    if (pairs.length < 2) return false

    // ── Step 2: body centroid ────────────────────────────────────────────────
    const cx = pairs.reduce((s, p) => s + p.x, 0) / pairs.length
    const cz = pairs.reduce((s, p) => s + p.z, 0) / pairs.length

    // ── Step 3: decide whether to use hip+knee pairing ──────────────────────
    // CV of centroid distances: high variance → bimodal (inner hips + outer knees)
    const centDists = pairs.map(p => Math.hypot(p.x - cx, p.z - cz))
    const meanCD    = centDists.reduce((a, b) => a + b, 0) / centDists.length
    const varCD     = centDists.reduce((s, d) => s + (d - meanCD) ** 2, 0) / centDists.length
    const cv        = meanCD > 0.1 ? Math.sqrt(varCD) / meanCD : 0

    const useHipKnee = cv > 0.3 && pairs.length % 2 === 0

    // ── Step 4: build leg descriptors ────────────────────────────────────────
    const legDescs = []

    if (useHipKnee) {
      // Split by centroid distance: inner half = hips, outer half = knees
      const sorted = pairs
        .map((p, i) => ({ ...p, centDist: centDists[i] }))
        .sort((a, b) => a.centDist - b.centDist)

      const half        = sorted.length / 2
      const innerServos = sorted.slice(0, half)   // hips (closer to body)
      const outerServos = sorted.slice(half)       // knees (at arm tips)
      const outerUsed   = new Set()

      for (const hip of innerServos) {
        // Pair with nearest unused outer servo
        let bestKnee = null, bestDist = Infinity
        for (const knee of outerServos) {
          if (outerUsed.has(knee.servoId)) continue
          const d = Math.hypot(knee.x - hip.x, knee.z - hip.z)
          if (d < bestDist) { bestDist = d; bestKnee = knee }
        }
        if (bestKnee) outerUsed.add(bestKnee.servoId)

        legDescs.push({
          id:          hip.servoId,
          servoId:     hip.servoId,
          kneeServoId: bestKnee ? bestKnee.servoId : null,
          armId:       hip.armId,
          armLength:   hip.armLength,
          mountX:      hip.x,
          mountZ:      hip.z,
        })
      }
    } else {
      // Each pair is its own leg (single servo per leg)
      for (const p of pairs) {
        legDescs.push({
          id:          p.servoId,
          servoId:     p.servoId,
          kneeServoId: null,
          armId:       p.armId,
          armLength:   p.armLength,
          mountX:      p.x,
          mountZ:      p.z,
        })
      }
    }

    if (legDescs.length < 2) return false

    // ── Step 5: sort legs by angle around centroid for phase ordering ────────
    legDescs.sort((a, b) =>
      Math.atan2(a.mountZ - cz, a.mountX - cx) -
      Math.atan2(b.mountZ - cz, b.mountX - cx)
    )

    for (const l of legDescs) {
      l.restPosition = { x: l.mountX - cx, y: 0, z: l.mountZ - cz }
    }
    this.legs = legDescs

    // ── Step 6: choose gait based on leg count ───────────────────────────────
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

    const kneeCount = legDescs.filter(l => l.kneeServoId).length
    console.log(
      `[LeggedSystem] ${n} legs` +
      (kneeCount ? ` (${kneeCount} with knee servo, CV=${cv.toFixed(2)})` : '') +
      `, gait=${this._gaitType}, mass=${robotMass.toFixed(2)} kg`
    )
    return true
  }

  /**
   * Advance one tick.
   * For 2-DOF legs: hip servo = swing only, knee servo = lift only.
   * For 1-DOF legs: single servo combines swing + lift (original behaviour).
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

        const dz   = t.z - leg.restPosition.z
        const lift = Math.max(0, t.y)
        const norm = Math.max(-1, Math.min(1, dz / Math.max(0.1, stride)))

        if (leg.kneeServoId) {
          // 2-DOF: separate hip (swing) and knee (lift) servos
          const hipAngle  = 90 + norm * SWING_RANGE_DEG
          const kneeAngle = 90 - (lift / Math.max(0.1, height)) * LIFT_ADD_DEG
          objectMgr.animateServo(leg.servoId,     Math.max(0, Math.min(180, hipAngle)))
          objectMgr.animateServo(leg.kneeServoId, Math.max(0, Math.min(180, kneeAngle)))
        } else {
          // 1-DOF: combine swing + lift into one servo
          let angle = 90 + norm * SWING_RANGE_DEG
          angle    += (lift / Math.max(0.1, height)) * LIFT_ADD_DEG
          objectMgr.animateServo(leg.servoId, Math.max(0, Math.min(180, angle)))
        }
      }
    } else {
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
