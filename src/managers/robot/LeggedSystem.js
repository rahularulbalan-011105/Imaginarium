import * as THREE from 'three'
import { GaitEngine } from './GaitEngine.js'
import { PhysicsIntegrator } from '../physics/PhysicsIntegrator.js'
import { totalMass, totalMomentOfInertia, maxFrontalArea } from '../physics/MassCalculator.js'

const DEFAULT_ARM_LEN = 2.5
const SWING_RANGE_DEG = 30   // hip sweeps ±30° from neutral (90°)
const LIFT_ADD_DEG    = 40   // knee lifts up to 40° during swing phase

const YAW_AXIS_MIN = 0.7   // |hinge · up| above this = the joint twists the leg (yaw)

/**
 * Can these legs turn the robot? Turning needs a foot to push SIDEWAYS against
 * the floor. Hips and knees whose hinges lie flat only swing a foot fore/aft:
 *   • a twist joint (vertical hinge) on any leg → can turn;
 *   • 4+ legs → can turn tank-style (one side strides longer while the robot
 *     stays standing on the others);
 *   • a biped with only flat hinges → cannot: both feet just push straight.
 * @param legCount number of legs
 * @param hingeAxes world-space unit hinge axes of every leg servo ({x,y,z})
 */
export function turnCapability(legCount, hingeAxes) {
  if (hingeAxes.some(a => Math.abs(a.y) > YAW_AXIS_MIN)) return { canTurn: true, reason: null }
  if (legCount >= 4) return { canTurn: true, reason: null }
  return {
    canTurn: false,
    reason: `Can't turn: every leg joint swings forward/back only — a ${legCount}-legged robot needs a twisting (vertical-axis) servo to turn.`,
  }
}

/** World hinge axis of a servo: its rotor axis in world space (unit vector). */
function servoHingeAxis(servoMesh) {
  const rotor = servoMesh?.userData?.rotorGroup
  const frame = rotor?.parent ?? servoMesh
  if (!frame) return null
  frame.updateMatrixWorld(true)
  const k = servoMesh.userData?.rotorAxis ?? 'y'
  const v = new THREE.Vector3(k === 'x' ? 1 : 0, k === 'y' ? 1 : 0, k === 'z' ? 1 : 0)
  return v.transformDirection(frame.matrixWorld)
}

/** World box of a servo's OWN body — not the parts riding its horn. */
function servoBodyBox(servoMesh) {
  const rotor = servoMesh.userData?.rotorGroup
  const box = new THREE.Box3(), tmp = new THREE.Box3()
  const visit = (n) => {
    if (n === rotor) return
    if (n.isMesh && n.geometry && !n.userData?.isPin && !n.userData?.isPinLabel && !n.userData?.isSelectionOutline) {
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox()
      tmp.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld)
      box.union(tmp)
    }
    for (const c of n.children) visit(c)
  }
  servoMesh.updateMatrixWorld(true)
  visit(servoMesh)
  return box
}

/**
 * Knee servos found from how the robot is built: knee K belongs to hip H when
 * K's body touches the part H swings (the arm it overlaps most). Each hip gets
 * at most one knee; returns null when no servo sits on another's arm.
 */
