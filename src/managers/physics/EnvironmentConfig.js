// Physics environment presets.
// gravity: m/s² (negative Y), airDensity: kg/m³, rollingFriction: dimensionless

export const SCENE_TO_M = 0.05  // 1 scene unit = 0.05 m (5 cm)

export const ENVIRONMENTS = {
  earth: {
    gravity:         -9.80665,
    airDensity:       1.225,
    groundFriction:   0.7,
    rollingFriction:  0.015,
    label:           'Earth  (9.81 m/s²)',
  },
  moon: {
    gravity:         -1.62,
    airDensity:       0,
    groundFriction:   0.7,
    rollingFriction:  0.005,
    label:           'Moon  (1.62 m/s²)',
  },
  mars: {
    gravity:         -3.72,
    airDensity:       0.020,
    groundFriction:   0.7,
    rollingFriction:  0.010,
    label:           'Mars  (3.72 m/s²)',
  },
  zero_g: {
    gravity:          0,
    airDensity:       0,
    groundFriction:   0,
    rollingFriction:  0,
    label:           'Zero-G',
  },
  underwater: {
    gravity:         -9.80665,
    airDensity:    1000,        // effective drag in water ≈ water density
    groundFriction:  0.3,
    rollingFriction: 0.05,
    label:          'Underwater',
  },
}

export function getEnvironmentParams(env) {
  return ENVIRONMENTS[env] ?? ENVIRONMENTS.earth
}
