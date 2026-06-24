import * as THREE from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { objectManager } from '../managers/ObjectManager.js'

// 1 scene unit = 0.05 m = 50 mm (matches SCENE_TO_M in EnvironmentConfig).
export const MM_PER_UNIT = 50

const ELECTRONICS = new Set(['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo', 'ir_sensor', 'ultrasonic', 'buzzer', 'oled', 'gas_sensor'])

// Objects worth sending to a 3D printer (skip boards/sensors/motors).
export function printableObjects(objects) {
  return objects.filter(o => o.visible !== false && !ELECTRONICS.has(o.type))
}

// World-space clone of every leaf mesh under an object3d, as plain Mesh nodes.
function worldMeshes(object3d) {
  const out = []
  object3d.updateMatrixWorld(true)
  object3d.traverse(child => {
    if (!child.isMesh || !child.geometry) return
    if (child.userData.isPinSphere || child.userData.isPinLabel || child.userData.isAttachMarker) return
    const geo = child.geometry.clone()
    geo.applyMatrix4(child.matrixWorld)
    out.push(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()))
  })
  return out
}

// Watertight (manifold) test: weld vertices by rounded position, then every edge
// of a closed solid must be shared by exactly two triangles. Returns null when
// the mesh is too large to check quickly or has no geometry.
function watertightOf(geometry) {
  const pos = geometry.attributes?.position
  if (!pos) return null
  const triCount = (geometry.index ? geometry.index.count : pos.count) / 3
  if (triCount > 150000 || triCount < 1) return null

  const idOf = new Map()
  const vid = (i) => {
    const k = Math.round(pos.getX(i) * 1e4) + '_' + Math.round(pos.getY(i) * 1e4) + '_' + Math.round(pos.getZ(i) * 1e4)
    let id = idOf.get(k)
    if (id === undefined) { id = idOf.size; idOf.set(k, id) }
    return id
  }
  const get = (i) => (geometry.index ? geometry.index.getX(i) : i)
  const edges = new Map()
  const addEdge = (a, b) => { const k = a < b ? a + '|' + b : b + '|' + a; edges.set(k, (edges.get(k) || 0) + 1) }
  for (let t = 0; t < triCount; t++) {
    const a = vid(get(t * 3)), b = vid(get(t * 3 + 1)), c = vid(get(t * 3 + 2))
    addEdge(a, b); addEdge(b, c); addEdge(c, a)
  }
  let boundary = 0
  for (const c of edges.values()) if (c !== 2) boundary++
  return { watertight: boundary === 0, boundaryEdges: boundary }
}

/**
 * Analyse the printability of each object: world size in mm, whether it fits the
 * build plate, and whether its mesh is watertight (printable as a solid).
 */
export function analyzePrintability(objects, bedMm = 220) {
  const items = []
  for (const obj of printableObjects(objects)) {
    const mesh = objectManager.getMesh(obj.id)
    if (!mesh) continue
    mesh.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(mesh)
    if (box.isEmpty()) continue
    const size = box.getSize(new THREE.Vector3())
    const sizeMm = { x: size.x * MM_PER_UNIT, y: size.y * MM_PER_UNIT, z: size.z * MM_PER_UNIT }
    const footprint = Math.max(sizeMm.x, sizeMm.z)

    // Watertight only meaningful for single-mesh solids; groups/models report n/a.
    let wt = null
    if (mesh.isMesh && mesh.geometry) wt = watertightOf(mesh.geometry)

    items.push({
      id: obj.id,
      name: obj.name,
      sizeMm: { x: Math.round(sizeMm.x), y: Math.round(sizeMm.y), z: Math.round(sizeMm.z) },
      fits: footprint <= bedMm,
      watertight: wt ? wt.watertight : null,
      boundaryEdges: wt ? wt.boundaryEdges : 0,
    })
  }
  return {
    items,
    bedMm,
    allFit: items.every(i => i.fits),
    anyOpen: items.some(i => i.watertight === false),
    empty: items.length === 0,
  }
}

// Trigger a binary STL download of all printable objects (merged into one file).
export function exportSTL(objects, filename = 'model.stl') {
  const group = new THREE.Group()
  for (const obj of printableObjects(objects)) {
    const mesh = objectManager.getMesh(obj.id)
    if (mesh) worldMeshes(mesh).forEach(m => group.add(m))
  }
  if (group.children.length === 0) return false

  const result = new STLExporter().parse(group, { binary: true })
  const blob = new Blob([result], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.stl') ? filename : `${filename}.stl`
  a.click()
  URL.revokeObjectURL(url)
  group.traverse(c => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose() } })
  return true
}
