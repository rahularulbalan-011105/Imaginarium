// High-frequency physics state lives OUTSIDE React. The session publishes a
// snapshot a few times a second; panels poll it on a timer (no per-frame
// re-renders). Also the hardware bridge that simulated firmware reads from.
import { radToServoDeg } from './ServoActuator.js'

let _latest = null
const _listeners = new Set()

export const roboticsTelemetry = {
  publish(snapshot) { _latest = snapshot; for (const fn of _listeners) { try { fn(snapshot) } catch { /* listener error */ } } },
  get() { return _latest },
  clear() { _latest = null; for (const fn of _listeners) { try { fn(null) } catch { /* ignore */ } } },
  subscribe(fn) { _listeners.add(fn); return () => _listeners.delete(fn) },
}

// ── Simulated hardware interface (what a sketch can read) ────────────────────
// Sketches never touch Three.js or the physics bodies: they write servo targets
// and read sensors through this bridge, like firmware talking to peripherals.
let _robot = null

export const roboticsHardware = {
  attach(robot) { _robot = robot },
  detach() { _robot = null },
  get active() { return !!_robot },

  /** Servo.write(deg) → actuator target. Returns false if not physics-driven. */
  commandServo(componentId, deg) { return _robot ? _robot.commandServo(componentId, deg) : false },

  /** IMU (degrees, m/s², deg/s) from the simulated sensor — noise/bias included. */
  imu() {
    const s = _robot?.imu
    if (!s) return null
    const d = 180 / Math.PI
    return {
      roll: s.roll * d, pitch: s.pitch * d, yaw: s.yaw * d,
      accel: { x: s.accel.x, y: s.accel.y, z: s.accel.z },
      gyro: { x: s.gyro.x * d, y: s.gyro.y * d, z: s.gyro.z * d },
    }
  },

  /** Joint encoder of the servo `componentId`, in servo degrees (0–180, 90 = neutral). */
  encoder(componentId) {
    const aid = _robot?.byComponent.get(componentId)
    const A = aid && _robot.actuators.get(aid)
    if (!A?.encoder) return null
    return { deg: radToServoDeg(A.encoder.angle), degPerSec: A.encoder.velocity * 180 / Math.PI }
  },

  battery() {
    const b = _robot?.battery
    if (!b) return null
    return { voltage: b.voltage, current: b.current, percent: b.soc * 100, brownout: b.brownout }
  },
}
