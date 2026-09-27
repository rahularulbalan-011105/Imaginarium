// Generic serial-chain kinematics (any number of revolute / prismatic joints),
// using the Product-of-Exponentials formulation (space frame):
//
//   T(θ) = e^[S1]θ1 · e^[S2]θ2 · … · e^[Sn]θn · M
//
// Each screw S_i is defined by the joint's axis a_i and a point p_i on it, both
// expressed in the chain's base frame at the zero configuration (the authored
// pose). M is the end-effector (foot) pose at zero. Nothing here assumes a
// particular leg layout — a 1-DOF paddle, a 3-DOF spider leg and a 6-DOF arm all
// use the same code.
import * as THREE from 'three'

export const JOINT_REVOLUTE  = 'revolute'
export const JOINT_PRISMATIC = 'prismatic'

const _q = new THREE.Quaternion()

/**
 * @param joints [{ type, axis:{x,y,z}, point:{x,y,z}, min, max }] base→tip order
 * @param tip    end-effector point at zero configuration (base frame)
 */
export class KinematicChain {
  constructor(joints, tip, tipQuat = null) {
    this.joints = joints.map(j => ({
      type:  j.type === JOINT_PRISMATIC ? JOINT_PRISMATIC : JOINT_REVOLUTE,
      axis:  new THREE.Vector3(j.axis.x, j.axis.y, j.axis.z).normalize(),
      point: new THREE.Vector3(j.point.x, j.point.y, j.point.z),
      min:   Number.isFinite(j.min) ? j.min : -Infinity,
      max:   Number.isFinite(j.max) ? j.max :  Infinity,
      id:    j.id,
    }))
    this.tip = new THREE.Vector3(tip.x, tip.y, tip.z)
    this.tipQuat = tipQuat ? new THREE.Quaternion(tipQuat.x, tipQuat.y, tipQuat.z, tipQuat.w) : new THREE.Quaternion()
    this.dof = this.joints.length
    // Scratch (no per-call allocation in the hot path).
    this._axes = this.joints.map(() => new THREE.Vector3())
    this._pts  = this.joints.map(() => new THREE.Vector3())
    this._R = new THREE.Quaternion()
    this._t = new THREE.Vector3()
    this._tmp = new THREE.Vector3()
  }

  /**
   * Forward kinematics. Returns the tip position (and orientation) for joint
   * values θ, and fills the current axis/point of every joint (for Jacobians).
   */
  fk(theta, outPos = new THREE.Vector3(), outQuat = null) {
    // Accumulate g = e^[S1]θ1 … e^[Si-1]θi-1 as (R, t): x ↦ R x + t
    const R = this._R.identity(), t = this._t.set(0, 0, 0)
    for (let i = 0; i < this.dof; i++) {
      const j = this.joints[i]
      // Current axis/point of joint i = previous transform applied to its zero screw.
      this._axes[i].copy(j.axis).applyQuaternion(R)
      this._pts[i].copy(j.point).applyQuaternion(R).add(t)
      const th = theta[i] || 0
      if (j.type === JOINT_REVOLUTE) {
        // e^[S]θ for a revolute screw = rotation by θ about axis through point.
        _q.setFromAxisAngle(j.axis, th)
        // g' = g · (rot about zero-axis through zero-point)
        //    x ↦ R( q(x − p) + p ) + t  =  (R q) x + R(p − q p) + t
        const p = this._tmp.copy(j.point)
        const qp = p.clone().applyQuaternion(_q)
        p.sub(qp).applyQuaternion(R)
        t.add(p)
        R.multiply(_q)
      } else {
        // Prismatic: translate by θ along the zero-axis.
        t.add(this._tmp.copy(j.axis).multiplyScalar(th).applyQuaternion(R))
      }
    }
    outPos.copy(this.tip).applyQuaternion(R).add(t)
    if (outQuat) outQuat.copy(R).multiply(this.tipQuat)
    return outPos
  }

  /** Position Jacobian (3×n, column-major array of Vector3) at the last fk() call. */
  _jacobianPos(tipPos, out) {
    for (let i = 0; i < this.dof; i++) {
      const col = out[i] || (out[i] = new THREE.Vector3())
      if (this.joints[i].type === JOINT_REVOLUTE) col.crossVectors(this._axes[i], this._tmp.copy(tipPos).sub(this._pts[i]))
      else col.copy(this._axes[i])
    }
    return out
  }

  clampToLimits(theta) {
    let clamped = false
    for (let i = 0; i < this.dof; i++) {
      const j = this.joints[i]
      if (theta[i] < j.min) { theta[i] = j.min; clamped = true }
      if (theta[i] > j.max) { theta[i] = j.max; clamped = true }
    }
    return clamped
  }

