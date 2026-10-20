// ─────────────────────────────────────────────────────────────────────────────
// robotScale — Battle size normalisation (pure math, no scene access).
//
// The AI opponent is scaled so its overall size is comparable to the player's
// robot; the player's robot is never scaled. "Size" blends the horizontal
// FOOTPRINT (√(width·length) — how big it is to drive against / shoot at) with
// the VOLUMETRIC size (∛(w·h·l) — how big it looks), so a tall thin robot or a
// flat wide one isn't over- or under-scaled by a single dimension. One uniform
// factor keeps the AI's proportions; it is clamped so odd designs stay sane, and
// tiny differences are left alone.
//
// Dimensions are the robot's robust oriented box (robustBounds — visible
// geometry only, in the robot's own heading frame), measured once per match
// from the unscaled editor pose, so restarts never compound the factor.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_SIZE_RATIO = 1.0     // target AI size ÷ player size
export const AI_SCALE_MIN = 0.5
export const AI_SCALE_MAX = 4.0
export const AI_SCALE_DEADBAND = 0.1 // |factor − 1| below this → leave the AI as built

/** Characteristic size of a box {x: width, y: height, z: length} (scene units). */
export function robotSizeMetric(size) {
  const w = Math.max(1e-3, size.x), h = Math.max(1e-3, size.y), l = Math.max(1e-3, size.z)
  const footprint = Math.sqrt(w * l)
  const volumetric = Math.cbrt(w * h * l)
  return Math.sqrt(footprint * volumetric)
}

/**
 * Uniform scale for the AI so its size ≈ ratio × the player's.
 * Returns 1 when either size is unknown or the difference is within the deadband.
 */
export function aiScaleFor(playerSize, aiSize, { ratio = AI_SIZE_RATIO, min = AI_SCALE_MIN, max = AI_SCALE_MAX, deadband = AI_SCALE_DEADBAND } = {}) {
  if (!playerSize || !aiSize) return 1
  const mp = robotSizeMetric(playerSize), ma = robotSizeMetric(aiSize)
  if (!(mp > 0) || !(ma > 0) || !Number.isFinite(mp) || !Number.isFinite(ma)) return 1
  const s = Math.min(max, Math.max(min, (ratio * mp) / ma))
  return Math.abs(s - 1) < deadband ? 1 : s
}
