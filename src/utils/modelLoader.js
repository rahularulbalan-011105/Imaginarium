import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()

// Scale to use for each model type (longest bounding-box dimension → this value)
export const MODEL_SCALE_TARGET = {
  arduino:  6.8,
  motor_bo: 5.0,
  motor_dc: 5.0,
  led:      1.2,
}

const MODEL_PATHS = {
  arduino:  '/models/arduino_uno.glb',
  motor_bo: '/models/motor_bo.glb',
  motor_dc: '/models/motor_dc.glb',
  led:      '/models/led.glb',
}

// module-level cache: name → THREE.Group (scaled & centered) | null (not found)
const _cache = {}
let _done = false

export async function preloadModels() {
  const jobs = Object.entries(MODEL_PATHS).map(([key, path]) =>
    new Promise((resolve) => {
      loader.load(
        path,
        (gltf) => {
          const root = gltf.scene
          root.traverse(c => {
            if (c.isMesh) { c.castShadow = true; c.receiveShadow = true }
          })
          scaleAndCenter(root, MODEL_SCALE_TARGET[key])
          _cache[key] = root
          resolve()
        },
        undefined,
        () => { _cache[key] = null; resolve() }   // 404 → procedural fallback
      )
    })
  )
  await Promise.all(jobs)
  _done = true
}

export function preloadDone() { return _done }

// Returns a deep clone with cloned materials (so state is per-instance), or null
export function cloneModel(name) {
  const src = _cache[name]
  if (!src) return null
  const clone = src.clone(true)
  clone.traverse(c => { if (c.isMesh && c.material) c.material = c.material.clone() })
  return clone
}

// ── Helpers used by electronicsFactory ────────────────────────────────────────

// Scale + center a group in-place (scale to longest dim = targetSize, center at origin)
export function scaleAndCenter(group, targetSize) {
  group.scale.set(1, 1, 1)
  group.position.set(0, 0, 0)
  group.rotation.set(0, 0, 0)
  group.updateMatrixWorld(true)

  const box    = new THREE.Box3().setFromObject(group)
  const size   = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1

  const s = targetSize / maxDim
  group.scale.setScalar(s)
  group.position.set(-center.x * s, -center.y * s, -center.z * s)
}

// Find the node in the motor GLB that should rotate (shaft / rotor / prop).
// First tries keyword match; falls back to geometric analysis.
// Key insight: the shaft is the SMALLEST-VOLUME mesh that is NOT at the model centre.
export function findRotorNode(group) {
  const ROTOR_KEYWORDS = [
    'rotor','shaft','prop','blade','fan','axle','spinning','rotate',
    'output','spindle','impeller','driveshaft','motor_shaft','gear_shaft',
  ]

  // Pass 1 — name keyword match
  let best = null
  group.traverse(child => {
    if (best) return
    const n = child.name.toLowerCase()
    if (ROTOR_KEYWORDS.some(k => n.includes(k))) best = child
  })
  if (best) return best

  // Pass 2 — geometric: smallest-volume protruding mesh
  // The shaft is almost always the smallest separate part that isn't the main body.
  // Score = volume / dist² → lower is better (tiny mesh far from centre wins).
  group.updateMatrixWorld(true)
  const modelBox    = new THREE.Box3().setFromObject(group)
  const modelCenter = modelBox.getCenter(new THREE.Vector3())
  const modelDiag   = modelBox.getSize(new THREE.Vector3()).length() || 1

  // Strategy: the output shaft is the most-protruding non-trivial mesh.
  // Filter out noise (tiny screws, flat discs, near-centre body parts, micro details),
  // then pick whichever surviving mesh has the HIGHEST dist from model centre.
  let bestMesh = null
  let bestDist = -Infinity

  group.traverse(child => {
    if (!child.isMesh) return
    child.updateMatrixWorld(true)
    const meshBox    = new THREE.Box3().setFromObject(child)
    const meshCenter = meshBox.getCenter(new THREE.Vector3())
    const s          = meshBox.getSize(new THREE.Vector3())
    const vol        = s.x * s.y * s.z

    const dist = meshCenter.distanceTo(modelCenter) / modelDiag
    if (dist < 0.10) return   // skip near-centre body meshes

    const dims = [s.x, s.y, s.z].sort((a, b) => a - b)

    // Reject tiny screws / bolts (cross-section under 3.5 % of model diagonal)
    if (dims[1] < modelDiag * 0.035) return

    // Reject flat discs / gear faces (min dim < 12 % of max dim)
    if (dims[0] < dims[2] * 0.12) return

    // Reject micro internal details (absolute volume < 0.05 units³ for a 5-unit model)
    if (vol < 0.05) return

    // Among survivors, pick the one furthest from the model centre = the shaft
    if (dist > bestDist) { bestDist = dist; bestMesh = child }
  })

  return bestMesh   // null only if model is a single undivided mesh
}

// Detect the primary spin axis of a rotor node (longest world-space dimension)
export function detectRotorAxis(rotorNode) {
  rotorNode.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(rotorNode)
  const s   = box.getSize(new THREE.Vector3())
  if (s.y > s.x && s.y > s.z) return 'y'
  if (s.z > s.x && s.z > s.y) return 'z'
  return 'x'
}

// Collect the meshes that should glow on an LED model
export function findEmissiveMeshes(group) {
  const GLOW_KEYWORDS = ['dome','glass','lens','bulb','light','glow','led','body','diffuser']
  const named = []
  group.traverse(c => {
    if (!c.isMesh) return
    const n = c.name.toLowerCase()
    if (GLOW_KEYWORDS.some(k => n.includes(k))) named.push(c)
  })
  if (named.length) return named
  // Fallback: every mesh in the model
  const all = []
  group.traverse(c => { if (c.isMesh) all.push(c) })
  return all
}