  /**
   * Inverse kinematics by damped least squares (Levenberg–Marquardt style):
   *   Δθ = Jᵀ (J Jᵀ + λ² I)⁻¹ e
   * with joint-limit clamping every iteration. The task is the tip position
   * (3-D) or, when `opts.orientation` (a quaternion) is given, position +
   * orientation (6-D; orientation error weighted by `opts.orientationWeight`).
   *
   * Returns { theta, status, error, orientationError, iterations } where status:
   *   'ok'          reached within tolerance
   *   'limited'     best reachable pose, a joint limit is binding
   *   'unreachable' target outside the reachable workspace (best effort returned)
   *   'singular'    Jacobian degenerate at the solution
   *   'invalid'     non-finite target
   */
  ik(target, seed, opts = {}) {
    const tol = opts.tolerance ?? 1e-3
    const angTol = opts.orientationTolerance ?? 1e-2
    const maxIter = opts.maxIterations ?? 40
    const lambda = opts.damping ?? 0.05
    const wOri = opts.orientationWeight ?? 1
    const n = this.dof
    const theta = new Float64Array(n)
    for (let i = 0; i < n; i++) theta[i] = seed?.[i] ?? 0
    const oriTarget = opts.orientation
      ? new THREE.Quaternion(opts.orientation.x, opts.orientation.y, opts.orientation.z, opts.orientation.w).normalize()
      : null
    if (!target || !Number.isFinite(target.x + target.y + target.z)) {
      return { theta: Array.from(theta), status: 'invalid', error: Infinity, orientationError: 0, iterations: 0 }
    }
    const m = oriTarget ? 6 : 3
    const tgt = new THREE.Vector3(target.x, target.y, target.z)
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), qErr = new THREE.Quaternion()
    const e = new Float64Array(m)
    const Jl = [], J = Array.from({ length: n }, () => new Float64Array(m))
    let err = Infinity, oErr = 0, it = 0, limited = false, singular = false

    const oriError = (out) => {   // axis-angle of q_target · q_current⁻¹
      qErr.copy(oriTarget).multiply(quat.clone().invert())
      if (qErr.w < 0) { qErr.x = -qErr.x; qErr.y = -qErr.y; qErr.z = -qErr.z; qErr.w = -qErr.w }
      const sn = Math.hypot(qErr.x, qErr.y, qErr.z)
      const ang = 2 * Math.atan2(sn, qErr.w)
      const k = sn > 1e-9 ? ang / sn : 2
      out[3] = qErr.x * k * wOri; out[4] = qErr.y * k * wOri; out[5] = qErr.z * k * wOri
      return ang
    }

    for (; it < maxIter; it++) {
      this.fk(theta, pos, oriTarget ? quat : null)
      e[0] = tgt.x - pos.x; e[1] = tgt.y - pos.y; e[2] = tgt.z - pos.z
      err = Math.hypot(e[0], e[1], e[2])
      oErr = oriTarget ? oriError(e) : 0
      if (err < tol && oErr < angTol) break
      this._jacobianPos(pos, Jl)
      for (let i = 0; i < n; i++) {
        J[i][0] = Jl[i].x; J[i][1] = Jl[i].y; J[i][2] = Jl[i].z
        if (m === 6) {
          const rev = this.joints[i].type === JOINT_REVOLUTE
          J[i][3] = rev ? this._axes[i].x * wOri : 0
          J[i][4] = rev ? this._axes[i].y * wOri : 0
          J[i][5] = rev ? this._axes[i].z * wOri : 0
        }
      }
      // A = J Jᵀ + λ² I (m×m), solve A y = e.
      const A = Array.from({ length: m }, () => new Float64Array(m + 1))
      let trace = 0
      for (let r = 0; r < m; r++) {
        for (let c = 0; c < m; c++) { let sum = 0; for (let i = 0; i < n; i++) sum += J[i][r] * J[i][c]; A[r][c] = sum }
        trace += A[r][r]
      }
      const l2 = lambda * lambda * Math.max(1e-6, trace / m)
      for (let r = 0; r < m; r++) { A[r][r] += l2; A[r][m] = e[r] }
      const y = solveAugmented(A, m)
      if (!y) { singular = true; break }
      let maxStep = 0
      for (let i = 0; i < n; i++) {
        let d = 0; for (let r = 0; r < m; r++) d += J[i][r] * y[r]
        theta[i] += d
        maxStep = Math.max(maxStep, Math.abs(d))
      }
      if (this.clampToLimits(theta)) limited = true
      if (maxStep < 1e-7) break   // converged to a best-effort point
    }
    this.fk(theta, pos, oriTarget ? quat : null)
    err = pos.distanceTo(tgt)
    oErr = oriTarget ? oriError(e) : 0
    let status = 'ok'
    if (err >= tol || oErr >= angTol) status = singular ? 'singular' : limited ? 'limited' : 'unreachable'
    return { theta: Array.from(theta), status, error: err, orientationError: oErr, iterations: it }
  }

  /** Maximum reach from the first joint (useful to reject impossible targets early). */
  reach() {
    let r = 0, prev = this.joints[0]?.point
    for (let i = 1; i < this.dof; i++) { r += this.joints[i].point.distanceTo(prev); prev = this.joints[i].point }
    return r + this.tip.distanceTo(prev ?? this.tip)
  }
}

/** Gaussian elimination with partial pivoting on an m×(m+1) augmented matrix. */
function solveAugmented(A, m) {
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    if (Math.abs(A[piv][c]) < 1e-18) return null
    if (piv !== c) { const t = A[c]; A[c] = A[piv]; A[piv] = t }
    for (let r = c + 1; r < m; r++) {
      const f = A[r][c] / A[c][c]
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k]
    }
  }
  const x = new Float64Array(m)
  for (let r = m - 1; r >= 0; r--) {
    let sum = A[r][m]
    for (let k = r + 1; k < m; k++) sum -= A[r][k] * x[k]
    x[r] = sum / A[r][r]
  }
  return x
}
