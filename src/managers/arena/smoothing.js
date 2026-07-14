import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// smoothing.js — frame-rate-independent, critically-damped interpolation helpers.
//
// smoothDamp is the Unity-style critically damped spring: it eases toward a
// target with NO overshoot and NO snapping, and — crucially — the result is the
// same whether the game runs at 30 or 144 fps (dt-correct). All arena camera and
// rig motion routes through these so nothing jitters or pops.
// ─────────────────────────────────────────────────────────────────────────────

// Scalar critically damped spring. `state` = { v } (mutated velocity carrier).
export function smoothDampScalar(current, target, state, smoothTime, dt, maxSpeed = Infinity) {
  smoothTime = Math.max(0.0001, smoothTime)
  const omega = 2 / smoothTime
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  let change = current - target
  const maxChange = maxSpeed * smoothTime
  change = Math.max(-maxChange, Math.min(maxChange, change))
  const t = target
  const temp = (state.v + omega * change) * dt
  state.v = (state.v - omega * temp) * exp
  let out = t + (change + temp) * exp
  // Prevent overshoot past the target.
  if ((target - current > 0) === (out > target)) { out = target; state.v = (out - target) / dt }
  return out
}

// Angle critically damped spring (radians, shortest-path wrapped). Unrolls the
// wrapped target so the spring always takes the short way around, then rewraps.
export function smoothDampAngle(current, target, state, smoothTime, dt) {
  const unwrapped = current + wrapAngle(target - current)
  return wrapAngle(smoothDampScalar(current, unwrapped, state, smoothTime, dt))
}

// Vector3 critically damped spring. `state` carries a per-axis velocity Vector3.
export function smoothDampVec3(current, target, state, smoothTime, dt, out = new THREE.Vector3()) {
  out.x = smoothDampScalar(current.x, target.x, state.vx, smoothTime, dt)
  out.y = smoothDampScalar(current.y, target.y, state.vy, smoothTime, dt)
  out.z = smoothDampScalar(current.z, target.z, state.vz, smoothTime, dt)
  return out
}

export function makeVec3DampState() {
  return { vx: { v: 0 }, vy: { v: 0 }, vz: { v: 0 } }
}

// Wrap an angle to (-PI, PI].
export function wrapAngle(a) {
  a = a % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return a
}

// Exponential smoothing (dt-correct lerp). factor ~ 1 - exp(-dt/tau).
export function expSmooth(current, target, tau, dt) {
  const k = 1 - Math.exp(-dt / Math.max(0.0001, tau))
  return current + (target - current) * k
}
