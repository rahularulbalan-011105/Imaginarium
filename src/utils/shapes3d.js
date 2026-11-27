// ─────────────────────────────────────────────────────────────────────────────
// Tinkercad 3D Design shapes that the original primitive set lacked:
// Half Sphere · Paraboloid · Round Roof · Wedge · Tube · Polygon · Icosahedron
// · Star · Heart · Scribble.
//
// Every shape is a CLOSED solid (so Boolean CSG, mass and STL export work),
// centred on the origin, about 2 units across like the existing primitives.
// Parametric shapes read their parameters from the scene object (SHAPE_PARAMS);
// shapeParamKey() tells ObjectManager when a parameter change needs a rebuild.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { createExtrudeSketchGeometry, createRevolveSketchGeometry, isSketchType, DEFAULT_SKETCH } from './sketch3d.js'

/** Editable parameters per shape: key → { label, min, max, step, default }. */
export const SHAPE_PARAMS = {
  half_sphere: { segments: { label: 'Segments', min: 6, max: 64, step: 1, default: 32 } },
  paraboloid:  { segments: { label: 'Segments', min: 6, max: 64, step: 1, default: 32 } },
  round_roof:  { segments: { label: 'Segments', min: 4, max: 64, step: 1, default: 32 } },
  tube:        { wall: { label: 'Wall thickness', min: 0.05, max: 0.95, step: 0.05, default: 0.25 },
                 segments: { label: 'Segments', min: 6, max: 64, step: 1, default: 32 } },
  polygon:     { sides: { label: 'Sides', min: 3, max: 64, step: 1, default: 6 } },
  star_shape:  { points: { label: 'Points', min: 3, max: 30, step: 1, default: 5 },
                 inner: { label: 'Inner radius', min: 0.1, max: 0.95, step: 0.05, default: 0.45 } },
  heart:       {},
  icosahedron: { detail: { label: 'Detail', min: 0, max: 3, step: 1, default: 0 } },
  wedge:       {},
  scribble:    { thickness: { label: 'Thickness', min: 0.1, max: 4, step: 0.1, default: 0.6 } },
  // Sketch shapes (utils/sketch3d.js): the profile itself lives in obj.sketch.
  extrude_sketch: { height: { label: 'Height', min: 0.1, max: 10, step: 0.1, default: 1 } },
  revolve_sketch: { angle: { label: 'Angle (°)', min: 10, max: 360, step: 5, default: 360 },
                    segments: { label: 'Segments', min: 6, max: 96, step: 1, default: 48 } },
}
export const NEW_SHAPE_TYPES = Object.keys(SHAPE_PARAMS)

export function shapeDefaults(type) {
  const d = Object.fromEntries(Object.entries(SHAPE_PARAMS[type] ?? {}).map(([k, p]) => [k, p.default]))
  // A new sketch shape starts from its default profile (kept on the object so it saves).
  if (isSketchType(type)) d.sketch = JSON.parse(JSON.stringify(DEFAULT_SKETCH[type]))
  return d
}
const P = (obj, type, key) => {
  const v = obj?.[key], d = SHAPE_PARAMS[type]?.[key]
  if (!d) return v
  const n = Number(v ?? d.default)
  return Math.min(d.max, Math.max(d.min, Number.isFinite(n) ? n : d.default))
}
export function shapeParamKey(type, obj) {
  const keys = Object.keys(SHAPE_PARAMS[type] ?? {})
  return type + '|' + keys.map(k => P(obj, type, k)).join('|') + (type === 'scribble' ? '|' + JSON.stringify(obj?.scribblePoints ?? null) : '')
    + (isSketchType(type) ? '|' + JSON.stringify(obj?.sketch?.points ?? null) : '')
}

// A closed 2-D profile (x ≥ 0) spun around Y — always a watertight solid.
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg)
// Extrude a 2-D shape along Z by `depth`, centred.
function extrudeCentered(shape, depth) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 })
  g.computeBoundingBox()
  const c = g.boundingBox.getCenter(new THREE.Vector3())
  g.translate(-c.x, -c.y, -c.z)
  return g
}

