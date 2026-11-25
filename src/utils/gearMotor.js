// ─────────────────────────────────────────────────────────────────────────────
// BO / TT gear motor gearbox — speed vs torque, as pure functions.
//
// The yellow BO motor is a small DC motor (~7 000 rpm) behind a plastic
// gearbox. The SAME motor is sold with different gearboxes:
//
//   ratio   output speed     output torque
//   1:48    fast             weak            ← the standard one (and the default)
//   1:90    ½ as fast        ~1.7× stronger
//   1:120   ⅖ as fast        ~2.3× stronger
//   1:220   ⅕ as fast        ~3.9× stronger
//
// A gearbox multiplies torque by the ratio and divides speed by it (minus a
// little friction — more stages, more loss). Neither is free: you trade one for
// the other.
//
// Load model (used by DriveManager): a DC motor slows down linearly as its load
// torque approaches its stall torque,
//
//   speed = no-load speed × (1 − load torque / stall torque)
//
// and the load on each drive motor is its share of rolling resistance:
// μr · m · g · wheel radius / number of drive motors. So a heavy robot on a fast
// gearbox runs noticeably slower than its no-load speed — and past the stall
// torque it doesn't move at all.
//
// Speeds are relative to the simulator's existing BO speed (1:48 = the drive
// model's full-PWM speed), so every robot built before this keeps its speed.
// Torques are typical datasheet values for a TT motor; real ones vary ±20 %.
//
// Imports nothing (DriveManager, PropertiesPanel and tests use it).
// ─────────────────────────────────────────────────────────────────────────────

/** Gearbox options: ratio → gear efficiency (more stages → more friction). */
export const GEAR_RATIOS = [
  { ratio: 48,  efficiency: 0.70 },
  { ratio: 90,  efficiency: 0.66 },
  { ratio: 120, efficiency: 0.65 },
  { ratio: 220, efficiency: 0.60 },
]
export const DEFAULT_GEAR_RATIO = 48

/** The drive model's full-PWM speed for a 1:48 BO motor (DifferentialDrive Kv 20 × 7.4 V). */
const BASE_RPM = 20 * 7.4
/** Typical 1:48 TT motor stall torque at the output shaft (kg·cm). */
const BASE_STALL_KGCM = 0.8
const KGCM_TO_NM = 0.0980665
/** Radius used when a motor has no Wheel part (a 65 mm TT wheel). */
export const DEFAULT_WHEEL_RADIUS_M = 0.0325

const effOf = (ratio) => (GEAR_RATIOS.find((g) => g.ratio === ratio) ?? GEAR_RATIOS[0]).efficiency
/** A motor object's ratio (missing / unknown → the standard 1:48). */
export const ratioOf = (obj) => (GEAR_RATIOS.some((g) => g.ratio === obj?.gearRatio) ? obj.gearRatio : DEFAULT_GEAR_RATIO)
/** BO motors (and the BO motor with an encoder) have the selectable gearbox. */
export const hasGearbox = (obj) => obj?.type === 'motor_bo' || obj?.type === 'motor_enc'

/** Output-shaft specs for a gearbox ratio. */
export function gearSpecs(ratio = DEFAULT_GEAR_RATIO) {
  const r = GEAR_RATIOS.some((g) => g.ratio === ratio) ? ratio : DEFAULT_GEAR_RATIO
  const rpm = BASE_RPM * (DEFAULT_GEAR_RATIO / r)
  // Same motor behind both: torque scales with ratio × efficiency.
  const stallKgCm = BASE_STALL_KGCM * (r * effOf(r)) / (DEFAULT_GEAR_RATIO * effOf(DEFAULT_GEAR_RATIO))
  return { ratio: r, rpm, stallKgCm, stallNm: stallKgCm * KGCM_TO_NM }
}

/** No-load speed of `ratio` relative to the standard 1:48 (1 for 1:48). */
export const gearSpeedFactor = (ratio) => gearSpecs(ratio).rpm / BASE_RPM

/** Load torque (N·m) on EACH drive motor from rolling resistance. */
export function rollingLoadNm({ massKg, gravity = 9.81, rollingFriction = 0.015, wheelRadiusM = DEFAULT_WHEEL_RADIUS_M, driveMotors = 2 }) {
  return (Math.abs(rollingFriction) * massKg * Math.abs(gravity) * wheelRadiusM) / Math.max(1, driveMotors)
}

/** Fraction of no-load speed left under `loadNm` (0 = stalled). */
export const loadFactor = (stallNm, loadNm) => Math.max(0, Math.min(1, 1 - loadNm / stallNm))

/**
 * Steepest slope (degrees) the robot could climb with every drive motor at
 * stall: Σ stall force ≥ m·g·(sin θ + μr·cos θ). ~0 means it can barely move.
 */
export function maxSlopeDeg({ stallNm, driveMotors = 2, massKg, gravity = 9.81, rollingFriction = 0.015, wheelRadiusM = DEFAULT_WHEEL_RADIUS_M }) {
  const k = (stallNm * driveMotors) / (wheelRadiusM * massKg * Math.abs(gravity))   // available / weight
  const mu = Math.abs(rollingFriction)
  // Solve sin θ + μ cos θ = k  →  θ = asin(k / √(1+μ²)) − atan(μ)
  const s = k / Math.sqrt(1 + mu * mu)
  if (s >= 1) return 90
  const th = Math.asin(s) - Math.atan(mu)
  return Math.max(0, (th * 180) / Math.PI)
}

/** Rubber tyre grip on a typical floor. Past atan(μ) the wheels slip, however
 *  strong the motors — so a climb is limited by whichever gives up first. */
export const TYRE_GRIP = 0.8
export const GRIP_SLOPE_DEG = (Math.atan(TYRE_GRIP) * 180) / Math.PI    // ≈ 38.7°

/**
 * Speed scale (0…) for one side of a differential drive: the average over that
 * side's motors of  gearSpeedFactor × loadFactor  (motors without a gearbox
 * count as 1 — unchanged).
 * @param motorIds   motor ids on this side
 * @param byId       Map id → scene object
 * @param loadNmOf   (motorObj) → load torque on that motor (N·m)
 * @returns {{ scale:number, worst:number }}  worst = lowest load factor on the side
 */
export function sideSpeedScale(motorIds, byId, loadNmOf) {
  if (!motorIds?.length) return { scale: 1, worst: 1 }
  let sum = 0, worst = 1
  for (const id of motorIds) {
    const m = byId.get(id)
    if (!hasGearbox(m)) { sum += 1; continue }
    const spec = gearSpecs(ratioOf(m))
    const lf = loadFactor(spec.stallNm, loadNmOf(m))
    worst = Math.min(worst, lf)
    sum += gearSpeedFactor(spec.ratio) * lf
  }
  return { scale: sum / motorIds.length, worst }
}
