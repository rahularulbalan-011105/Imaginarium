// Shared geometry checks for the 3D Design tests (same rules as shapes.test.js).
import { Vector3 } from 'three'

// Closed mesh: after welding coincident vertices every edge is shared by exactly
// two triangles (degenerate pole/axis triangles are ignored).
export function isWatertight(geo) {
  const pos = geo.attributes.position, idx = geo.index
  const key = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => Math.round(v * 1e4)).join(',')
  const tri = idx ? idx.count / 3 : pos.count / 3
  const at = (t, k) => key(idx ? idx.getX(t * 3 + k) : t * 3 + k)
  const edges = new Map()
  for (let t = 0; t < tri; t++) {
    const v = [at(t, 0), at(t, 1), at(t, 2)]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], k = a < b ? a + '|' + b : b + '|' + a
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  return edges.size > 0 && [...edges.values()].every(n => n === 2)
}

/** Signed enclosed volume (positive when the faces point outward). */
export function signedVolume(geo) {
  const p = geo.attributes.position, idx = geo.index, n = idx ? idx.count : p.count
  const v = (k) => { const i = idx ? idx.getX(k) : k; return new Vector3(p.getX(i), p.getY(i), p.getZ(i)) }
  let s = 0
  for (let k = 0; k < n; k += 3) s += v(k).dot(v(k + 1).cross(v(k + 2))) / 6
  return s
}
export const volume = (geo) => Math.abs(signedVolume(geo))
export const sizeOf = (g) => { g.computeBoundingBox(); return g.boundingBox.getSize(new Vector3()) }
