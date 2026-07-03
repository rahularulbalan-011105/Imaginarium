import * as THREE from 'three'
import { Evaluator, Brush, INTERSECTION, SUBTRACTION } from 'three-bvh-csg'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { objectManager } from '../managers/ObjectManager.js'

// ── Slice tool ───────────────────────────────────────────────────────────────
// "Knife through view": the user draws a screen-space polyline across a shape.
// We project it onto a plane facing the camera (through the shape's centre),
// close it into a one-sided region, extrude that region along the camera's view
// direction into a cutting SOLID that passes through the whole shape, then use
// CSG to produce the two pieces:
//   pieceA = shape ∩ cutter      (the side the region covers)
//   pieceB = shape − cutter      (the other side)

const evaluator = new Evaluator()
evaluator.useGroups = false   // slicing ignores materials/groups — geometry only

// World-space geometry of a mesh or group (transforms baked in).
function worldGeometry(object3d) {
  if (!object3d) return null
  if (object3d.isMesh && object3d.geometry) {
    const g = object3d.geometry.clone()
    object3d.updateMatrixWorld(true)
    g.applyMatrix4(object3d.matrixWorld)
    return g
  }
  const geos = []
  object3d.updateMatrixWorld(true)
  object3d.traverse(c => {
    if (!c.isMesh || !c.geometry) return
    c.updateMatrixWorld(true)
    const g = c.geometry.clone(); g.applyMatrix4(c.matrixWorld)
    const out = new THREE.BufferGeometry()
    if (g.attributes.position) out.setAttribute('position', g.attributes.position)
    if (g.attributes.normal)   out.setAttribute('normal', g.attributes.normal)
    geos.push(out)
  })
  if (!geos.length) return null
  return geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
}

// Centre a CSG result at its bounding-box midpoint and return the gizmo-correct
// { geometryJSON, position } (same convention as csg.js runBoolean).
function centerResult(result, color) {
  const geo = result.geometry
  geo.computeBoundingBox()
  if (!geo.boundingBox) return null
  const center = new THREE.Vector3()
  geo.boundingBox.getCenter(center)
  // Reject empty/degenerate results (a piece that captured nothing).
  const size = new THREE.Vector3(); geo.boundingBox.getSize(size)
  if (size.length() < 1e-4) return null
  geo.translate(-center.x, -center.y, -center.z)
  const json = geo.toJSON()
  return { geometryJSON: json, color, position: { x: center.x, y: center.y, z: center.z } }
}

// Ray from P (inside the square) in direction D → the point where it meets the
// square boundary [-L,L]². Returns a Vector2 or null.
function toBoundary(P, D, L) {
  const cands = [(L - P.x) / D.x, (-L - P.x) / D.x, (L - P.y) / D.y, (-L - P.y) / D.y]
  let best = Infinity, pt = null
  for (const t of cands) {
    if (!isFinite(t) || t <= 1e-6) continue
    const x = P.x + t * D.x, y = P.y + t * D.y
    if (Math.abs(x) <= L + 1e-3 && Math.abs(y) <= L + 1e-3 && t < best) { best = t; pt = new THREE.Vector2(x, y) }
  }
  return pt
}

// Perimeter parameter [0,4) of a boundary point, walking CCW from bottom-left.
function perimParam(p, L) {
  const e = 1e-2
  if (Math.abs(p.y + L) < e) return (p.x + L) / (2 * L)              // bottom  [0,1)
  if (Math.abs(p.x - L) < e) return 1 + (p.y + L) / (2 * L)          // right   [1,2)
  if (Math.abs(p.y - L) < e) return 2 + (L - p.x) / (2 * L)          // top     [2,3)
  return 3 + (L - p.y) / (2 * L)                                     // left    [3,4)
}

// Square corners passed when walking the perimeter CCW from `from` to `to`.
function perimeterCorners(from, to, L) {
  const CORNERS = [
    new THREE.Vector2(L, -L), new THREE.Vector2(L, L),
    new THREE.Vector2(-L, L), new THREE.Vector2(-L, -L),
  ]
  const a = perimParam(from, L)
  let b = perimParam(to, L)
  if (b <= a) b += 4
  const out = []
  for (let k = Math.floor(a) + 1; k < b - 1e-6 && out.length < 6; k++) {
    out.push(CORNERS[((k - 1) % 4 + 4) % 4])
  }
  return out
}

