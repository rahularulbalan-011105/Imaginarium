/**
 * Differential-drive motor model.
 *
 * Converts left/right PWM signals (−255 … +255) into linear and angular
 * velocity using a realistic motor equation:
 *
 *   rpm = Kv × voltage × |pwm| / 255
 *   wheelVelocity = (rpm / 60) × 2π × wheelRadius    [units/s]
 *   v     = (vL + vR) / 2                             [linear,  units/s]
 *   omega = (vR - vL) / wheelbase                     [angular, rad/s]
 *
 * All spatial quantities are in Three.js scene units, not SI metres.
 * Tune `Kv`, `voltage`, and `wheelRadius` to match your real robot;
 * the defaults are calibrated so full-throttle ≈ 6 scene-units/s.
 *
 * Per-side radius: DriveManager sets `radiusLeft` / `radiusRight` from the
 * Wheel parts actually on each side's motors (utils/wheels.js). Unset (null) →
 * `wheelRadius`, i.e. the original fixed behaviour.
 */
// The radius the default speed was tuned on (a default Wheel part maps to this).
export const DEFAULT_DRIVE_RADIUS = 0.40

export class DifferentialDrive {
  constructor({
    Kv          = 20,    // motor velocity constant (rpm/V)  — lower = slower
    voltage     = 7.4,   // supply voltage (V), e.g. 2S LiPo
    wheelRadius = DEFAULT_DRIVE_RADIUS,  // wheel radius in Three.js scene units
    wheelbase   = 3.0,   // axle-to-axle distance in scene units (overridden by DriveManager)
    radiusLeft  = null,  // per-side override (scene units); null → wheelRadius
    radiusRight = null,
    speedScaleLeft  = 1, // per-side gearbox × load factor (utils/gearMotor.js); 1 = unchanged
    speedScaleRight = 1,
  } = {}) {
    this.Kv          = Kv
    this.voltage     = voltage
    this.wheelRadius = wheelRadius
    this.wheelbase   = wheelbase
    this.radiusLeft  = radiusLeft
    this.radiusRight = radiusRight
    this.speedScaleLeft  = speedScaleLeft
    this.speedScaleRight = speedScaleRight
  }

  // Convert PWM (−255…+255) → wheel surface velocity (scene units/s)
  pwmToVelocity(pwm, radius = this.wheelRadius) {
    const rpm       = this.Kv * this.voltage * (Math.abs(pwm) / 255)
    const radPerSec = rpm * (2 * Math.PI) / 60
    return radPerSec * radius * Math.sign(pwm)
  }

  // Returns { v, omega, vL, vR } from left/right PWM signals
  compute(leftPWM, rightPWM) {
    const vL    = this.pwmToVelocity(leftPWM,  this.radiusLeft  ?? this.wheelRadius) * (this.speedScaleLeft  ?? 1)
    const vR    = this.pwmToVelocity(rightPWM, this.radiusRight ?? this.wheelRadius) * (this.speedScaleRight ?? 1)
    const v     = (vL + vR) / 2
    const omega = this.wheelbase > 0 ? (vR - vL) / this.wheelbase : 0
    return { v, omega, vL, vR }
  }
}
