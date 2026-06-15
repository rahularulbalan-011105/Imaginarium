import { SCENE_TO_M } from './EnvironmentConfig.js'

const Cd      = 0.85   // drag coefficient (blocky robot shape)
const MAX_V   = 40     // scene-units/s hard cap
const MAX_OM  = Math.PI * 8  // rad/s hard cap

/**
 * Physics integrator for the robot chassis.
 *
 * Accepts target velocities from the motor model and returns physically
 * realistic actual velocities after applying:
 *   1. Inertia — first-order lag based on mass (heavier = slower)
 *   2. Air drag — quadratic drag opposing motion
 *   3. Rolling friction — constant deceleration when coasting
 *   4. Wind — aerodynamic push from environment wind
 *
 * All velocities are in scene-units/s or rad/s.
 * Physics constants (gravity, airDensity, etc.) are passed in per-step
 * via the `env` argument so live environment changes take effect immediately.
 */
export class PhysicsIntegrator {
  /**
   * @param {object} p
   * @param {number} p.mass             total robot mass (kg)
   * @param {number} p.momentOfInertia  moment of inertia about Y (kg·m²)
   * @param {number} p.frontalArea      frontal cross-section for drag (m²)
   */
  constructor({ mass = 1, momentOfInertia = 0.5, frontalArea = 0.04 } = {}) {
    this.mass = Math.max(0.01,  mass)
    this.I    = Math.max(0.001, momentOfInertia)
    this.A    = Math.max(0.001, frontalArea)
    this._v     = 0   // linear velocity (scene units/s)
    this._omega = 0   // angular velocity (rad/s)
  }

  reset() { this._v = 0; this._omega = 0 }

  get currentV()     { return this._v }
  get currentOmega() { return this._omega }

  /**
   * Advance physics by dt seconds.
   *
   * @param {number} targetV     desired forward velocity from motor model (scene u/s)
   * @param {number} targetOmega desired yaw rate (rad/s)
   * @param {number} dt          frame delta time (s)
   * @param {number} yaw         current robot world-space heading (rad)
   * @param {object} env         { gravity, airDensity, rollingFriction, wind: {x,z,speed,turbulence} }
   * @returns {{ v: number, omega: number }}
   */
  step(targetV, targetOmega, dt, yaw, env) {
    const {
      gravity         = -9.80665,
      airDensity      = 1.225,
      rollingFriction = 0.015,
      wind            = { x: 0, z: -1, speed: 0, turbulence: 0 },
    } = env ?? {}

    const g = Math.abs(gravity)
    let v     = this._v
    let omega = this._omega

    // ── 1. Inertia (first-order lag toward target velocity) ───────────────────
    // τ_v = mass × 0.12 s/kg  →  0.5kg robot: τ=0.06 s (snappy)
    //                          →  5 kg robot:  τ=0.60 s (sluggish)
    const tau_v = Math.max(0.001, this.mass * 0.12)
    const tau_w = Math.max(0.001, this.I    * 0.10)
    const alphV = 1 - Math.exp(-dt / tau_v)
    const alphW = 1 - Math.exp(-dt / tau_w)
    v     += (targetV     - v)     * alphV
    omega += (targetOmega - omega) * alphW

    // ── 2. Air drag (quadratic, opposes motion) ───────────────────────────────
    if (airDensity > 0 && Math.abs(v) > 0.001) {
      const vMs       = v * SCENE_TO_M                               // scene u/s → m/s
      const dragForce = 0.5 * airDensity * Cd * this.A * vMs * Math.abs(vMs)  // N
      const dragAcc   = dragForce / (this.mass * SCENE_TO_M)         // scene u/s²
      v -= dragAcc * dt
    }
    // Angular drag (exponential decay — models rotational friction)
    if (airDensity > 0) {
      omega *= Math.exp(-0.25 * dt)
    }

    // ── 3. Rolling friction (constant deceleration when coasting) ─────────────
    if (rollingFriction > 0 && g > 0 && Math.abs(v) > 0.0001) {
      const rollAcc = rollingFriction * g / SCENE_TO_M               // scene u/s²
      const decel   = Math.sign(v) * rollAcc * dt
      const newAbs  = Math.abs(v) - Math.abs(decel)
      v = newAbs > 0 ? Math.sign(v) * newAbs : 0
    }

    // ── 4. Wind force ─────────────────────────────────────────────────────────
    if (airDensity > 0 && wind.speed > 0) {
      // Apply turbulence: random fluctuation around mean wind speed
      const turbFactor = 1 + wind.turbulence * (Math.random() - 0.5) * 0.4
      const wx = wind.x * wind.speed * turbFactor
      const wz = wind.z * wind.speed * turbFactor
      // Headwind component along robot's forward axis
      // Robot forward = (-sin(yaw), 0, -cos(yaw)) in world space
      const headwind  = -(wx * Math.sin(yaw) + wz * Math.cos(yaw))  // m/s
      const windForce = 0.5 * airDensity * Cd * this.A * headwind * Math.abs(headwind)
      const windAcc   = windForce / (this.mass * SCENE_TO_M)
      v += windAcc * dt
    }

    // ── 5. Clamp ──────────────────────────────────────────────────────────────
    this._v     = Math.max(-MAX_V,  Math.min(MAX_V,  v))
    this._omega = Math.max(-MAX_OM, Math.min(MAX_OM, omega))

    return { v: this._v, omega: this._omega }
  }
}
