import * as THREE from 'three'
import { Evaluator, Brush, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg'
import { objectManager } from '../managers/ObjectManager.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Single shared evaluator. useGroups defaults to true — required for correct
// SUBTRACTION results in three-bvh-csg@0.0.18.
const evaluator = new Evaluator()

/**
 * Extract a merged BufferGeometry from a THREE.Object3D (Mesh or Group).
 * Works for both simple meshes and complex electronics groups.
 */
function extractGeometry(object3d) {
  if (!object3d) return null

  if (object3d.isMesh && object3d.geometry) {
    // Simple mesh — just return its world-space geometry
    const geo = object3d.geometry.clone()
    object3d.updateMatrixWorld(true)
    geo.applyMatrix4(object3d.matrixWorld)
    return geo
  }

  // Group — collect + merge all child mesh geometries in world space
  const geos = []
  object3d.updateMatrixWorld(true)
  object3d.traverse(child => {
    if (!child.isMesh || !child.geometry) return
    child.updateMatrixWorld(true)
    const g = child.geometry.clone()
    g.applyMatrix4(child.matrixWorld)
    // Normalize to position + normal only for merge compatibility
    const out = new THREE.BufferGeometry()
    if (g.attributes.position) out.setAttribute('position', g.attributes.position)
    if (g.attributes.normal)   out.setAttribute('normal', g.attributes.normal)
    out.morphAttributes = {}
    geos.push(out)
  })
  if (geos.length === 0) return null
  if (geos.length === 1) return geos[0]
  const merged = mergeGeometries(geos, false)
  return merged
}

/**
 * Run a boolean operation on two scene objects.
 * Supports geometry objects AND electronics groups.
 * Returns { geometryJSON, color } or null on failure.
 *
 * operations: 'union' | 'subtract' (A−B) | 'subtractB' (B−A) | 'intersect'
 */
export function runBoolean(idA, idB, operation) {
  const meshA = objectManager.getMesh(idA)
  const meshB = objectManager.getMesh(idB)
  if (!meshA || !meshB) return null

  try {
    // Extract geometries — works for both simple meshes and electronics groups.
    // extractGeometry() already applies the world transform so both geos are in world space.
    const geoA = extractGeometry(meshA)
    const geoB = extractGeometry(meshB)
    if (!geoA || !geoB) return null

    // Clone a representative material (use first mesh material for groups)
    const getMat = (obj) => {
      if (obj.isMesh && obj.material) return obj.material.clone()
      let mat = null
      obj.traverse(c => { if (c.isMesh && c.material && !mat) mat = c.material.clone() })
      return mat ?? new THREE.MeshStandardMaterial({ color: '#888' })
    }
    const matA = getMat(meshA)
    const matB = getMat(meshB)

    const brushA = new Brush(geoA, matA)
    brushA.updateMatrixWorld(true)

    const brushB = new Brush(geoB, matB)
    brushB.updateMatrixWorld(true)

    let source, cutter, op, resultColor
    if (operation === 'subtractB') {
      source = brushB; cutter = brushA; op = SUBTRACTION
      resultColor = '#' + meshB.material.color.getHexString()
    } else if (operation === 'union') {
      source = brushA; cutter = brushB; op = ADDITION
      resultColor = '#' + meshA.material.color.getHexString()
    } else if (operation === 'subtract') {
      source = brushA; cutter = brushB; op = SUBTRACTION
      resultColor = '#' + meshA.material.color.getHexString()
    } else if (operation === 'intersect') {
      source = brushA; cutter = brushB; op = INTERSECTION
      resultColor = '#' + meshA.material.color.getHexString()
    } else {
      return null
    }

    const result = evaluator.evaluate(source, cutter, op)
    result.geometry.computeBoundingBox()

    // Center the geometry at its bounding-box midpoint and record that center as the
    // mesh's world position.  Without this the CSG mesh sits at (0,0,0) with
    // world-space vertex coordinates, so the transform gizmo appears at the scene
    // origin instead of at the combined shape.
    const center = new THREE.Vector3()
    result.geometry.boundingBox.getCenter(center)
    result.geometry.translate(-center.x, -center.y, -center.z)

    const geometryJSON = result.geometry.toJSON()

    // Dispose only what we created — never touch the original mesh materials.
    result.geometry.dispose()
    if (Array.isArray(result.material)) result.material.forEach(m => m?.dispose?.())
    else result.material?.dispose?.()
    geoA.dispose()
    geoB.dispose()
    matA.dispose()
    matB.dispose()

    return {
      geometryJSON,
      color:    resultColor,
      position: { x: center.x, y: center.y, z: center.z },
    }
  } catch (err) {
    console.error('[CSG] Boolean operation failed:', err?.message ?? err)
    return null
  }
}

// ── De-union support ─────────────────────────────────────────────────────────
// A union stores a flat list of its leaf members so it can be reversed. Each
// member keeps the original object definition (to restore it) AND a snapshot of
// its WORLD-space geometry at union time (to rebuild the union without it).

// Capture a live object's world-space geometry as JSON, normalized to
// position + normal only. Consistent attributes across members are REQUIRED —
// otherwise re-unioning them via the CSG evaluator fails (uv/color mismatches).
export function captureWorldGeometryJSON(id) {
  const mesh = objectManager.getMesh(id)
  if (!mesh) return null
  const g = extractGeometry(mesh)
  if (!g) return null
  const clean = new THREE.BufferGeometry()
  if (g.index) clean.setIndex(g.index.clone())
  if (g.attributes.position) clean.setAttribute('position', g.attributes.position.clone())
  if (g.attributes.normal) clean.setAttribute('normal', g.attributes.normal.clone())
  else if (g.attributes.position) clean.computeVertexNormals()
  const json = clean.toJSON()
  g.dispose?.()
  clean.dispose?.()
  return json
}

// Flatten two operands into a flat leaf-member list (def + world geometry). If an
// operand is itself a union, its members are inlined so the list is always flat.
export function buildUnionMembers(objA, objB) {
  const leaf = (obj) => {
    if (Array.isArray(obj.unionMembers) && obj.unionMembers.length) return obj.unionMembers
    const clean = JSON.parse(JSON.stringify(obj))
    delete clean.unionMembers
    delete clean.groupMembers
    return [{ def: clean, geo: captureWorldGeometryJSON(obj.id) }]
  }
  return [...leaf(objA), ...leaf(objB)]
}

// Union a list of WORLD-space geometry JSONs into one centered result.
// Returns { geometryJSON, position } or null.
export function unionWorldGeoJSONs(list) {
  const loader = new THREE.BufferGeometryLoader()
  // Normalize to position + normal, NON-indexed — the form both the CSG evaluator
  // and mergeGeometries accept, and consistent across all members.
  const norm = (parsed) => {
    const g = parsed.index ? parsed.toNonIndexed() : parsed
    const c = new THREE.BufferGeometry()
    if (g.attributes.position) c.setAttribute('position', g.attributes.position.clone())
    if (g.attributes.normal) c.setAttribute('normal', g.attributes.normal.clone())
    else if (g.attributes.position) { c.computeVertexNormals() }
    return c
  }
  const geos = (list || [])
    .map((j) => { try { return j ? norm(loader.parse(j)) : null } catch { return null } })
    .filter(Boolean)
  if (geos.length === 0) return null

  let outGeo = null
  // 1) Preferred: a real CSG union (clean, no internal faces).
  try {
    const mat = new THREE.MeshStandardMaterial()
    let acc = new Brush(geos[0].clone(), mat); acc.updateMatrixWorld(true)
    for (let i = 1; i < geos.length; i++) {
      const b = new Brush(geos[i].clone(), mat); b.updateMatrixWorld(true)
      acc = evaluator.evaluate(acc, b, ADDITION)
      acc.updateMatrixWorld(true)
    }
    outGeo = acc.geometry
    mat.dispose?.()
  } catch (err) {
    console.warn('[CSG] evaluator re-union failed, falling back to merge:', err?.message ?? err)
    outGeo = null
  }

  // 2) Fallback: just merge the pieces into one geometry. Always works; keeps the
  //    remaining members together as a single object (may keep internal faces).
  if (!outGeo) {
    try { outGeo = mergeGeometries(geos, false) } catch (e) { console.error('[CSG] merge failed:', e); }
  }
  if (!outGeo) { geos.forEach((g) => g.dispose?.()); return null }

  outGeo.computeBoundingBox()
  const center = new THREE.Vector3(); outGeo.boundingBox.getCenter(center)
  outGeo.translate(-center.x, -center.y, -center.z)
  const geometryJSON = outGeo.toJSON()
  geos.forEach((g) => g.dispose?.())
  return { geometryJSON, position: { x: center.x, y: center.y, z: center.z } }
}
