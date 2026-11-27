// ─────────────────────────────────────────────────────────────────────────────
// Tinkercad sketch shapes: Extrude Sketch and Revolve Sketch.
//
// A sketch is a closed profile stored ON the scene object as plain data, so it
// saves, loads, undoes and can be re-edited:
//
//   obj.sketch = { points: [[x, y, k], …] }      (scene units)
//     k = 0  an on-curve point (a corner: straight lines meet here)
//     k = 1  a curve handle (off-curve Bézier control point)
//
// Between two on-curve points: no handle → straight line, one handle →
// quadratic Bézier, two handles → cubic Bézier, more → a chain of quadratics
// through the implied mid-points (TrueType style). The profile always closes
// back on its first point.
//
//   Extrude Sketch: the profile (drawn in a top view) extruded upward by
//                   obj.height.
//   Revolve Sketch: the profile (drawn beside the axis, x = radius ≥ 0, y = up)
//                   spun about Y by obj.angle degrees; a partial angle gets two
//                   flat end caps so the solid stays closed.
//
// Everything here is pure geometry; the editor is components/SketchPad.jsx.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export const SKETCH_TYPES = new Set(['extrude_sketch', 'revolve_sketch'])
export const isSketchType = (t) => SKETCH_TYPES.has(t)

// Default profiles (used for a new sketch and as a safe fallback).
export const DEFAULT_SKETCH = {
  // A block with an arched (cubic Bézier) top.
  extrude_sketch: { points: [[-1, -1, 0], [1, -1, 0], [1, 0.3, 0], [1, 1.4, 1], [-1, 1.4, 1], [-1, 0.3, 0]] },
  // A vase: flat foot, straight wall, a quadratic waist, flat rim, back down the axis.
  revolve_sketch: { points: [[0, -1, 0], [0.9, -1, 0], [0.9, -0.4, 0], [0.25, 0.25, 1], [0.7, 1, 0], [0, 1, 0]] },
}

const CURVE_DIV = 12          // samples per curved span
const EPS = 1e-9

/** Clean a raw point list: finite numbers, kind 0/1, at most 400 points. */
export function normalizeSketchPoints(points) {
  if (!Array.isArray(points)) return []
  return points.slice(0, 400)
    .map((p) => [Number(p?.[0]), Number(p?.[1]), p?.[2] ? 1 : 0])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y, k]) => [+x.toFixed(4), +y.toFixed(4), k])
}

/**
 * Sample a closed sketch into a polygon (array of THREE.Vector2, no repeated
 * closing point). Returns [] when the sketch can't form a profile.
 */
export function sketchToPolygon(points, div = CURVE_DIV) {
  const pts = normalizeSketchPoints(points)
  if (pts.length < 3) return []
  const start = pts.findIndex((p) => p[2] === 0)
  if (start < 0) return []
  const ring = [...pts.slice(start), ...pts.slice(0, start)]
  const V = (p) => new THREE.Vector2(p[0], p[1])
  const out = []
  const n = ring.length
  let i = 0
  while (i < n) {
    const a = ring[i]
    // collect handles until the next on-curve point (wrapping to the start)
    const ctrl = []
    let j = i + 1
    while (j < n && ring[j][2] === 1) { ctrl.push(ring[j]); j++ }
    const b = ring[j % n]
    out.push(V(a))
    if (ctrl.length === 1) {
      const c = new THREE.QuadraticBezierCurve(V(a), V(ctrl[0]), V(b))
      out.push(...c.getPoints(div).slice(1, -1))
    } else if (ctrl.length === 2) {
      const c = new THREE.CubicBezierCurve(V(a), V(ctrl[0]), V(ctrl[1]), V(b))
      out.push(...c.getPoints(div).slice(1, -1))
    } else if (ctrl.length > 2) {
      // implied on-curve points halfway between consecutive handles
      let from = V(a)
      for (let k = 0; k < ctrl.length; k++) {
        const to = k === ctrl.length - 1 ? V(b) : V(ctrl[k]).add(V(ctrl[k + 1])).multiplyScalar(0.5)
        const c = new THREE.QuadraticBezierCurve(from, V(ctrl[k]), to)
        out.push(...c.getPoints(div).slice(1, k === ctrl.length - 1 ? -1 : undefined))
        from = to
      }
    }
    i = j
  }
  // drop consecutive duplicates (and a closing duplicate)
  const clean = []
  for (const p of out) if (!clean.length || clean.at(-1).distanceToSquared(p) > 1e-12) clean.push(p)
  while (clean.length > 1 && clean[0].distanceToSquared(clean.at(-1)) <= 1e-12) clean.pop()
  return clean
}

