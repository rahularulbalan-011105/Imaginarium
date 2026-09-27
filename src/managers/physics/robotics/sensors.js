// Simulated sensors. Every reading is derived from the PHYSICS state (body
// velocities, joint angles, contact impulses) — never from commanded values.
// Noise is seeded so runs (and tests) are deterministic.
import * as THREE from 'three'

export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Standard normal via Box–Muller on a seeded uniform source. */
export function gaussian(rand) {
  let u = 0; while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

// ── IMU ──────────────────────────────────────────────────────────────────────
export const DEFAULT_IMU = {
  rate:        200,     // Hz (sample-and-hold between samples)
  accelNoise:  0.05,    // m/s² (1σ)
  gyroNoise:   0.005,   // rad/s (1σ)
  accelBias:   0,       // m/s² constant per axis
  gyroBias:    0.002,   // rad/s constant per axis
  gyroDrift:   0.0005,  // rad/s/√s random-walk on the gyro bias
  filterAlpha: 0.98,    // complementary filter (gyro vs accel tilt)
  seed:        1,
}

/**
 * 6-DOF IMU (accelerometer + gyro) with an onboard complementary attitude filter,
 * like an MPU-6050/BNO-style part. Inputs are the physics body's state; the
 * accelerometer measures specific force (a − g) in the sensor frame.
 * All outputs are SI (m/s², rad/s, rad).
 */
export class IMUSensor {
  constructor(spec = {}) {
    this.spec = { ...DEFAULT_IMU, ...spec }
    this._rand = mulberry32(this.spec.seed)
    this._acc = 0
    this._prevVel = null
    this._driftBias = new THREE.Vector3()
    this._q = new THREE.Quaternion()      // world→ nothing; scratch
    this._v = new THREE.Vector3()
    this._a = new THREE.Vector3()
    this.accel = new THREE.Vector3(0, 9.81, 0)
    this.gyro  = new THREE.Vector3()
    this.roll = 0; this.pitch = 0; this.yaw = 0
    this.trueRoll = 0; this.truePitch = 0; this.trueYaw = 0
    this._init = false
  }

  /**
   * @param h        step (s)
   * @param q        body orientation (THREE.Quaternion, world)
   * @param velSI    velocity of the mount point (m/s, world THREE.Vector3)
   * @param angVel   angular velocity (rad/s, world THREE.Vector3)
   * @param gravSI   gravity vector (m/s², world)
   * @param axes     { forward, up, right } body-frame unit vectors
   */
  update(h, q, velSI, angVel, gravSI, axes) {
    const s = this.spec
    const qInv = this._q.copy(q).invert()
    const a = this._a
    if (this._prevVel) a.copy(velSI).sub(this._prevVel).divideScalar(Math.max(1e-9, h))
    else a.set(0, 0, 0)
    this._prevVel = (this._prevVel ?? new THREE.Vector3()).copy(velSI)

    // Bias random walk runs continuously (it is a property of the part).
    const walk = s.gyroDrift * Math.sqrt(h)
    this._driftBias.x += walk * gaussian(this._rand)
    this._driftBias.y += walk * gaussian(this._rand)
    this._driftBias.z += walk * gaussian(this._rand)

    this._acc += h
    if (this._init && this._acc < 1 / s.rate) return false
    const dtS = this._init ? this._acc : h
    this._acc = 0

    // Specific force (what an accelerometer reads) in the sensor frame.
    const f = this._v.copy(a).sub(gravSI).applyQuaternion(qInv)
    this.accel.set(
      f.x + s.accelBias + s.accelNoise * gaussian(this._rand),
      f.y + s.accelBias + s.accelNoise * gaussian(this._rand),
      f.z + s.accelBias + s.accelNoise * gaussian(this._rand),
    )
    const w = this._v.copy(angVel).applyQuaternion(qInv)
    this.gyro.set(
      w.x + s.gyroBias + this._driftBias.x + s.gyroNoise * gaussian(this._rand),
      w.y + s.gyroBias + this._driftBias.y + s.gyroNoise * gaussian(this._rand),
      w.z + s.gyroBias + this._driftBias.z + s.gyroNoise * gaussian(this._rand),
    )

    // Attitude in the robot's own axes: roll about forward, pitch about right.
    const fwd = axes.forward, up = axes.up, right = axes.right
    const ax = this.accel.dot(right), ay = this.accel.dot(up), az = this.accel.dot(fwd)
    const accRoll  = Math.atan2(-ax, ay)
    const accPitch = Math.atan2(az, Math.hypot(ax, ay))
    const gRoll = this.gyro.dot(fwd), gPitch = this.gyro.dot(right), gYaw = this.gyro.dot(up)
    if (!this._init) {
      this.roll = accRoll; this.pitch = accPitch; this.yaw = 0; this._init = true
    } else {
      const k = s.filterAlpha
      this.roll  = k * (this.roll  + gRoll  * dtS) + (1 - k) * accRoll
      this.pitch = k * (this.pitch + gPitch * dtS) + (1 - k) * accPitch
      this.yaw  += gYaw * dtS   // 6-DOF IMU: yaw is gyro-integrated and drifts
    }
    this.rollRate = gRoll; this.pitchRate = gPitch; this.yawRate = gYaw

    // Ground truth (for telemetry/validation only — controllers use the estimate).
    const upW = this._v.copy(up).applyQuaternion(q)
    const fwW = this._a.copy(fwd).applyQuaternion(q)
    this.truePitch = Math.asin(Math.max(-1, Math.min(1, fwW.y)))
    const rightW = new THREE.Vector3().crossVectors(fwW, upW)
    this.trueRoll = Math.asin(Math.max(-1, Math.min(1, -rightW.y)))
    this.trueYaw = Math.atan2(-fwW.x, -fwW.z)
    return true
  }

  read() {
    return {
      accel: { x: this.accel.x, y: this.accel.y, z: this.accel.z },
      gyro:  { x: this.gyro.x, y: this.gyro.y, z: this.gyro.z },
      roll: this.roll, pitch: this.pitch, yaw: this.yaw,
    }
  }
}

// ── Joint encoder ────────────────────────────────────────────────────────────
export const DEFAULT_ENCODER = {
  resolution: 4096,   // counts per revolution
  noise:      0.001,  // rad (1σ)
  rate:       500,    // Hz
  seed:       7,
}

export class EncoderSensor {
  constructor(spec = {}) {
    this.spec = { ...DEFAULT_ENCODER, ...spec }
    this._rand = mulberry32(this.spec.seed)
    this._acc = Infinity
    this.angle = 0
    this.velocity = 0
    this._prev = null
  }
  update(h, trueAngle) {
    const s = this.spec
    this._acc += h
    if (this._acc < 1 / s.rate) return false
    const dt = Number.isFinite(this._acc) ? this._acc : h
    this._acc = 0
    const lsb = (2 * Math.PI) / Math.max(1, s.resolution)
    const noisy = trueAngle + s.noise * gaussian(this._rand)
    const q = Math.round(noisy / lsb) * lsb
    this.velocity = this._prev == null ? 0 : (q - this._prev) / dt
    this._prev = q
    this.angle = q
    return true
  }
  read() { return { angle: this.angle, velocity: this.velocity } }
}
