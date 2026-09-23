import * as THREE from 'three'
import { SCENE_TO_M } from './EnvironmentConfig.js'
import { objectManager } from '../ObjectManager.js'

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

// True signed volume of a geometry in scene-units³ (cached on the geometry).
// A union/CSG is an irregular solid — its real volume is far smaller than its
// bounding box, so this gives a mass that reflects the actual shape, not a full
// block. Works for any closed mesh.
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _cr = new THREE.Vector3()
function geomVolumeSU3(geometry) {
  if (!geometry?.attributes?.position) return 0
  if (geometry.userData && geometry.userData.__volSU3 != null) return geometry.userData.__volSU3
  const pos = geometry.attributes.position
  const idx = geometry.index
  const n = idx ? idx.count : pos.count
  let vol = 0
  for (let i = 0; i + 2 < n; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2
    _v0.fromBufferAttribute(pos, a); _v1.fromBufferAttribute(pos, b); _v2.fromBufferAttribute(pos, c)
    vol += _v0.dot(_cr.crossVectors(_v1, _v2))
  }
  vol = Math.abs(vol) / 6
  try { (geometry.userData ||= {}).__volSU3 = vol } catch { /* frozen geo */ }
  return vol
}

// Real mesh volume (m³) for a scene object, scaled by its current transform.
function meshVolumeM3(id, scale) {
  const mesh = objectManager.getMesh?.(id)
  if (!mesh) return null
  let su3 = 0
  mesh.traverse((node) => { if (node.isMesh) su3 += geomVolumeSU3(node.geometry) })
  if (!(su3 > 0)) return null
  const s = (scale?.x ?? 1) * (scale?.y ?? 1) * (scale?.z ?? 1)
  return su3 * Math.abs(s) * (SCENE_TO_M ** 3)
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Mass in kg for a single scene object (type/scale only — no real-geometry lookup). */
export function getMass(type, scale, material) {
  if (type in ELEC_MASS) return ELEC_MASS[type]
  const density = DENSITY[material] ?? DENSITY.default
  return Math.max(0.001, volumeM3(type, scale) * density)
}

/**
 * Mass in kg for a scene object. For unions/CSG (and imported models) it uses the
 * ACTUAL mesh volume × density × dimensions — so a union weighs what its real
 * shape weighs, not a full bounding block. Falls back to the shape estimate.
 */
export function getMassForObject(o) {
  if (!o) return 0.001
  if (o.type in ELEC_MASS) return ELEC_MASS[o.type]
  const density = DENSITY[o.material] ?? DENSITY.default
  if (o.type === 'csg' || o.type === 'model') {
    const v = meshVolumeM3(o.id, o.scale)
    if (v != null && v > 0) return Math.max(0.001, v * density)
  }
  return Math.max(0.001, volumeM3(o.type, o.scale) * density)
}

/** Total mass (kg) for an array of scene objects */
export function totalMass(objects) {
  return objects.reduce((sum, o) => sum + getMassForObject(o), 0)
}

/**
 * Aggregate moment of inertia about the world-Y axis through the pivot point.
 * Uses parallel-axis theorem: I = I_self + m × d²
 */
export function totalMomentOfInertia(objects, pivotX = 0, pivotZ = 0) {
  return objects.reduce((sum, o) => {
    const m   = getMassForObject(o)
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
