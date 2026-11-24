// ─────────────────────────────────────────────────────────────────────────────
// Wheels & casters — default sizes and how wheel size feeds the wheeled drive.
//
// The drive model (managers/robot/DifferentialDrive.js) turns motor PWM into
// speed with  v = ω_motor × wheelRadius.  Its radius used to be a fixed 0.40,
// tuned on the preset chassis, whose wheels are ≈ 3.4 units across. So:
//
//   drive radius = 0.40 × (real wheel radius / 1.7)
//
// A default Wheel (⌀ 3.4) therefore drives exactly as every robot did before;
// a ⌀ 6.8 wheel goes twice as fast, a ⌀ 1.7 wheel half as fast. Only `wheel`
// parts count — any other part on a motor (the Library "Wheels" model, a
// cylinder, a CSG…) keeps the old 0.40, so existing projects are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_DRIVE_RADIUS } from '../managers/robot/DifferentialDrive.js'

/** Default wheel: same size as the preset chassis wheels (8.0 GLB × 0.421). */
// Width 1.3 ≈ the 65 × 26 mm proportions of the yellow BO-motor wheel.
export const WHEEL_DEFAULTS  = { wheelDiameter: 3.4, wheelWidth: 1.3 }
/** Default colours: yellow rim (the object's normal colour) + black tyre. */
export const WHEEL_RIM_COLOR  = '#facc15'
export const WHEEL_TYRE_COLOR = '#1f2226'
/** Ball caster: galvanised-zinc body (the object's normal colour) + polished steel ball. */
export const CASTER_BODY_COLOR = '#b4bfcb'
export const CASTER_BALL_COLOR = '#dfe3e8'
/** Default ball caster: total height and steel-ball diameter (scene units). */
export const CASTER_DEFAULTS = { casterHeight: 1.6, casterBall: 1.0 }

/** Wheel radius the drive was tuned on (scene units). */
export const REF_WHEEL_RADIUS = WHEEL_DEFAULTS.wheelDiameter / 2

/**
 * Real radius of a `wheel` part in world units. The wheel's axle is its local
 * X axis, so its radius scales with the local Y/Z scale (incl. any parent scale,
 * e.g. a resized motor) — pass the mesh's world scale when you have it.
 */
export function wheelWorldRadius(obj, worldScale = obj?.scale) {
  const d = obj?.wheelDiameter ?? WHEEL_DEFAULTS.wheelDiameter
  const s = Math.max(Math.abs(worldScale?.y ?? 1), Math.abs(worldScale?.z ?? 1))
  return (d / 2) * s
}

/** Drive-model radius for a real wheel radius (see the formula at the top). */
export const driveRadiusFor = (realRadius) => DEFAULT_DRIVE_RADIUS * (realRadius / REF_WHEEL_RADIUS)

/** "×1.00" speed factor of a wheel vs the default wheel — shown in Properties. */
export const wheelSpeedFactor = (realRadius) => realRadius / REF_WHEEL_RADIUS

/**
 * Drive radius for one side of the robot: the average over its motors, where a
 * motor carrying a `wheel` part uses that wheel's size and any other motor keeps
 * the old default. Returns DEFAULT_DRIVE_RADIUS when no motor has a wheel part.
 *
 * @param motorIds     motor object ids on this side
 * @param attachments  electronicsStore.attachments  { partId → motorId }
 * @param objectsById  Map id → scene object
 * @param radiusOf     (wheelObj) → real radius in world units (default: from obj.scale)
 */
export function sideDriveRadius(motorIds, attachments, objectsById, radiusOf = wheelWorldRadius) {
  if (!motorIds?.length) return DEFAULT_DRIVE_RADIUS
  const perMotor = new Map(motorIds.map((id) => [id, null]))
  for (const [partId, motorId] of Object.entries(attachments ?? {})) {
    if (!perMotor.has(motorId)) continue
    const part = objectsById.get(partId)
    if (part?.type !== 'wheel') continue
    const r = radiusOf(part)
    // A motor with a wheel on each end of its shaft: the bigger one touches the ground.
    if (r > 0) perMotor.set(motorId, Math.max(perMotor.get(motorId) ?? 0, r))
  }
  let sum = 0
  for (const r of perMotor.values()) sum += r == null ? DEFAULT_DRIVE_RADIUS : driveRadiusFor(r)
  return sum / perMotor.size
}