export function createShape3d(type, obj = {}) {
  switch (type) {
    case 'half_sphere': {
      // Dome of radius 1.2 on a flat base; centred vertically (base y = −0.6).
      const seg = P(obj, type, 'segments'), pts = [[0, 0]]
      for (let i = 0; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); pts.push([1.2 * Math.cos(a), 1.2 * Math.sin(a)]) }
      pts[pts.length - 1][0] = 0
      return lathe(pts, seg).translate(0, -0.6, 0)
    }
    case 'paraboloid': {
      // r(y) = R·√(1 − y/H): flat base of radius 1, apex at height 2.
      const seg = P(obj, type, 'segments'), pts = [[0, 0]]
      for (let i = 0; i <= 20; i++) { const y = (i / 20) * 2; pts.push([Math.sqrt(Math.max(0, 1 - y / 2)), y]) }
      pts[pts.length - 1][0] = 0
      return lathe(pts, seg).translate(0, -1, 0)
    }
    case 'round_roof': {
      // Half cylinder lying along Z, flat face down.
      const seg = P(obj, type, 'segments'), s = new THREE.Shape()
      s.moveTo(-1, 0); s.absarc(0, 0, 1, Math.PI, 0, true); s.lineTo(-1, 0)
      const g = new THREE.ExtrudeGeometry(s, { depth: 2, bevelEnabled: false, curveSegments: seg })
      return g.translate(0, -0.5, -1)
    }
    case 'wedge': {
      // Right-angle wedge: 2 long, 2 high, 2 deep (Tinkercad's default proportions).
      const s = new THREE.Shape([new THREE.Vector2(-1, -1), new THREE.Vector2(1, -1), new THREE.Vector2(-1, 1)])
      return extrudeCentered(s, 2)
    }
    case 'tube': {
      // Hollow cylinder: outer radius 1, wall `wall` (as a fraction of the radius), height 2.
      const ri = 1 - P(obj, type, 'wall'), seg = P(obj, type, 'segments')
      return lathe([[ri, -1], [1, -1], [1, 1], [ri, 1], [ri, -1]], seg)
    }
    case 'polygon':     return new THREE.CylinderGeometry(1, 1, 2, P(obj, type, 'sides'))
    case 'icosahedron': return new THREE.IcosahedronGeometry(1.2, P(obj, type, 'detail'))
    case 'star_shape': {
      const n = P(obj, type, 'points'), ri = P(obj, type, 'inner'), s = new THREE.Shape()
      for (let i = 0; i < n * 2; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? ri * 1.2 : 1.2
        if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a)); else s.lineTo(r * Math.cos(a), r * Math.sin(a))
      }
      s.closePath()
      return extrudeCentered(s, 0.6).rotateX(-Math.PI / 2)
    }
    case 'heart': {
      // The classic two-bezier heart, scaled to ~2 units, lying flat like Tinkercad's.
      const s = new THREE.Shape()
      s.moveTo(0, -0.9)
      s.bezierCurveTo(-0.15, -0.6, -1.05, -0.2, -1.05, 0.35)
      s.bezierCurveTo(-1.05, 0.85, -0.45, 1.05, 0, 0.6)
      s.bezierCurveTo(0.45, 1.05, 1.05, 0.85, 1.05, 0.35)
      s.bezierCurveTo(1.05, -0.2, 0.15, -0.6, 0, -0.9)
      return extrudeCentered(s, 0.6).rotateX(-Math.PI / 2)
    }
    case 'scribble': {
      // A freehand outline (normalised points in −1…1, drawn in the Scribble pad).
      const pts = (obj.scribblePoints?.length >= 3 ? obj.scribblePoints : DEFAULT_SCRIBBLE).map(([x, y]) => new THREE.Vector2(x * 1.2, y * 1.2))
      const s = new THREE.Shape(pts)
      return extrudeCentered(s, P(obj, type, 'thickness')).rotateX(-Math.PI / 2)
    }
    case 'extrude_sketch': return createExtrudeSketchGeometry(obj, P(obj, type, 'height'))
    case 'revolve_sketch': return createRevolveSketchGeometry(obj, P(obj, type, 'angle'), P(obj, type, 'segments'))
    default: return null
  }
}
const DEFAULT_SCRIBBLE = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2, r = 0.8 + 0.18 * Math.sin(a * 3)
  return [r * Math.cos(a), r * Math.sin(a)]
})

/**
 * Turn a freehand stroke (screen points) into a clean closed outline in −1…1:
 * drops near-duplicate points, simplifies (Ramer–Douglas–Peucker), normalises.
 */
export function strokeToOutline(points, tolerance = 0.015) {
  if (!points || points.length < 3) return null
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 1
  let norm = points.map(([x, y]) => [(x - cx) / half, -(y - cy) / half])     // screen y down → shape y up
  const rdp = (pts) => {
    if (pts.length < 3) return pts
    const [a, b] = [pts[0], pts[pts.length - 1]]
    let idx = -1, dMax = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i], [x1, y1] = a, [x2, y2] = b
      const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / (Math.hypot(x2 - x1, y2 - y1) || 1)
      if (d > dMax) { dMax = d; idx = i }
    }
    if (dMax <= tolerance) return [a, b]
    return [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))]
  }
  norm = rdp(norm)
  if (norm.length > 3 && Math.hypot(norm[0][0] - norm.at(-1)[0], norm[0][1] - norm.at(-1)[1]) < 0.05) norm.pop()
  return norm.length >= 3 ? norm.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) : null
}
