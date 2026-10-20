import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// Robust world bounds of a part (or assembly) for sizing PHYSICS bodies.
//
// Box3.setFromObject / expandByObject are wrong for that job here:
//  • they include invisible helpers (pin spheres / pin labels / selection
//    outlines / decals) that only exist for the editor;
//  • some GLBs carry stray far-off geometry — subo.glb's SUBO_Mesh_2/13/19/20
//    have ~10k triangles up to 40 su from a 6.8 su board, but those triangles
//    are collapsed slivers (0.03 su² in total) that render as nothing — so a
//    raw box (even the "precise" vertex one) is ~10× too big.
//
// So: visible meshes only, helpers skipped, then over ALL of the object's
// triangles together (world space):
//   1. core  = the area-weighted [CORE, 1-CORE] extent per axis — where the
//              part's real surface is;
//   2. reach = core grown by one core size (+ a small floor) on every side;
//   3. box   = the EXACT extent of every triangle lying wholly inside reach.
// Real detail on a part (a connector, a barrel tip) is inside reach and kept
// whole; far-off junk — SUBO's slivers ~10 core sizes away, even a whole junk
// mesh like SUBO_Mesh_20 — can never get in. Runs once per part when a match
// starts (and when a part breaks off), never per frame.
// ─────────────────────────────────────────────────────────────────────────────

const CORE = 0.05                  // area share trimmed off each end for the core estimate
const REACH_FLOOR = 0.5            // su — minimum growth of the core (thin parts)
const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()

const HELPER_FLAGS = ['isPin', 'isPinSphere', 'isPinLabel', 'isSelectionOutline', 'isAttachMarker', 'isCombatDecal', 'isMountPreview', 'isPatchMesh', 'isWire', 'isWireHandle', 'isWireLine']

const isHelper = (o) => { const u = o.userData; return !!u && HELPER_FLAGS.some(f => u[f]) }

/**
 * Expand `target` by the robust bounds of `root` and its visible descendants.
 * `frame` (optional Matrix4) is applied after matrixWorld, so bounds can be taken
 * in another frame (the arena measures robots in their own heading frame — an
 * oriented box, not a bloated world-axis one for a diagonal robot).
 */
export function expandByRobust(target, root, frame = null) {
  root.updateWorldMatrix(true, true)
  const area = [], lo = [[], [], []], hi = [[], [], []]
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), tri = new THREE.Triangle(A, B, C)
  let total = 0
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry || isHelper(o)) return
    const pos = o.geometry.attributes?.position
    if (!pos || pos.count < 3) return
    const idx = o.geometry.index
    const M = frame ? _m.multiplyMatrices(frame, o.matrixWorld) : o.matrixWorld
    const n = Math.floor((idx ? idx.count : pos.count) / 3)
    for (let t = 0; t < n; t++) {
      const ia = idx ? idx.getX(3 * t) : 3 * t, ib = idx ? idx.getX(3 * t + 1) : 3 * t + 1, ic = idx ? idx.getX(3 * t + 2) : 3 * t + 2
      A.fromBufferAttribute(pos, ia).applyMatrix4(M); B.fromBufferAttribute(pos, ib).applyMatrix4(M); C.fromBufferAttribute(pos, ic).applyMatrix4(M)
      const a = tri.getArea()
      if (!(a >= 0)) continue                                  // NaN guard
      area.push(a); total += a
      for (let k = 0; k < 3; k++) {
        const x = A.getComponent(k), y = B.getComponent(k), z = C.getComponent(k)
        lo[k].push(Math.min(x, y, z)); hi[k].push(Math.max(x, y, z))
      }
    }
  })
  const m = area.length
  if (!m) return target
  if (!(total > 0)) {                                          // all degenerate: plain extents
    for (let k = 0; k < 3; k++) { _v.setComponent(k, Math.min(...lo[k])) } target.expandByPoint(_v)
    for (let k = 0; k < 3; k++) { _v.setComponent(k, Math.max(...hi[k])) } target.expandByPoint(_v)
    return target
  }
  const order = new Uint32Array(m)
  const quantile = (vals, fromTop) => {
    for (let i = 0; i < m; i++) order[i] = i
    order.sort((i, j) => fromTop ? vals[j] - vals[i] : vals[i] - vals[j])
    let acc = 0
    for (let i = 0; i < m; i++) { acc += area[order[i]]; if (acc > CORE * total) return vals[order[i]] }
    return vals[order[m - 1]]
  }
  const cMin = new THREE.Vector3(), cMax = new THREE.Vector3()
  for (let k = 0; k < 3; k++) { cMin.setComponent(k, quantile(lo[k], false)); cMax.setComponent(k, quantile(hi[k], true)) }
  const grow = Math.max(REACH_FLOOR, cMax.x - cMin.x, cMax.y - cMin.y, cMax.z - cMin.z)
  const rMin = cMin.clone().subScalar(grow), rMax = cMax.clone().addScalar(grow)
  const box = new THREE.Box3()
  for (let i = 0; i < m; i++) {
    let inside = true
    for (let k = 0; k < 3 && inside; k++) inside = lo[k][i] >= rMin.getComponent(k) && hi[k][i] <= rMax.getComponent(k)
    if (!inside) continue
    _v.set(lo[0][i], lo[1][i], lo[2][i]); box.expandByPoint(_v)
    _v.set(hi[0][i], hi[1][i], hi[2][i]); box.expandByPoint(_v)
  }
  if (!box.isEmpty()) target.union(box)
  return target
}

/** Robust world bounds of one object tree (empty Box3 if it has no visible mesh). */
export function robustWorldBox(root) { return expandByRobust(new THREE.Box3(), root) }
