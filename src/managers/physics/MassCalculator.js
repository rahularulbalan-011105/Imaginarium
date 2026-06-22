import { SCENE_TO_M } from './EnvironmentConfig.js'

// kg/m³
const DENSITY = { plastic: 1200, metal: 7800, rubber: 1200, default: 1000 }

// Fixed masses for electronics (kg)
const ELEC_MASS = {
  arduino: 0.025, subo: 0.020, motor: 0.120, motor_bo: 0.100, motor_dc: 0.080,
  servo: 0.021, led: 0.003,
}

// Returns geometry volume in m³, using scene-unit scale (scale.x etc. = dimensionless
// multiplier applied to the base geometry defined in geometryFactory.js).
// Base sizes: box/rectprism=2×2×2, sphere r=1, cylinder r=1 h=2, cone r=1 h=2,
// torus R=1 tube=0.4, polyhedra ≈ sphere with 0.4 fill.
function volumeM3(type, scale) {
  const sx = scale?.x ?? 1
  const sy = scale?.y ?? 1
  const sz = scale?.z ?? 1
  const m  = SCENE_TO_M

  switch (type) {
    case 'box':
    case 'rectprism':
    case 'csg':
      return (sx * 2 * m) * (sy * 2 * m) * (sz * 2 * m)
    case 'sphere':
      return (4 / 3) * Math.PI * Math.pow(sx * 1 * m, 3)
    case 'cylinder':
    case 'prism':
    case 'hexagon':
      return Math.PI * Math.pow(sx * 1 * m, 2) * (sy * 2 * m)
    case 'cone':
    case 'pyramid':
    case 'pentpyramid':
      return (1 / 3) * Math.PI * Math.pow(sx * 1 * m, 2) * (sy * 2 * m)
    case 'torus':
      return 2 * Math.PI ** 2 * Math.pow(sx * 0.4 * m, 2) * (sx * 1 * m)
    case 'tetrahedron':
    case 'octahedron':
    case 'dodecahedron':
    case 'diamond':
      return (4 / 3) * Math.PI * Math.pow(sx * 1.3 * m, 3) * 0.4
    case 'plane':
      return (sx * 2 * m) * (0.01 * m) * (sz * 2 * m)
    default:
      return Math.pow(sx * 2 * m, 3)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Mass in kg for a single scene object */
export function getMass(type, scale, material) {
  if (type in ELEC_MASS) return ELEC_MASS[type]
  const density = DENSITY[material] ?? DENSITY.default
  return Math.max(0.001, volumeM3(type, scale) * density)
}

/** Total mass (kg) for an array of scene objects */
export function totalMass(objects) {
  return objects.reduce((sum, o) => sum + getMass(o.type, o.scale, o.material), 0)
}

/**
 * Aggregate moment of inertia about the world-Y axis through the pivot point.
 * Uses parallel-axis theorem: I = I_self + m × d²
 */
export function totalMomentOfInertia(objects, pivotX = 0, pivotZ = 0) {
  return objects.reduce((sum, o) => {
    const m   = getMass(o.type, o.scale, o.material)
    const dx  = ((o.position?.x ?? 0) - pivotX) * SCENE_TO_M
    const dz  = ((o.position?.z ?? 0) - pivotZ) * SCENE_TO_M
    const r2  = dx * dx + dz * dz
    const r_s = (o.scale?.x ?? 1) * SCENE_TO_M   // self-radius estimate
    return sum + m * r2 + 0.5 * m * r_s * r_s
  }, 0)
}

/** Largest frontal area (m²) in the scene — used for drag */
export function maxFrontalArea(objects) {
  let max = 0.001
  for (const o of objects) {
    const sx = o.scale?.x ?? 1
    const sy = o.scale?.y ?? 1
    const sz = o.scale?.z ?? 1
    // Use the larger of XZ and YZ projected areas
    const a = Math.max(sx * 2, sz * 2) * SCENE_TO_M * (sy * 2 * SCENE_TO_M)
    if (a > max) max = a
  }
  return max
}