export function structuralKnees(pairs, margin = 0.3) {
  // Each servo's best host = the OTHER servo's arm its body overlaps most.
  const overlap = (a, b) => {
    const i = a.clone().intersect(b)
    if (i.isEmpty()) return 0
    const s = i.getSize(new THREE.Vector3())
    return Math.max(1e-6, s.x * s.y * s.z)
  }
  const links = []   // { hip, knee, vol }
  for (const k of pairs) {
    if (!k.bodyBox || k.bodyBox.isEmpty()) continue
    let host = null, best = 0
    for (const h of pairs) {
      if (h.servoId === k.servoId || !h.armBox) continue
      const v = overlap(h.armBox.clone().expandByScalar(margin), k.bodyBox)
      if (v > best) { best = v; host = h }
    }
    if (host) links.push({ hip: host.servoId, knee: k.servoId, vol: best })
  }
  // Strongest contacts first; a hip keeps one knee, a servo is either a hip or
  // a knee (3-servo chains fall back to the distance rule).
  links.sort((x, y) => y.vol - x.vol)
  const kneeOf = new Map(), kneeIds = new Set()
  for (const l of links) {
    if (kneeOf.has(l.hip) || kneeIds.has(l.knee) || kneeIds.has(l.hip) || kneeOf.has(l.knee)) continue
    kneeOf.set(l.hip, l.knee); kneeIds.add(l.knee)
  }
  return kneeIds.size ? { kneeOf, kneeIds } : null
}

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
      if (armMesh.userData?.simBuried) continue        // lost part under the floor

      servoMesh.updateMatrixWorld(true)
      const wp = new THREE.Vector3()
      servoMesh.getWorldPosition(wp)

      armMesh.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(armMesh)
      const sz  = new THREE.Vector3()
      box.getSize(sz)
      const armLength = Math.max(sz.x, sz.y, sz.z, DEFAULT_ARM_LEN * 0.5)

      const servoBox = new THREE.Box3().setFromObject(servoMesh)
      pairs.push({ servoId: motorId, armId: childId, armLength, x: wp.x, z: wp.z,
        armMinY: box.min.y, topY: Math.max(box.max.y, servoBox.max.y),
        armBox: box, bodyBox: servoBodyBox(servoMesh) })
    }

    // One servo drives ONE leg. If several parts ride its horn, the leg is the
    // one reaching lowest (a second attached bracket must not become a 5th leg).
    {
      const best = new Map()
      for (const pr of pairs) {
        const cur = best.get(pr.servoId)
        if (!cur || pr.armMinY < cur.armMinY) best.set(pr.servoId, pr)
      }
      if (best.size < pairs.length) pairs.splice(0, pairs.length, ...best.values())
    }

    // A servo whose part never reaches the lower half of the robot is not a leg
    // (a neck turning the head, a sensor sweep, an arm on top). Counting it made
    // a two-legged duck a "3-legged" robot whose head paddled with the gait.
    // Thighs of hip+knee legs still reach below the middle, so they stay.
    // A hip that carries a knee servo IS a leg even if its bracket stays at body
    // height (spider legs: hip swings a short horizontal bracket, the knee below
    // it reaches the floor) — so knees and their hips are exempt.
    if (pairs.length > 2) {
      const k0 = structuralKnees(pairs)
      const inLeg = new Set(k0 ? [...k0.kneeOf.keys(), ...k0.kneeIds] : [])
      const bottom = Math.min(...pairs.map(p => p.armMinY))
      const top    = Math.max(...pairs.map(p => p.topY))
      const legs   = pairs.filter(p => inLeg.has(p.servoId) || p.armMinY <= bottom + 0.5 * (top - bottom))
      if (legs.length >= 2) pairs.splice(0, pairs.length, ...legs)
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

    // ── Step 3b: hip+knee from STRUCTURE (preferred) ─────────────────────────
    // A knee servo is mounted ON the part another servo swings (its thigh), so
    // its body touches that servo's arm. This is how the leg is actually built
    // and works when knees sit straight below the hips (a biped), where the
    // centroid-distance rule above sees four identical "legs".
    const knees = structuralKnees(pairs)

    // ── Step 4: build leg descriptors ────────────────────────────────────────
    const legDescs = []

    if (knees) {
      for (const hip of pairs) {
        if (knees.kneeIds.has(hip.servoId)) continue
        legDescs.push({
          id: hip.servoId, servoId: hip.servoId, kneeServoId: knees.kneeOf.get(hip.servoId) ?? null,
          armId: hip.armId, armLength: hip.armLength, mountX: hip.x, mountZ: hip.z,
        })
      }
    } else if (useHipKnee) {
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
    const axes = []
    for (const l of legDescs) for (const id of [l.servoId, l.kneeServoId]) {
      const a = id && servoHingeAxis(objectMgr.getMesh(id))
      if (a) axes.push(a)
    }
    this.caps = turnCapability(n, axes)
    console.log(
      `[LeggedSystem] ${n} legs` +
      (kneeCount ? ` (${kneeCount} with knee servo, CV=${cv.toFixed(2)})` : '') +
      `, gait=${this._gaitType}, mass=${robotMass.toFixed(2)} kg` +
      (this.caps.canTurn ? '' : ' — cannot turn (no twist joint)')
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

    // Legs stopped → the planted feet hold the body: no coasting. The
    // integrator's inertia lag (mass × 0.12 s) models a WHEELED drive rolling
    // on; a 2.5 kg walker kept sliding ~0.5 s after the key was released.
    // Braking is still capped by foot grip (legTraction.js), and zero-G still
    // drifts — that state lives in DriveManager._legVel, not here.
    if (speed === 0 && turn === 0) {
      this._physics.reset()
      return { v: 0, omega: 0 }
    }

    // Legs don't roll: rolling friction is a WHEEL loss (it grows with g, so on
    // a heavy walker it inverted the gravity effect — slower on Earth than on
    // the Moon). Gravity acts on walking through grip + Froude speed instead
    // (legTraction.js); drag and wind still apply.
    return this._physics.step(speed, turn, dt, this._bodyYaw, { ...physEnv, rollingFriction: 0 })
  }

  setBodyYaw(yaw) { this._bodyYaw = yaw }

  reset() {
    if (this._physics)    this._physics.reset()
    if (this._gaitEngine) this._gaitEngine.reset()
  }
}
