// Balance controller. Reads the IMU ESTIMATE (not ground truth), the COM and
// the support polygon, and outputs body-frame FOOT-TARGET corrections. Those go
// through IK → servo torque → physics; the body is never repositioned directly.
//
// Attitude: if the body is tilted by a small rotation r (body frame), feet that
// stay put on the ground appear rotated by −r, so moving each foot target by
// +(r × nᵢ) levels the body. r is a PD term on the IMU roll/pitch.
// COM: shifting all stance targets toward the COM's offset from the support
// centroid moves the body back over its feet.
import * as THREE from 'three'

export const DEFAULT_BALANCE = {
  enabled:  true,
  kpAttitude: 0.9,   // fraction of measured tilt corrected per step
  kdAttitude: 0.08,  // s — rate damping
  kCom:       0.5,   // fraction of COM offset shifted
  maxCorrection: 1.5, // su per foot
  maxTilt:   0.6,    // rad — beyond this we don't try (fallen)
}

export class BalanceController {
  constructor(params = {}) {
    this.params = { ...DEFAULT_BALANCE, ...params }
    this._r = new THREE.Vector3()
    this._c = new THREE.Vector3()
    this._o = new THREE.Vector3()
    this.correctionMagnitude = 0
  }

  /**
   * @param targets   THREE.Vector3[] body-frame foot targets (modified in place)
   * @param neutrals  THREE.Vector3[] body-frame neutral foot positions
   * @param imu       { roll, pitch, rollRate, pitchRate }
   * @param axes      { forward, up, right }
   * @param comOffsetBody  THREE.Vector3|null  (COM − support centroid), body frame, horizontal
   * @param stance    boolean[] legs currently in stance
   */
  apply(targets, neutrals, imu, axes, comOffsetBody, stance) {
    const p = this.params
    this.correctionMagnitude = 0
    if (!p.enabled || !imu) return targets
    if (Math.abs(imu.roll) > p.maxTilt || Math.abs(imu.pitch) > p.maxTilt) return targets

    // Tilt as a body-frame rotation vector: roll about forward, pitch about right.
    const rollC  = p.kpAttitude * imu.roll  + p.kdAttitude * (imu.rollRate  || 0)
    const pitchC = p.kpAttitude * imu.pitch + p.kdAttitude * (imu.pitchRate || 0)
    const r = this._r.set(0, 0, 0).addScaledVector(axes.forward, rollC).addScaledVector(axes.right, pitchC)

    for (let i = 0; i < targets.length; i++) {
      const c = this._c.crossVectors(r, neutrals[i])
      // Only the vertical part matters for levelling; horizontal slip would fight the gait.
      const off = this._o.copy(axes.up).multiplyScalar(c.dot(axes.up))
      if (comOffsetBody && stance?.[i]) off.addScaledVector(comOffsetBody, p.kCom)
      const L = off.length()
      if (L > p.maxCorrection) off.multiplyScalar(p.maxCorrection / L)
      targets[i].add(off)
      this.correctionMagnitude = Math.max(this.correctionMagnitude, off.length())
    }
    return targets
  }
}
