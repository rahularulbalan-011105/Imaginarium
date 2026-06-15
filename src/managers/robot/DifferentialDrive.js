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
 */
export class DifferentialDrive {
  constructor({
    Kv          = 20,    // motor velocity constant (rpm/V)  — lower = slower
    voltage     = 7.4,   // supply voltage (V), e.g. 2S LiPo
    wheelRadius = 0.40,  // wheel radius in Three.js scene units
    wheelbase   = 3.0,   // axle-to-axle distance in scene units (overridden by DriveManager)
  } = {}) {
    this.Kv          = Kv
    this.voltage     = voltage
    this.wheelRadius = wheelRadius
    this.wheelbase   = wheelbase
  }

  // Convert PWM (−255…+255) → wheel surface velocity (scene units/s)
  pwmToVelocity(pwm) {
    const rpm       = this.Kv * this.voltage * (Math.abs(pwm) / 255)
    const radPerSec = rpm * (2 * Math.PI) / 60
    return radPerSec * this.wheelRadius * Math.sign(pwm)
  }

  // Returns { v, omega, vL, vR } from left/right PWM signals
  compute(leftPWM, rightPWM) {
    const vL    = this.pwmToVelocity(leftPWM)
    const vR    = this.pwmToVelocity(rightPWM)
    const v     = (vL + vR) / 2
    const omega = this.wheelbase > 0 ? (vR - vL) / this.wheelbase : 0
    return { v, omega, vL, vR }
  }
}
