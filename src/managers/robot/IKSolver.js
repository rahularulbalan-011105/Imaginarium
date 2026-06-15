/**
 * Inverse Kinematics solver for robot limbs.
 * Pure math — no Three.js dependency. All angles in radians.
 */
export class IKSolver {
  /**
   * 2-joint planar IK (hip + knee in a 2D vertical plane).
   *
   * Given link lengths L1 (upper limb) and L2 (lower limb), solves for the
   * joint angles that place the end-effector at (px, py) relative to the
   * root joint.
   *
   * @param {number} L1       upper limb length
   * @param {number} L2       lower limb length
   * @param {number} px       target X (horizontal) relative to root
   * @param {number} py       target Y (vertical)   relative to root
   * @param {boolean} elbowUp prefer elbow-up (true) or elbow-down (false)
   * @returns {{ hip: number, knee: number } | null}
   */
  static solve2Joint(L1, L2, px, py, elbowUp = false) {
    const dist = Math.sqrt(px * px + py * py)
    // Clamp into reachable workspace to avoid NaN from acos
    const reach = Math.min(dist, L1 + L2 - 0.001)
    const slack = Math.max(reach, Math.abs(L1 - L2) + 0.001)
    const d = slack

    // Law of cosines — knee angle
    const cosKnee  = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)
    const kneeSign = elbowUp ? -1 : 1
    const knee     = kneeSign * Math.acos(Math.max(-1, Math.min(1, cosKnee)))

    // Hip angle = bearing to target ± offset
    const alpha    = Math.atan2(py, px)
    const cosAlpha = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
    const beta     = Math.acos(Math.max(-1, Math.min(1, cosAlpha)))
    const hip      = elbowUp ? alpha + beta : alpha - beta

    return { hip, knee }
  }

  /**
   * 3-joint leg IK: coxa (yaw) + femur (pitch) + tibia (pitch).
   * Standard for hexapod / quadruped legs.
   *
   * @param {number} Lcoxa   coxa length (shoulder to femur pivot)
   * @param {number} Lfemur  femur length
   * @param {number} Ltibia  tibia length
   * @param {{ x:number, y:number, z:number }} target  foot position in leg-root frame
   * @returns {{ coxa: number, femur: number, tibia: number } | null}
   */
  static solve3Joint(Lcoxa, Lfemur, Ltibia, target) {
    // Coxa rotates in horizontal plane to point toward target
    const coxa = Math.atan2(target.x, target.z)

    // After coxa rotation, project the remaining reach into a 2D sagittal plane
    const horizontalReach = Math.sqrt(target.x * target.x + target.z * target.z) - Lcoxa
    const verticalReach   = target.y   // signed: negative if foot is below hip

    const ik2 = IKSolver.solve2Joint(Lfemur, Ltibia, horizontalReach, verticalReach, false)
    if (!ik2) return null

    return { coxa, femur: ik2.hip, tibia: ik2.knee }
  }

  /**
   * True if the foot position is within the reachable workspace of a 2-joint leg.
   */
  static isReachable2(L1, L2, px, py) {
    const dist = Math.sqrt(px * px + py * py)
    return dist <= L1 + L2 && dist >= Math.abs(L1 - L2)
  }

  /**
   * True if the target is reachable by a 3-joint leg (coxa+femur+tibia).
   */
  static isReachable3(Lcoxa, Lfemur, Ltibia, target) {
    const hDist = Math.sqrt(target.x * target.x + target.z * target.z) - Lcoxa
    return IKSolver.isReachable2(Lfemur, Ltibia, hDist, target.y)
  }

  /**
   * Linear interpolation between two IK solutions (for smooth gait transitions).
   */
  static interpolate(a, b, t) {
    if (!a || !b) return b ?? a
    const lerp = (x, y, t) => x + (y - x) * t
    const keys = Object.keys(a)
    const result = {}
    for (const k of keys) result[k] = lerp(a[k], b[k], t)
    return result
  }
}
