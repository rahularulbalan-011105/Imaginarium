// Hobby/robot servo actuator model (SI units: rad, rad/s, N·m, kg·m², V, A, W).
//
//   commanded angle
//     → setpoint profiler      (max velocity / max acceleration slew)
//     → PD position loop       (spring-damper, torque-clamped below, then solved
//                               implicitly by the physics engine's joint solver)
//     → deadband               (servo electronics ignore tiny errors → motor off)
//     → DC motor limits        (torque-speed line: τ ≤ τ_stall·(1 − |ω|/ω_noload),
//                               both scaled by bus voltage; thermal + supply derate)
//     → gear backlash          (reversal must take up the slack before torque flows)
//     → gear friction/damping  (Coulomb + viscous, never reverses the motion)
//     → OUTPUT TORQUE          applied between parent and child links by the caller.
//
// The joint angle is NEVER set directly. If the load needs more torque than the
// servo can make, the output saturates, the joint slows, and the servo stalls.
//
// Electrical side (PWM H-bridge, power-conserving):
//   winding current  I_m = |τ| / Kt                (Kt from datasheet stall point)
//   copper loss      I_m² R_w                      (R_w = V_nom / I_stall)
//   motor mech power τω/η (motoring) or τωη (back-driven)
//   supply current   I_s = I_idle + max(0, P_elec) / V_bus

import { ThermalModel } from './ThermalModel.js'

const DEG = Math.PI / 180

// Datasheet-derived presets. torque = stall torque at nominalVoltage.
export const SERVO_PRESETS = {
  sg90:   { label: 'SG90 (plastic, 1.8 kg·cm)',  maxTorque: 0.176, maxVelocity: 10.5, nominalVoltage: 4.8, stallCurrent: 0.65, idleCurrent: 0.01, rotorInertia: 4e-4,   backlash: 1.0 * DEG, efficiency: 0.65, gearFriction: 0.004 },
  mg90s:  { label: 'MG90S (metal, 2.2 kg·cm)',   maxTorque: 0.216, maxVelocity: 10.5, nominalVoltage: 4.8, stallCurrent: 0.70, idleCurrent: 0.01, rotorInertia: 4e-4,   backlash: 0.6 * DEG, efficiency: 0.72, gearFriction: 0.004 },
  mg996r: { label: 'MG996R (metal, 11 kg·cm)',   maxTorque: 1.08,  maxVelocity: 7.5,  nominalVoltage: 6.0, stallCurrent: 2.5,  idleCurrent: 0.01, rotorInertia: 1.2e-3, backlash: 0.5 * DEG, efficiency: 0.75, gearFriction: 0.02  },
  ds3218: { label: 'DS3218 (metal, 21 kg·cm)',   maxTorque: 2.06,  maxVelocity: 8.7,  nominalVoltage: 6.8, stallCurrent: 3.0,  idleCurrent: 0.02, rotorInertia: 1.5e-3, backlash: 0.4 * DEG, efficiency: 0.78, gearFriction: 0.03  },
}
export const DEFAULT_SERVO_PRESET = 'mg90s'

export function resolveServoSpec(spec = {}) {
  const base = SERVO_PRESETS[spec.preset] ?? SERVO_PRESETS[DEFAULT_SERVO_PRESET]
  const s = {
    maxAcceleration: 400,         // rad/s²  setpoint slew
    deadband:        0.45 * DEG,  // ≈ 5 µs of a 1000–2000 µs pulse
    damping:         0.0005,      // N·m·s/rad viscous (output side)
    minAngle:        -Math.PI / 2,
    maxAngle:         Math.PI / 2,
    ...base,
    ...spec,
  }
  // PD gains: a hobby servo's proportional band is ~10° (full torque beyond it);
  // damping ≈ critical for the geared-rotor inertia.
  if (!(s.kp > 0)) s.kp = s.maxTorque / ((s.proportionalBand ?? 10) * DEG)
  if (!(s.kd >= 0)) s.kd = 2 * Math.sqrt(s.kp * Math.max(1e-7, s.rotorInertia))
  s.windingResistance = s.nominalVoltage / Math.max(1e-6, s.stallCurrent)
  s.kt = s.maxTorque / Math.max(1e-6, s.stallCurrent - s.idleCurrent)
  return s
}