/**
 * Slice `objectId` along the screen-space polyline (array of {x,y} client px).
 * Returns { pieceA, pieceB } (each { geometryJSON, color, position }) or null.
 */
export function sliceByScreenPolyline(objectId, screenPts, camera, rect) {
  const mesh = objectManager.getMesh(objectId)
  if (!mesh || !camera || !rect || screenPts.length < 2) return null

  const baseGeo = worldGeometry(mesh)
  if (!baseGeo) return null

  mesh.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(mesh)
  if (box.isEmpty()) return null
  const C = box.getCenter(new THREE.Vector3())
  const R = box.getBoundingSphere(new THREE.Sphere()).radius || 1

  // Camera basis: forward (into screen) + right + up.
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd).normalize()
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize()
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize()

  // Cut plane through the shape centre, facing the camera.
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, C)
  const raycaster = new THREE.Raycaster()
  const pts = []   // THREE.Vector2 in (right, up) coords relative to C
  for (const sp of screenPts) {
    const ndc = new THREE.Vector2(
      ((sp.x - rect.left) / rect.width) * 2 - 1,
      -((sp.y - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(ndc, camera)
    const hit = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) continue
    const d = hit.sub(C)
    pts.push(new THREE.Vector2(d.dot(right), d.dot(up)))
  }
  if (pts.length < 2) return null

  // Build a proper HALF-PLANE region: shoot the polyline's end segments out to a
  // large bounding square, then close by walking the square's perimeter back to
  // the start. This makes the region cover ONE FULL SIDE of the shape's cross-
  // section — so the cut goes cleanly all the way across (not a finite wedge).
  const L = R * 8
  const first = pts[0], second = pts[1]
  const last = pts[pts.length - 1], prev = pts[pts.length - 2]
  const b0 = toBoundary(first, first.clone().sub(second).normalize(), L)
  const b1 = toBoundary(last,  last.clone().sub(prev).normalize(),   L)
  if (!b0 || !b1) return null

  const poly = [b0, ...pts, b1, ...perimeterCorners(b1, b0, L)]
  // Ensure CCW winding so the extruded cutter's faces point outward (correct CSG).
  let area = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    area += p.x * q.y - q.x * p.y
  }
  if (area < 0) poly.reverse()

  const shape = new THREE.Shape()
  shape.moveTo(poly[0].x, poly[0].y)
  for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i].x, poly[i].y)
  shape.closePath()

  // Extrude the region along the view axis, deep enough to pass through.
  const depth = R * 4
  const cutterGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  // Use a RIGHT-HANDED basis (N = right × up, parallel to the view axis) so the
  // extruded cutter's normals point outward — a left-handed basis (right,up,fwd)
  // inverts them and makes three-bvh-csg produce inside-out (garbage) results.
  const N = new THREE.Vector3().crossVectors(right, up).normalize()
  const basis = new THREE.Matrix4().makeBasis(right, up, N)
  basis.setPosition(C.clone().addScaledVector(N, -depth / 2))
  cutterGeo.applyMatrix4(basis)
  cutterGeo.computeVertexNormals()

  const color = '#' + (mesh.material?.color?.getHexString?.() ?? '3b82f6')
  const mat = new THREE.MeshStandardMaterial()
  const mkBrush = (g) => { const b = new Brush(g, mat); b.updateMatrixWorld(true); return b }

  try {
    const sideA = evaluator.evaluate(mkBrush(baseGeo.clone()), mkBrush(cutterGeo.clone()), INTERSECTION)
    const sideB = evaluator.evaluate(mkBrush(baseGeo.clone()), mkBrush(cutterGeo.clone()), SUBTRACTION)
    const pieceA = centerResult(sideA, color)
    const pieceB = centerResult(sideB, color)
    if (!pieceA || !pieceB) return null   // line didn't actually divide the shape
    return { pieceA, pieceB }
  } catch (e) {
    console.error('[slice] CSG failed:', e?.message ?? e)
    return null
  }
}
