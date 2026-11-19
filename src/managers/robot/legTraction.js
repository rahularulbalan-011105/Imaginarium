// Gravity-dependent locomotion for the kinematic legged path.
//
// A walking robot moves only by pushing its feet against the ground, and the
// most a foot can push sideways is friction × the force pressing it down, i.e.
// μ·m·g. So gravity sets three things, all modelled here:
//   • grip      — max horizontal acceleration a = μ·g (starting, stopping,
//                 turning). Zero-G → no grip: legs flail, momentum is kept.
//   • top speed — legged walking tops out near a fixed Froude number
//                 v²/(g·L), so walking speed scales with √g (why astronauts
//                 bound slowly on the Moon). Earth stays at the tuned speed.
//   • contact   — with no gravity nothing holds the feet down: kicking legs
//                 push the body off the floor and it drifts away.
// Units: velocities in scene units/s, gravity in m/s² (negative = down).
import { SCENE_TO_M } from '../physics/EnvironmentConfig.js'

export const EARTH_G      = 9.81
export const FOOT_FRICTION = 0.8      // rubber-ish foot on a hard floor
const TURN_RADIUS   = 1.5             // su — lever arm of the feet about the body centre
const ZERO_G        = 0.05            // m/s² — below this the floor gives no grip
const PUSH_OFF      = 0.6             // su/s — how hard kicking legs shove off in zero-G

/** Walking-speed factor from gravity (Froude scaling, capped at Earth's tuned speed). */
export function gravitySpeedScale(gravity) {
  return Math.min(1, Math.sqrt(Math.abs(gravity) / EARTH_G))
}

/**
 * One step of traction-limited motion.
 * @param s state { vx, vz, omega } — the robot's CURRENT planar velocity (mutated)
 * @param want { vx, vz, omega } — what the legs are trying to do
 * @param env { gravity, grounded, dt, walking }
 * @returns { vx, vz, omega, pushOff } pushOff = upward velocity to add (zero-G kick)
 */
export function stepTraction(s, want, { gravity, grounded, dt, walking }) {
  const g = Math.abs(gravity)
  const scale = gravitySpeedScale(gravity)
  // Grip exists only while the feet are on the ground and gravity presses them down.
  const grip = grounded && g > ZERO_G
  if (grip) {
    const aMax = FOOT_FRICTION * g / SCENE_TO_M * dt        // su/s per step
    const tx = want.vx * scale, tz = want.vz * scale
    let dx = tx - s.vx, dz = tz - s.vz
    const d = Math.hypot(dx, dz)
    if (d > aMax) { dx *= aMax / d; dz *= aMax / d }
    s.vx += dx; s.vz += dz
    const wMax = aMax / TURN_RADIUS
    const dw = Math.max(-wMax, Math.min(wMax, want.omega * scale - s.omega))
    s.omega += dw
  }
  // No grip → Newton's first law: whatever velocity it has, it keeps.
  const pushOff = grounded && g <= ZERO_G && walking ? PUSH_OFF : 0
  return { vx: s.vx, vz: s.vz, omega: s.omega, pushOff }
}
