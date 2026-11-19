// Which way does a scene robot face? Used when the author has NOT set
// Physics → Robot → Forward axis. Without it every robot walked toward world
// −Z, so one built facing ±X stepped sideways against its own hinges and fell.
//
//   1. Side axis = the dominant HORIZONTAL axis of the actuated revolute joints
//      (hip/knee pitch hinges run side-to-side). Vertical (yaw) hips are
//      ignored. Sign-free: a 2×2 covariance of the axes in the XZ plane.
//   2. Forward = horizontal, perpendicular to the side axis.
//   3. Front = the side carrying a distance sensor (the robot's "eyes");
//      with none, the side facing AWAY from the camera (↑ = into the screen,
//      as in games); if the camera looks along the side axis, world −Z.
//
// Pure function — inputs are plain {x,y,z} objects.

const EYE_MIN = 0.2   // su — an eye this close to the centre line doesn't pick a side

/**
 * @param joints [{ type, axis:{x,y,z} }] — only actuated revolute joints should be passed
 * @param center {x,z} — body centre (eyes are measured from here)
 * @param eyes   [{x,z}] — world positions of distance sensors
 * @param view   {x,z} — horizontal camera look direction (optional)
 * @returns {x,y,z} unit forward vector, or null when the joints give no clue
 */
export function inferForward(joints, center, eyes = [], view = null) {
  let sxx = 0, szz = 0, sxz = 0, n = 0
  for (const j of joints) {
    const a = j.axis
    const h = Math.hypot(a.x, a.z)
    if (h < 0.7 * Math.hypot(a.x, a.y, a.z)) continue      // mostly vertical → yaw joint
    const x = a.x / h, z = a.z / h
    sxx += x * x; szz += z * z; sxz += x * z; n++
  }
  if (!n) return null
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz)         // principal side axis
  const sx = Math.cos(ang), sz = Math.sin(ang)
  let fx = -sz, fz = sx                                    // perpendicular, horizontal
  let sign = 0
  for (const e of eyes) {
    const d = (e.x - center.x) * fx + (e.z - center.z) * fz
    if (Math.abs(d) > EYE_MIN) { sign = Math.sign(d); break }
  }
  if (!sign) sign = frontFromView(fx, fz, view)
  return { x: fx * sign + 0, y: 0, z: fz * sign + 0 }
}

/** Sign (±1) that makes (fx,fz) point away from the camera; world −Z when unclear. */
export function frontFromView(fx, fz, view) {
  if (view) {
    const n = Math.hypot(view.x, view.z)
    const d = n > 1e-6 ? (fx * view.x + fz * view.z) / n : 0
    if (Math.abs(d) > 0.2) return Math.sign(d)
  }
  return fz <= 0 ? 1 : -1
}
