import * as THREE from 'three'
import { SCENE_TO_M } from './EnvironmentConfig.js'
import { objectManager } from '../ObjectManager.js'
import { createGeometry } from '../../utils/geometryFactory.js'

// kg/m³
const DENSITY = { plastic: 1200, metal: 7800, rubber: 1200, default: 1000 }

// Fixed masses for electronics (kg) — real module weights. A part listed here
// never falls through to the volume estimate (which would treat it as a solid block).
const ELEC_MASS = {
  arduino: 0.025, subo: 0.020, motor: 0.120, motor_bo: 0.100, motor_dc: 0.080,
  servo: 0.021, led: 0.003,
  ultrasonic: 0.0085, ir_sensor: 0.003, gas_sensor: 0.010, color_sensor: 0.005,
  ldr_sensor: 0.003, dht11: 0.004, oled: 0.006, buzzer: 0.003,
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
  const pos = geometry.attributes.position
  // Cache keyed on the position buffer's version: bend/extrude/fillet edit the
  // geometry in place, so a stale cached volume would survive the edit.
  const c = geometry.userData?.__vol
  if (c && c.ver === pos.version && c.count === pos.count) return c.v
  const idx = geometry.index
  const n = idx ? idx.count : pos.count
  let vol = 0
  for (let i = 0; i + 2 < n; i += 3) {
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2
    _v0.fromBufferAttribute(pos, a); _v1.fromBufferAttribute(pos, b); _v2.fromBufferAttribute(pos, c)
    vol += _v0.dot(_cr.crossVectors(_v1, _v2))
  }
  vol = Math.abs(vol) / 6
  try { (geometry.userData ||= {}).__vol = { v: vol, ver: pos.version, count: pos.count } } catch { /* frozen geo */ }
  return vol
}

// Editor overlays that live inside an object's hierarchy but aren't part of it
// (same rule as the physics collider builder in robotics/sceneGraph.js).
const NON_PHYSICAL_FLAGS = [
  'isPin', 'isPinSphere', 'isPinLabel', 'isWire', 'isWireLine', 'isWireHandle',
  'isSelectionOutline', 'isPatchMesh', 'isJointHelper', 'isHandle', 'isGuide',
  'isAttachMarker', 'isHelper', 'isPrintBed', 'isBattleProxy',
]
const isNonPhysical = (n) => { const u = n.userData; return !!u && (u.pinId != null || NON_PHYSICAL_FLAGS.some(f => u[f])) }

// Volume of an object's OWN meshes in its unscaled local frame (su³): skips
// parts attached into it and editor overlays, and applies nested node scales
// (GLB hierarchies) but not the root's — the caller applies obj.scale, so the
// result never lags the mesh sync by a render.
function ownVolumeSU3(root) {
  const id = root.userData?.id
  let su3 = 0
  const visit = (n, k) => {
    if (n !== root && n.userData?.id && n.userData.id !== id) return
    if (isNonPhysical(n)) return
    const kk = n === root ? 1 : k * Math.abs(n.scale.x * n.scale.y * n.scale.z)
    if (n.isMesh && n.geometry && !n.isInstancedMesh) su3 += geomVolumeSU3(n.geometry) * kk
    for (const c of n.children) visit(c, kk)
  }
  visit(root, 1)
  return su3
}

// Real mesh volume (m³) for a scene object, scaled by its stored scale.
function meshVolumeM3(id, scale) {
  const mesh = objectManager.getMesh?.(id)
  if (!mesh) return null
  const su3 = ownVolumeSU3(mesh)
  if (!(su3 > 0)) return null
  const s = (scale?.x ?? 1) * (scale?.y ?? 1) * (scale?.z ?? 1)
  return su3 * Math.abs(s) * (SCENE_TO_M ** 3)
}

// Exact volume of a primitive's factory geometry at scale 1 (su³), per type.
const _baseVol = new Map()
function baseVolumeSU3(type) {
  if (_baseVol.has(type)) return _baseVol.get(type)
  let v = 0
  try { const g = createGeometry(type); v = geomVolumeSU3(g); g.dispose() } catch { v = 0 }
  _baseVol.set(type, v)
  return v
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Mass in kg for a single scene object (type/scale only — no real-geometry lookup). */
export function getMass(type, scale, material) {
  if (type in ELEC_MASS) return ELEC_MASS[type]
  const density = DENSITY[material] ?? DENSITY.default
  const base = type !== 'plane' && !String(type).startsWith('weapon_') ? baseVolumeSU3(type) : 0
  if (base > 0) return Math.max(0.001, base * Math.abs((scale?.x ?? 1) * (scale?.y ?? 1) * (scale?.z ?? 1)) * SCENE_TO_M ** 3 * density)
  return Math.max(0.001, volumeM3(type, scale) * density)
}

/**
 * Mass in kg for a scene object = real volume × density. The volume is the
 * object's ACTUAL mesh (so unions, extrudes, fillets, bends, text and imported
 * models weigh what their shape weighs), else the exact volume of the
 * primitive's factory geometry (capsule, star, gear, pyramids…), else the
 * analytic estimate. Open surfaces (plane) keep their thin-sheet estimate.
 */
export function getMassForObject(o) {
  if (!o) return 0.001
  if (o.type in ELEC_MASS) return ELEC_MASS[o.type]
  const density = DENSITY[o.material] ?? DENSITY.default
  // Weapons keep their tuned block estimate (combat classes are balanced on it).
  if (o.type !== 'plane' && !String(o.type).startsWith('weapon_')) {
    const v = meshVolumeM3(o.id, o.scale)
    if (v != null && v > 0) return Math.max(0.001, v * density)
    const base = baseVolumeSU3(o.type)
    if (base > 0 && o.type !== 'csg' && o.type !== 'model') {
      const s = Math.abs((o.scale?.x ?? 1) * (o.scale?.y ?? 1) * (o.scale?.z ?? 1))
      return Math.max(0.001, base * s * SCENE_TO_M ** 3 * density)
    }
  }
  return Math.max(0.001, volumeM3(o.type, o.scale) * density)
}

/**
 * Mass actually used by the simulators: the user's Physics → Body mass when
 * set (obj.physics.mass), else the volume × density estimate above.
 */
export function effectiveMass(o) {
  const m = o?.physics?.mass
  return Number.isFinite(m) && m > 0 ? m : getMassForObject(o)
}

/** Total mass (kg) for an array of scene objects */
export function totalMass(objects) {
  return objects.reduce((sum, o) => sum + effectiveMass(o), 0)
}

/**
 * Aggregate moment of inertia about the world-Y axis through the pivot point.
 * Uses parallel-axis theorem: I = I_self + m × d²
 */
export function totalMomentOfInertia(objects, pivotX = 0, pivotZ = 0) {
  return objects.reduce((sum, o) => {
    const m   = effectiveMass(o)
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
