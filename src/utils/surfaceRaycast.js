import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

// Nearest-hit raycasting for interactive placement (SurfaceMountManager), fast
// enough to run every frame of a drag in scenes full of detailed GLB boards.
//
//  • Heavy geometries get a BVH (three-mesh-bvh). BVHs live in a private
//    WeakMap — never on geometry.boundsTree — and are built `indirect`, so no
//    geometry is modified and every other raycast in the app (and three-bvh-csg)
//    behaves exactly as before.
//  • Candidates are visited front-to-back by where the ray enters their bounding
//    sphere, stopping once nothing further can beat the closest hit.

//  • Skinned meshes (e.g. the rocket pod GLB) are raycast against their pose
//    baked ONCE into a private static geometry (skinned positions ≠ geometry
//    positions, and three's per-vertex skinned raycast cost ~17 ms for an 11k-
//    triangle pod — every shot trace through such a robot paid it). Weapons and
//    boards are never animated, so the baked pose stays exact; the object's
//    live world matrix is still applied at raycast time.

const BVH_MIN_TRIANGLES = 2000
const _bvh = new WeakMap()
const _baked = new WeakMap()                   // skinned mesh → static geometry of its pose
const _sphere = new THREE.Sphere()
const _entry = new THREE.Vector3()

// The geometry a mesh is raycast against (skinned → its baked pose).
function geometryFor(mesh) {
  if (!mesh.isSkinnedMesh) return mesh.geometry
  let g = _baked.get(mesh)
  if (!g) {
    const src = mesh.geometry, pos = src.attributes.position
    const out = new Float32Array(pos.count * 3), v = new THREE.Vector3()
    // Bones and mesh must agree on where they are NOW (a caller may have just
    // moved the robot without a render): refresh both, and the bind inverse.
    for (const b of mesh.skeleton?.bones || []) b.updateWorldMatrix(true, false)
    mesh.updateWorldMatrix(true, false)
    if (mesh.bindMode === 'attached') mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert()
    if (mesh.skeleton) mesh.skeleton.update()
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); mesh.applyBoneTransform(i, v); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z }
    g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(out, 3))
    if (src.index) g.setIndex(src.index)
    g.computeBoundingSphere()
    _baked.set(mesh, g)
  }
  return g
}

function bvhFor(mesh) {
  const g = geometryFor(mesh)
  let b = _bvh.get(g)
  if (b === undefined) {
    b = null
    const pos = g.attributes?.position
    const tris = (g.index ? g.index.count : pos?.count ?? 0) / 3
    // (a skinned mesh always gets one — its baked pose is only reachable through it)
    if (pos && (tris >= BVH_MIN_TRIANGLES || mesh.isSkinnedMesh) && !g.morphAttributes?.position?.length) {
      try { b = new MeshBVH(g, { indirect: true, setBoundingBox: false }) } catch (_) { b = null }
    }
    _bvh.set(g, b)
  }
  return b
}

/** Build BVHs up front (e.g. when a drag starts) so the first frames don't hitch. */
export function prepareSurfaceRaycast(meshes) {
  for (const m of meshes) bvhFor(m)
}

/**
 * Closest intersection (with a face) among `meshes`, or null.
 * `accept(hit)` can reject hits (they are skipped, not treated as blockers).
 */
export function raycastFirst(raycaster, meshes, accept = null) {
  const { ray } = raycaster
  const order = []
  for (const m of meshes) {
    let enter = 0
    const g = geometryFor(m)
    if (!g.boundingSphere) g.computeBoundingSphere()
    _sphere.copy(g.boundingSphere).applyMatrix4(m.matrixWorld)
    if (!_sphere.containsPoint(ray.origin)) {
      if (!ray.intersectSphere(_sphere, _entry)) continue
      enter = _entry.distanceTo(ray.origin)
    }
    order.push({ enter, m })
  }
  order.sort((a, b) => a.enter - b.enter)

  const prevFirstOnly = raycaster.firstHitOnly
  raycaster.firstHitOnly = true
  const hits = []
  let best = null
  for (const { enter, m } of order) {
    if (best && enter > best.distance) break
    hits.length = 0
    const bvh = bvhFor(m)
    if (bvh) bvh.raycastObject3D(m, raycaster, hits)
    else m.raycast(raycaster, hits)
    for (const h of hits) {
      if (!h.face || h.distance < raycaster.near || h.distance > raycaster.far) continue
      if (accept && !accept(h)) continue
      if (!best || h.distance < best.distance) best = h
    }
  }
  raycaster.firstHitOnly = prevFirstOnly
  return best
}
