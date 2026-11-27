import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// motionSim — what an MPU6050 (accelerometer + gyroscope) on a scene part feels.
//
// Sampled once per simulation frame from the part's world transform:
//   accel = (linear acceleration + 1 g "up") expressed in the chip's axes, in g
//   gyro  = the part's angular velocity in the chip's axes, in °/s
// A part sitting still and flat therefore reads (0, 0, +1 g) and no rotation —
// exactly like the real board on a desk. Tilt it in the editor, or let a robot
// drive / fall over in the physics sim, and the readings follow.
//
// Chip axes on the GY-521 model (createMpu6050Group): the board lies in the
// local XZ plane with its header at +Z. Chip X = local +X, chip Y = local −Z,
// chip Z = local +Y (out of the component side). Same as the silk arrows.
// Scene scale for motion: 1 scene unit = 5 cm (as the ultrasonic sim uses).
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_M = 0.05
const G = 9.80665
const toChip = (v) => ({ x: v.x, y: -v.z, z: v.y })

export function createMotionTracker() {
  const prev = new Map()   // id → { t, pos, vel, quat, acc: {x,y,z}, gyro: {x,y,z} }
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3()
  const _inv = new THREE.Quaternion(), _dq = new THREE.Quaternion()

  /** { accel: {x,y,z} g, gyro: {x,y,z} °/s } for a part's 3D object, or null. */
  return function sample(id, obj3d, nowMs) {
    if (!obj3d) return null
    obj3d.updateMatrixWorld(true)
    obj3d.getWorldQuaternion(_q)
    obj3d.getWorldPosition(_p)
    const s = prev.get(id)
    const pos = _p.clone().multiplyScalar(UNIT_M)          // metres
    const quat = _q.clone()
    // Gravity reaction (+1 g up) in the part's local frame.
    _inv.copy(quat).invert()
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_inv)
    if (!s) {
      const a = toChip(up)
      prev.set(id, { t: nowMs, pos, vel: new THREE.Vector3(), quat, acc: a, gyro: { x: 0, y: 0, z: 0 } })
      return { accel: a, gyro: { x: 0, y: 0, z: 0 } }
    }
    const dt = (nowMs - s.t) / 1000
    if (!(dt > 0.004)) return { accel: s.acc, gyro: s.gyro }   // same frame: reuse
    // Linear acceleration from the change in velocity (m/s²), in local axes.
    const vel = pos.clone().sub(s.pos).divideScalar(dt)
    const lin = vel.clone().sub(s.vel).divideScalar(dt).applyQuaternion(_inv)
    if (dt > 0.25) lin.set(0, 0, 0)                          // paused / first run frame: no spike
    const aRaw = toChip(up.clone().add(lin.divideScalar(G)))
    // Body-frame angular velocity: Δq = q_prev⁻¹ · q_now → axis · angle / dt.
    _dq.copy(s.quat).invert().multiply(quat)
    if (_dq.w < 0) { _dq.x = -_dq.x; _dq.y = -_dq.y; _dq.z = -_dq.z; _dq.w = -_dq.w }
    const ang = 2 * Math.acos(Math.min(1, _dq.w))
    const sinH = Math.sqrt(Math.max(0, 1 - _dq.w * _dq.w))
    const w = sinH > 1e-6 && dt <= 0.25
      ? new THREE.Vector3(_dq.x / sinH, _dq.y / sinH, _dq.z / sinH).multiplyScalar((ang / dt) * 180 / Math.PI)
      : new THREE.Vector3()
    const gRaw = toChip(w)
    // Light smoothing: frame-to-frame differences are noisy (the real chip's
    // digital low-pass filter does the same job).
    const k = 0.35, clampG = (v) => Math.max(-16, Math.min(16, v)), clampW = (v) => Math.max(-2000, Math.min(2000, v))
    const acc = {
      x: clampG(s.acc.x + (aRaw.x - s.acc.x) * k), y: clampG(s.acc.y + (aRaw.y - s.acc.y) * k), z: clampG(s.acc.z + (aRaw.z - s.acc.z) * k),
    }
    const gyro = {
      x: clampW(s.gyro.x + (gRaw.x - s.gyro.x) * k), y: clampW(s.gyro.y + (gRaw.y - s.gyro.y) * k), z: clampW(s.gyro.z + (gRaw.z - s.gyro.z) * k),
    }
    prev.set(id, { t: nowMs, pos, vel, quat, acc, gyro })
    return { accel: acc, gyro }
  }
}
