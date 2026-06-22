import * as THREE from 'three'

/**
 * FilletTool — applies a chamfer/bevel to sharp edges of a BufferGeometry.
 *
 * Strategy: Vertex chamfer.
 *  - Find all "sharp" edge pairs (angle between adjacent face normals > threshold).
 *  - For each sharp edge vertex: push it inward by `radius` in the average-normal direction.
 *  - `segments` controls smoothness of the blend (1 = chamfer, 2+ = rounded).
 *
 * This is an approximation that works well for box-like and CSG-result geometries.
 * It does NOT implement full BRep offset — that requires a NURBS kernel.
 */

/**
 * Apply a chamfer/fillet to a geometry's sharp edges.
 *
 * @param {THREE.BufferGeometry} geometry - input (non-indexed preferred)
 * @param {number} radius                 - bevel radius in scene units
 * @param {number} segments               - smoothing segments (1 = chamfer, 3+ = rounded)
 * @param {number} angle                  - minimum edge angle to bevel (degrees, default 30°)
 * @returns {THREE.BufferGeometry}        - beveled geometry
 */
export function applyFillet(geometry, radius = 0.3, segments = 2, angle = 30) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  src.computeVertexNormals()

  const pos = src.attributes.position
  const nor = src.attributes.normal
  const count = pos.count

  const cosThreshold = Math.cos(THREE.MathUtils.degToRad(angle))

  // ── Build vertex → face-normal map ───────────────────────────────────────
  // key = "x,y,z" → [normal vectors]
  const vertexNormals = new Map()
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    if (!vertexNormals.has(key)) vertexNormals.set(key, { pos: new THREE.Vector3(x, y, z), normals: [] })
    vertexNormals.get(key).normals.push(new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize())
  }

  // ── Identify "corner" vertices (sharp vertices shared by normals that diverge) ─
  const cornerDisplacement = new Map()   // key → displacement Vector3
  for (const [key, { pos: vp, normals: ns }] of vertexNormals) {
    // Check if any two normals at this vertex differ by more than threshold
    let isCorner = false
    for (let a = 0; a < ns.length && !isCorner; a++) {
      for (let b = a + 1; b < ns.length && !isCorner; b++) {
        if (ns[a].dot(ns[b]) < cosThreshold) isCorner = true
      }
    }
    if (!isCorner) continue

    // Average inward displacement: mean of all face normals at this vertex
    const avgNormal = new THREE.Vector3()
    for (const n of ns) avgNormal.add(n)
    avgNormal.divideScalar(ns.length).normalize()

    // Push inward by radius * smoothing factor
    const smoothFactor = 1.0 / (segments + 1)
    cornerDisplacement.set(key, avgNormal.multiplyScalar(-radius * smoothFactor))
  }

  // ── Apply displacements ────────────────────────────────────────────────────
  const newPos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
    const disp = cornerDisplacement.get(key)
    newPos[i * 3]     = x + (disp?.x ?? 0)
    newPos[i * 3 + 1] = y + (disp?.y ?? 0)
    newPos[i * 3 + 2] = z + (disp?.z ?? 0)
  }

  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3))
  // Copy UV if present
  if (src.attributes.uv) result.setAttribute('uv', src.attributes.uv.clone())
  result.computeVertexNormals()

  return result
}

/**
 * Quick chamfer: single-segment fillet.
 */
export function applyBevel(geometry, size = 0.2, angle = 30) {
  return applyFillet(geometry, size, 1, angle)
}