export class ServoActuator {
  constructor(spec = {}, thermalSpec = {}) {
    this.spec = resolveServoSpec(spec)
    this.thermal = new ThermalModel(thermalSpec)
    this.reset()
  }

  reset() {
    this.target      = 0       // commanded joint angle (rad, 0 = authored pose)
    this.setpoint    = null    // profiled setpoint
    this.setpointVel = 0
    this.angle       = 0       // last measured
    this.velocity    = 0
    this.acceleration = 0
    this.torque      = 0       // output torque this step (N·m)
    this.torqueLimit = 0
    this.current     = 0       // supply current (A)
    this.windingCurrent = 0
    this.power       = 0       // electrical power (W)
    this.mechPower   = 0
    this.energy      = 0       // J
    this.stalled     = false
    this._stallTimer = 0
    this.saturated   = false
    this.limp        = false
    this._gap        = 0       // backlash: motor-side minus output angle (rad)
    this._engaged    = 0       // +1 / −1 / 0 — side of the slack currently loaded
    this._spAccel    = 0
    this._accFilt    = 0
    this.friction    = 0
    this.motorTorque = 0
    this.motor       = { active: false, targetPos: 0, targetVel: 0, stiffness: 0, damping: 0 }
    this.thermal.reset()
  }

  setTarget(rad) {
    const s = this.spec
    this.target = Math.min(s.maxAngle, Math.max(s.minAngle, rad))
  }

  /**
   * Setpoint follower: critically-damped 2nd-order tracking of the commanded
   * angle, with the acceleration clamped to maxAcceleration and the velocity to
   * the motor's no-load speed at the present bus voltage. Unlike a bang-bang
   * trapezoid it tracks a continuously moving target (IK every step) smoothly.
   */
  _profile(h, speedScale = 1) {
    const s = this.spec
    if (this.setpoint == null) { this.setpoint = this.angle; this.setpointVel = 0 }
    const vmax = s.maxVelocity * Math.max(0.05, speedScale) * 0.9
    const wc = s.profileBandwidth ?? 60          // rad/s
    const d = this.target - this.setpoint
    let a = wc * wc * d - 2 * wc * this.setpointVel
    a = Math.max(-s.maxAcceleration, Math.min(s.maxAcceleration, a))
    let v = this.setpointVel + a * h
    v = Math.max(-vmax, Math.min(vmax, v))
    this._spAccel = (v - this.setpointVel) / h
    this.setpointVel = v
    this.setpoint += v * h
    if (Math.abs(this.target - this.setpoint) < 1e-5 && Math.abs(v) < 1e-3) { this.setpoint = this.target; this.setpointVel = 0 }
  }