/** Signed area (counter-clockwise > 0). */
export function polygonArea(poly) {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4)
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
}

/** Does any pair of non-adjacent edges cross? */
export function selfIntersects(poly) {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a1 = poly[i], a2 = poly[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue          // these two share the closing vertex
      if (segmentsCross(a1, a2, poly[j], poly[(j + 1) % n])) return true
    }
  }
  return false
}

/**
 * Why a sketch can't become a solid (null = it can).
 * `mode` 'revolve' also requires every point on the radius side (x ≥ 0).
 */
export function sketchIssue(points, mode = 'extrude') {
  const pts = normalizeSketchPoints(points)
  if (pts.length < 3) return 'Add at least three points.'
  if (!pts.some((p) => p[2] === 0)) return 'At least one point must be a corner (not a curve handle).'
  if (mode === 'revolve' && pts.some((p) => p[0] < -1e-6)) return 'Keep the profile on the right of the axis.'
  const poly = sketchToPolygon(pts)
  if (poly.length < 3 || Math.abs(polygonArea(poly)) < 1e-4) return 'The profile has no area.'
  if (selfIntersects(poly)) return 'The profile crosses itself.'
  return null
}

const usable = (obj, type) => {
  const pts = obj?.sketch?.points
  return pts && !sketchIssue(pts, type === 'revolve_sketch' ? 'revolve' : 'extrude') ? pts : DEFAULT_SKETCH[type].points
}

/** Extrude Sketch: profile in the top view, extruded up by `height`, centred. */
export function createExtrudeSketchGeometry(obj = {}, height = 1) {
  const poly = sketchToPolygon(usable(obj, 'extrude_sketch'))
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly), { depth: height, bevelEnabled: false, curveSegments: 1 })
  g.rotateX(-Math.PI / 2)                     // sketch y → world −z (top view), depth → +Y
  g.computeBoundingBox()
  const c = g.boundingBox.getCenter(new THREE.Vector3())
  g.translate(-c.x, -c.y, -c.z)
  return g
}

/**
 * Revolve Sketch: profile (x = radius, y = height) spun about Y. The axis stays
 * at the object's origin; the solid is centred vertically. A partial angle is
 * closed with two flat caps (the profile, triangulated) so it stays watertight.
 */
export function createRevolveSketchGeometry(obj = {}, angleDeg = 360, segments = 48) {
  let poly = sketchToPolygon(usable(obj, 'revolve_sketch')).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y))
  if (polygonArea(poly) < 0) poly = poly.reverse()       // CCW → LatheGeometry normals point outward
  const full = angleDeg >= 359.999
  const phi = (Math.min(360, Math.max(1, angleDeg)) * Math.PI) / 180
  const seg = Math.max(3, Math.round(full ? segments : Math.max(2, segments * (angleDeg / 360))))
  const lathe = new THREE.LatheGeometry([...poly, poly[0].clone()], seg, 0, full ? Math.PI * 2 : phi)
  let g
  if (full) {
    g = lathe
  } else {
    lathe.deleteAttribute('uv')
    const flat = lathe.toNonIndexed()
    lathe.dispose()
    const tris = THREE.ShapeUtils.triangulateShape(poly, [])
    const at = (p, a) => new THREE.Vector3(p.x * Math.sin(a), p.y, p.x * Math.cos(a))
    const caps = []
    for (const [a, sgn] of [[0, -1], [phi, 1]]) {
      // outward = ∓ the direction of increasing angle at this end
      const out = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(sgn)
      for (const [i, j, k] of tris) {
        let A = at(poly[i], a), B = at(poly[j], a), C = at(poly[k], a)
        const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A))
        if (n.dot(out) < 0) [B, C] = [C, B]
        caps.push(A, B, C)
      }
    }
    const cap = new THREE.BufferGeometry().setFromPoints(caps)
    cap.computeVertexNormals()
    g = mergeGeometries([flat, cap], false)
    flat.dispose(); cap.dispose()
  }
  g.computeBoundingBox()
  const cy = (g.boundingBox.min.y + g.boundingBox.max.y) / 2
  g.translate(0, -cy, 0)
  return g
}
