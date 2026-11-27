// ─────────────────────────────────────────────────────────────────────────────
// Component variants — real parts that are an EXISTING component type with
// different data.
//
// An SG90 is wired, coded (Servo.write) and simulated exactly like the generic
// `servo`; what differs is its size, weight and motor strength. So it is NOT a
// new type (a new type has to be added to ~15 hand-kept type lists across the
// app). It is a `servo` object stamped with these values at creation:
//
//   • scale    → the uniform Size the Properties panel already offers electronics
//   • physics  → the per-object physics config the Physics panel already edits
//                (physics.mass = Body mass in kg; physics.servo.preset = one of
//                SERVO_PRESETS in managers/physics/robotics/ServoActuator.js)
//   • variant  → tag kept on the object (and in saves) so the UI knows what it is
//
// Everything stays editable afterwards — the user can still change the servo
// model or mass in Physics, exactly as for a plain servo.
// ─────────────────────────────────────────────────────────────────────────────

export const COMPONENT_VARIANTS = {
  sg90: {
    base:  'servo',
    name:  'SG90',
    scale: 0.6,                                    // 23 mm body vs ~40 mm standard servo
    physics: { mass: 0.009, servo: { preset: 'sg90' } },   // 9 g, 1.8 kg·cm stall
  },
  mg996r: {
    base:  'servo',
    name:  'MG996R',
    scale: 1.0,                                    // standard size, 40.7 × 19.7 × 42.9 mm
    physics: { mass: 0.055, servo: { preset: 'mg996r' } }, // 55 g, 11 kg·cm stall @ 6 V
  },
  // FS90R: a variant of the CONTINUOUS servo type (servo_cr), not of 'servo' —
  // its behaviour differs (speed, not angle), so the type differs too.
  fs90r: {
    base:  'servo_cr',
    name:  'FS90R',
    scale: 0.6,                                    // SG90-size micro servo body
    physics: { mass: 0.011 },                      // 11 g
  },
  ds3218: {
    base:  'servo',
    name:  'DS3218',
    scale: 1.0,                                    // standard size, 40 × 20 × 40.5 mm
    physics: { mass: 0.060, servo: { preset: 'ds3218' } }, // 60 g, 21 kg·cm stall @ 6.8 V
  },

  // ── Gear motors ────────────────────────────────────────────────────────────
  // Plain gear motors are a `motor_bo` (two terminals, selectable gearbox, drive
  // model); encoder gear motors are a `motor_enc` (M1 GND A B VCC M2 header,
  // quadrature pulses). `fields` are extra object fields stamped at creation
  // (the gearbox ratio, still editable in Properties). The N20 and metal ones
  // have their own models (electronicsFactory createGearMotorGroup, keyed by
  // the variant); the TT ones are the TT model itself (motor_bo.glb), shown at
  // its real 70 mm length (the generic BO card draws it at 50 mm).
  n20: {
    base:  'motor_bo',
    name:  'N20',
    physics: { mass: 0.010 },                      // 10 g
    fields: { gearRatio: 220 },                    // slow, strong micro gearbox (~1:210)
  },
  tt: {
    base:  'motor_bo',
    name:  'TT_Motor',
    scale: 1.4,                                    // 70 × 22.5 mm TT gearbox motor
    physics: { mass: 0.029 },                      // 29 g
    fields: { gearRatio: 48 },                     // the standard 1:48
  },
  metal_gear: {
    base:  'motor_bo',
    name:  'MetalGear',
    physics: { mass: 0.090 },                      // JGA25-370, 90 g
    fields: { gearRatio: 120 },
  },
  n20_enc: {
    base:  'motor_enc',
    name:  'N20_Enc',
    physics: { mass: 0.012 },
    fields: { gearRatio: 220 },
  },
  tt_enc: {
    base:  'motor_enc',
    name:  'TT_Enc',
    scale: 1.4,
    physics: { mass: 0.032 },
    fields: { gearRatio: 48 },
  },
  metal_gear_enc: {
    base:  'motor_enc',
    name:  'MetalGear_Enc',
    physics: { mass: 0.105 },                      // JGA25-370 + encoder
    fields: { gearRatio: 120 },
  },
}

/**
 * The fields to merge into a new scene object for variant `key`, or null if the
 * key is unknown. `objects` = current scene objects (used only to number the
 * name: SG90_1, SG90_2 …).
 */
export function variantOverrides(key, objects = []) {
  const v = COMPONENT_VARIANTS[key]
  if (!v) return null
  const n = objects.filter((o) => o.variant === key).length + 1
  const s = v.scale ?? 1
  return {
    variant: key,
    name:    `${v.name}_${n}`,
    scale:   { x: s, y: s, z: s },
    // structuredClone: each object gets its OWN physics config, so editing one
    // SG90 in the Physics panel can never change the shared table (or another SG90).
    physics: structuredClone(v.physics ?? {}),
    ...structuredClone(v.fields ?? {}),
  }
}