  /**
   * One control/physics step.
   * @param h        timestep (s)
   * @param theta    measured joint angle (rad)
   * @param omega    measured joint angular velocity (rad/s)
   * @param inertia  effective joint inertia (kg·m²) — only used to clamp friction
   * @param env      { busVoltage, supplyScale, enabled }
   * @returns the servo's output torque this step (N·m).
   *
   * The PD law's torque is clamped to what the motor can physically produce, and
   * the result is expressed as a spring-damper command (this.motor) that the
   * physics engine's joint solver applies IMPLICITLY — that solver knows the true
   * articulated effective mass (whole leg, ground contact), which is what keeps a
   * stiff servo stable on light links. The spring target is back-solved so that
   *   kp·(θ* − θ) + kd·(ω_sp − ω) = τ_clamped
   * i.e. the servo can never push harder than its torque limit: an over-loaded
   * joint sags and stalls instead of being driven to the target.
   */
  update(h, theta, omega, inertia, env = {}) {
    const s = this.spec
    const V = env.busVoltage ?? s.nominalVoltage
    const supplyScale = env.supplyScale ?? 1
    const enabled = env.enabled !== false

    this.acceleration = (omega - this.velocity) / Math.max(1e-9, h)
    this._accFilt += (this.acceleration - this._accFilt) * (1 - Math.exp(-h / 0.02))
    this.angle = theta
    this.velocity = omega
    const vScale = Math.max(0, V / s.nominalVoltage)
    this._profile(h, Math.min(1, vScale))

    const tauStall = s.maxTorque * vScale * this.thermal.derate() * Math.max(0, supplyScale)
    const wNoLoad  = Math.max(1e-6, s.maxVelocity * vScale)
    this.limp = !enabled || tauStall <= 0

    // ── PD position loop ──────────────────────────────────────────────────────
    let tau = 0
    let active = false
    const settled = Math.abs(this.target - this.setpoint) < 1e-6
    const inDeadband = settled && Math.abs(this.target - theta) < s.deadband
    if (!this.limp && !inDeadband) {
      tau = s.kp * (this.setpoint - theta) + s.kd * (this.setpointVel - omega)
      active = true
    }

    // ── DC motor torque-speed limit (+ rotor acceleration budget) ─────────────
    let limit
    if (tau * omega > 0) limit = tauStall * Math.max(0, 1 - Math.abs(omega) / wNoLoad) // motoring
    else                 limit = tauStall                                              // braking
    // Part of the motor's torque accelerates its own geared rotor, which turns
    // with the OUTPUT — so charge the measured (filtered) joint acceleration.
    limit = Math.max(0, limit - s.rotorInertia * Math.abs(this._accFilt))
    this.torqueLimit = limit
    this.saturated = active && Math.abs(tau) >= limit - 1e-12
    tau = Math.max(-limit, Math.min(limit, tau))

    // ── Gear backlash ─────────────────────────────────────────────────────────
    // Reversing the drive direction first spins the motor across the slack at
    // no-load speed; no torque reaches the output until the far side engages.
    if (s.backlash > 0 && tau !== 0) {
      const dir = Math.sign(tau)
      if (this._engaged !== dir) {
        const half = s.backlash / 2
        this._gap += dir * wNoLoad * h
        if (dir * this._gap >= half) { this._gap = dir * half; this._engaged = dir }
        else { tau = 0; active = false }
      }
    }

    // ── Motor command for the joint solver ────────────────────────────────────
    const m = this.motor
    if (active && tau !== 0) {
      m.active = true
      m.stiffness = s.kp
      m.damping = s.kd
      m.targetVel = this.setpointVel
      m.targetPos = theta + (tau - s.kd * (this.setpointVel - omega)) / s.kp
    } else {
      m.active = false; m.stiffness = 0; m.damping = 0; m.targetVel = 0; m.targetPos = theta
    }

    // ── Output-side friction (gear Coulomb + viscous), applied explicitly by the
    // caller; clamped so it can stop the joint but never drive it backwards.
    const I = Math.max(1e-7, inertia || 0)
    const fr = s.gearFriction * Math.tanh(omega / 0.05) + s.damping * omega
    const frMax = I * Math.abs(omega) / h
    this.friction = Math.max(-frMax, Math.min(frMax, fr))

    // ── Electrical & thermal (from the motor torque actually commanded) ───────
    const Im = Math.abs(tau) / s.kt
    const pMech = tau * omega
    const pMotor = pMech >= 0 ? pMech / s.efficiency : pMech * s.efficiency
    const pElec = Im * Im * s.windingResistance + pMotor
    const gearLoss = pMech >= 0 ? pMech * (1 / s.efficiency - 1) : -pMech * (1 - s.efficiency)
    this.windingCurrent = Im
    this.current = this.limp ? 0 : s.idleCurrent + Math.max(0, pElec) / Math.max(0.5, V)
    this.power = this.current * V
    this.mechPower = pMech
    this.energy += this.power * h
    this.thermal.step(h, Im * Im * s.windingResistance + Math.max(0, gearLoss))

    // ── Stall detection ───────────────────────────────────────────────────────
    const blocked = this.saturated && Math.abs(omega) < 0.05 * wNoLoad && Math.abs(this.target - theta) > 3 * s.deadband
    this._stallTimer = blocked ? this._stallTimer + h : 0
    this.stalled = this._stallTimer > 0.25

    this.motorTorque = tau
    this.torque = tau - this.friction
    return this.torque
  }

  get temperature() { return this.thermal.temperature }
  get overheated()  { return this.thermal.overheated }
}

/** Arduino servo degrees (0–180, 90 = authored pose) ↔ joint radians. */
export const servoDegToRad = (deg) => (Math.min(180, Math.max(0, Number(deg) || 0)) - 90) * DEG
export const radToServoDeg = (rad) => rad / DEG + 90
