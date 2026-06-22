import * as THREE from 'three'

/**
 * ExtrudeTool — extrudes a single face of a BufferGeometry.
 *
 * Algorithm:
 *  1. Find the face whose center is closest to the given face-normal direction.
 *  2. Collect all triangles that share that normal direction.
 *  3. Build a new mesh: existing geometry + new faces formed by extruding the chosen face.
 *
 * Works on: box, sphere (flat-ish faces), cylinder caps, cone base, CSG results.
 */

const _face_dirs = {
  '+x': new THREE.Vector3(1,0,0),
  '-x': new THREE.Vector3(-1,0,0),
  '+y': new THREE.Vector3(0,1,0),
  '-y': new THREE.Vector3(0,-1,0),
  '+z': new THREE.Vector3(0,0,1),
  '-z': new THREE.Vector3(0,0,-1),
}

/**
 * Get the set of canonical face directions for an object
 */
export function getFaceDirections() {
  return Object.keys(_face_dirs)
}

/**
 * Extrude the face of a geometry that points in `faceDir`, by `amount` scene units.
 *
 * @param {THREE.BufferGeometry} geometry - source geometry (must be non-indexed or will be converted)
 * @param {string|THREE.Vector3} faceDir  - '+x'/'-x'/'+y'/'-y'/'+z'/'-z' or a Vector3
 * @param {number} amount                 - extrusion distance (negative = inset)
 * @returns {THREE.BufferGeometry}        - new geometry with extruded face
 */
export function extrudeFace(geometry, faceDir, amount) {
  // Convert indexed → non-indexed for easy triangle manipulation
  const src = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  src.computeVertexNormals()

  const normal = faceDir instanceof THREE.Vector3
    ? faceDir.clone().normalize()
    : _face_dirs[faceDir]?.clone() ?? new THREE.Vector3(0, 1, 0)

  const positions = src.attributes.position
  const normals   = src.attributes.normal
  const count     = positions.count

  // ── Step 1: identify triangles belonging to the selected face ──────────────
  const NORMAL_DOT_THRESHOLD = 0.8   // cos(37°) — triangles whose normal is within 37° of faceDir

  const selectedTris = []   // triangle index
  for (let i = 0; i < count; i += 3) {
    // Average face normal
    const nx = (normals.getX(i) + normals.getX(i+1) + normals.getX(i+2)) / 3
    const ny = (normals.getY(i) + normals.getY(i+1) + normals.getY(i+2)) / 3
    const nz = (normals.getZ(i) + normals.getZ(i+1) + normals.getZ(i+2)) / 3
    const fn = new THREE.Vector3(nx, ny, nz).normalize()
    if (fn.dot(normal) >= NORMAL_DOT_THRESHOLD) {
      selectedTris.push(i)
    }
  }

  if (selectedTris.length === 0) return src   // nothing to extrude

  // ── Step 2: collect unique vertices on the selected face ───────────────────
  const selectedVertIndices = new Set()
  for (const i of selectedTris) {
    selectedVertIndices.add(i)
    selectedVertIndices.add(i + 1)
    selectedVertIndices.add(i + 2)
  }

  // ── Step 3: compute extrusion delta ───────────────────────────────────────
  const delta = normal.clone().multiplyScalar(amount)

  // ── Step 4: build new geometry ────────────────────────────────────────────
  // Original vertices + displaced copies
  const origPos = []
  for (let i = 0; i < count; i++) {
    origPos.push(positions.getX(i), positions.getY(i), positions.getZ(i))
  }

  // Move selected vertices by delta
  const newPosArr = [...origPos]
  for (const vi of selectedVertIndices) {
    newPosArr[vi * 3]     += delta.x
    newPosArr[vi * 3 + 1] += delta.y
    newPosArr[vi * 3 + 2] += delta.z
  }

  // Find boundary edges of selected face (edges shared by exactly one selected triangle)
  const edgeCount = new Map()
  for (const i of selectedTris) {
    for (const [a, b] of [[i, i+1], [i+1, i+2], [i+2, i]]) {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
    }
  }

  const boundaryEdges = []   // [v0, v1] pairs (indices into positions)
  for (const [key, cnt] of edgeCount) {
    if (cnt === 1) {
      const [a, b] = key.split('_').map(Number)
      boundaryEdges.push([a, b])
    }
  }

  // Build side quads for each boundary edge
  const sideTris = []
  for (const [a, b] of boundaryEdges) {
    // Quad: a_orig, b_orig, b_new, a_new  (2 triangles, winding = outward)
    // Original positions
    const ax = origPos[a * 3], ay = origPos[a * 3 + 1], az = origPos[a * 3 + 2]
    const bx = origPos[b * 3], by = origPos[b * 3 + 1], bz = origPos[b * 3 + 2]
    // New (displaced) positions
    const axn = ax + delta.x, ayn = ay + delta.y, azn = az + delta.z
    const bxn = bx + delta.x, byn = by + delta.y, bzn = bz + delta.z
    // Tri 1: a_orig, b_new, b_orig
    sideTris.push(ax, ay, az, bxn, byn, bzn, bx, by, bz)
    // Tri 2: a_orig, a_new, b_new
    sideTris.push(ax, ay, az, axn, ayn, azn, bxn, byn, bzn)
  }

  // Concatenate: original vertices (moved on selected face) + side walls
  const finalPos = [...newPosArr, ...sideTris]
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(finalPos, 3))
  result.computeVertexNormals()

  return result
}

/**
 * Get the center position of the face in a given direction (world space, mesh assumed at origin).
 */
export function getFaceCenter(mesh, faceDir) {
  const normal = faceDir instanceof THREE.Vector3
    ? faceDir.clone()
    : _face_dirs[faceDir]?.clone() ?? new THREE.Vector3(0, 1, 0)

  const box = new THREE.Box3().setFromObject(mesh)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  return center.clone().addScaledVector(normal, Math.max(size.x, size.y, size.z) * 0.5)
}
