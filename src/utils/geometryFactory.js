import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import helvetiker from 'three/examples/fonts/helvetiker_regular.typeface.json'
import { rollerAxisLocal } from './mecanum.js'
import { createShape3d, NEW_SHAPE_TYPES } from './shapes3d.js'

// Lazily parse the bundled font once — TextGeometry needs a parsed Font instance.
let _font = null
function getFont() {
  if (!_font) _font = new FontLoader().parse(helvetiker)
  return _font
}

/**
 * Build a centred 3D text solid. Stamps userData so updateMesh can detect when
 * the string / size changed and rebuild only then.
 */
export function createTextGeometry(text, size = 1, height = 0.4) {
  const str = String(text ?? '') || 'Text'
  const s   = Math.max(0.05, size || 1)
  const h   = Math.max(0.01, height || 0.4)
  const geo = new TextGeometry(str, { font: getFont(), size: s, height: h, curveSegments: 6, bevelEnabled: false })
  geo.computeBoundingBox()
  geo.center()
  geo.computeVertexNormals()
  geo.userData._txt = str
  geo.userData._tsz = s
  geo.userData._th  = h
  return geo
}

// Base dimensions of each fillable box type (matches createGeometry below)
const BOX_DIMS = {
  box:      [2, 2, 2],
  rectprism:[3, 1.5, 2],
}

/**
 * Create a RoundedBoxGeometry matching the base dimensions of a box/rectprism.
 * radius  — edge rounding radius in geometry-local units (same space as the default geometry).
 * segments — arc quality: 1 = chamfer (flat cut), 3+ = smooth fillet.
 */
export function createFilletedBoxGeometry(type, radius, segments = 3) {
  const [w, h, d] = BOX_DIMS[type] ?? [2, 2, 2]
  const maxR = Math.min(w, h, d) / 2 - 0.001
  const r    = Math.max(0.001, Math.min(radius, maxR))
  const segs = Math.max(1, Math.round(segments))
  return new RoundedBoxGeometry(w, h, d, segs, r)
}

/**
 * Build a centred rounded-rectangle Shape of size w×h.
 * `mask` = [bottomLeft, bottomRight, topRight, topLeft] — true rounds that corner.
 */
function roundedRectShape(w, h, r, mask) {
  const hw = w / 2, hh = h / 2
  const rbl = mask[0] ? r : 0
  const rbr = mask[1] ? r : 0
  const rtr = mask[2] ? r : 0
  const rtl = mask[3] ? r : 0
  const s = new THREE.Shape()
  s.moveTo(-hw + rbl, -hh)
  s.lineTo(hw - rbr, -hh)
  if (rbr > 0) s.absarc(hw - rbr, -hh + rbr, rbr, -Math.PI / 2, 0, false)
  s.lineTo(hw, hh - rtr)
  if (rtr > 0) s.absarc(hw - rtr, hh - rtr, rtr, 0, Math.PI / 2, false)
  s.lineTo(-hw + rtl, hh)
  if (rtl > 0) s.absarc(-hw + rtl, hh - rtl, rtl, Math.PI / 2, Math.PI, false)
  s.lineTo(-hw, -hh + rbl)
  if (rbl > 0) s.absarc(-hw + rbl, -hh + rbl, rbl, Math.PI, 1.5 * Math.PI, false)
  s.closePath()
  return s
}

/**
 * Create a box that rounds ONLY selected edges (not all 12).
 * The four edges that run parallel to `axis` are exposed as the four corners of
 * the extruded cross-section; `corners` (4 booleans) picks which to round.
 *  - axis 'z': cross-section is the X/Y face, depth runs along Z
 *  - axis 'x': cross-section is the Z/Y face, depth runs along X
 *  - axis 'y': cross-section is the X/Z face, depth runs along Y
 * radius   — rounding radius in geometry-local units
 * segments — 1 = chamfer (flat cut), >1 = smooth fillet arc
 */
export function createPartialFilletedBoxGeometry(type, radius, segments, axis, corners) {
  const [bw, bh, bd] = BOX_DIMS[type] ?? [2, 2, 2]
  const mask = Array.isArray(corners) && corners.length === 4 ? corners : [true, true, true, true]

  // Cross-section width/height (u,v) and depth (length along the extrude axis)
  let u, v, depth
  if      (axis === 'x') { u = bd; v = bh; depth = bw }
  else if (axis === 'y') { u = bw; v = bd; depth = bh }
  else                   { u = bw; v = bh; depth = bd }   // 'z' (default)

  const maxR = Math.min(u, v) / 2 - 0.001
  const r    = Math.max(0.001, Math.min(radius, maxR))
  const curveSegments = segments <= 1 ? 1 : Math.max(3, Math.round(segments) * 2)

  const shape = roundedRectShape(u, v, r, mask)
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments, steps: 1 })
  geo.translate(0, 0, -depth / 2)

  // Orient so the extrude axis (local +Z) aligns with the requested world axis
  if      (axis === 'x') geo.rotateY(Math.PI / 2)
  else if (axis === 'y') geo.rotateX(-Math.PI / 2)

  geo.computeVertexNormals()
  return geo
}

// Every primitive createGeometry() knows (used to tell shapes from catalogue parts).
export const SHAPE_TYPES = new Set(['cylinder', 'cone', 'box', 'sphere', 'tetrahedron', 'pyramid', 'pentpyramid', 'octahedron', 'dodecahedron', 'rectprism', 'torus', 'plane', 'capsule', 'prism', 'diamond', 'hexagon', 'star', 'gear', 'wheel', 'caster', ...NEW_SHAPE_TYPES])

export function createGeometry(type, obj) {
  // Tinkercad shapes added later (utils/shapes3d.js) — parametric from `obj`.
  const extra = createShape3d(type, obj)
  if (extra) return extra
  switch (type) {
    // ── current shape set ──────────────────────────────────────────────────
    case 'cylinder':     return new THREE.CylinderGeometry(1, 1, 2, 32)
    case 'cone':         return new THREE.ConeGeometry(1, 2, 32)
    case 'box':          return new THREE.BoxGeometry(2, 2, 2)
    case 'sphere':       return new THREE.SphereGeometry(1, 32, 32)
    case 'tetrahedron':  return new THREE.TetrahedronGeometry(1.3, 0)
    case 'pyramid':      return new THREE.ConeGeometry(1.2, 2, 4)       // square pyramid
    case 'pentpyramid':  return new THREE.ConeGeometry(1.2, 2, 5)       // pentagonal pyramid
    case 'octahedron':   return new THREE.OctahedronGeometry(1.3, 0)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(1.2, 0)
    case 'rectprism':    return new THREE.BoxGeometry(3, 1.5, 2)        // rectangular prism
    // ── legacy types (kept so saved projects still load) ──────────────────
    case 'torus':        return new THREE.TorusGeometry(1, 0.4, 16, 100)
    case 'plane':        return new THREE.PlaneGeometry(3, 3)
    case 'capsule':      return new THREE.CapsuleGeometry(0.6, 1.2, 4, 16)
    case 'prism':        return new THREE.CylinderGeometry(1, 1, 2, 3)
    case 'diamond':      return new THREE.OctahedronGeometry(1.2, 0)
    case 'hexagon':      return new THREE.CylinderGeometry(1, 1, 2, 6)
    case 'star':         return new THREE.TorusKnotGeometry(0.7, 0.25, 64, 8, 2, 3)
    case 'gear':         return createSpurGearGeometry()
    case 'wheel':        return createWheelGeometry()
    case 'caster':       return createCasterGeometry()
    default:             return new THREE.BoxGeometry(2, 2, 2)
  }
}

// ── Lathe helpers (wheel / caster) ──────────────────────────────────────────
// Both parts are a closed 2-D profile (x = radius, y = height) spun around the
// axis, so the mesh is watertight (correct volume → mass, valid for Booleans).
// The profile runs from the axis at the bottom, out, up and back to the axis at
// the top — that direction makes LatheGeometry's normals point outward.
//
// LatheGeometry smooths the normal at every profile point, which smears a sharp
// edge. A corner is therefore emitted twice, a hair apart: each copy takes its
// normal from its own side, so the edge renders crisp.
const CREASE = 1e-4
function creased(points, cornerIdx) {
  const out = []
  points.forEach((p, i) => {
    if (!cornerIdx.has(i) || i === 0 || i === points.length - 1) { out.push(p); return }
    const prev = points[i - 1], next = points[i + 1]
    const toward = (q) => { const d = new THREE.Vector2().subVectors(q, p); const l = d.length(); return l > 0 ? d.multiplyScalar(Math.min(CREASE, l * 0.25) / l) : d }
    out.push(p.clone().add(toward(prev)), p.clone().add(toward(next)))
  })
  return out
}
const arc = (cx, cy, r, a0, a1, n) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)) })

// A closed ring profile (not touching the axis) from inner radius a to outer b,
// axial span y0..y1, as a lathe loop. The loop starts/ends mid-way down the
// inner wall so its seam lies on a flat face (no smeared corner there).
function ringLathe(a, b, y0, y1, segments) {
  const V = (x, y) => new THREE.Vector2(x, y), ym = (y0 + y1) / 2
  const pts = [V(a, ym), V(a, y0), V(b, y0), V(b, y1), V(a, y1), V(a, ym)]
  return new THREE.LatheGeometry(creased(pts, new Set([1, 2, 3, 4])), segments)
}

/**
 * Robot wheel in the style of the common yellow 5-spoke BO-motor wheel:
 *   tyre — rubber ring with rounded shoulders + two staggered rows of tread blocks
 *   rim  — outer rim ring, hub with an axle bore, five spokes set toward the
 *          outer face (the "dished" look)
 * Returned as two geometries so the tyre and rim can have different colours.
 * The AXLE is local X, so a new wheel stands upright and rolls along Z with
 * rotation 0. Outer diameter (incl. tread) and width are exactly as requested.
 * All parts are non-indexed so they can be merged (see createWheelGeometry).
 */
export function createWheelParts({ diameter = 3.4, width = 1.3, segments = 64 } = {}) {
  const R  = Math.max(0.3, diameter / 2)
  const h  = Math.max(0.15, width) / 2
  const Rr = R * 0.72                          // tyre inner radius = rim outer radius
  const dt = Math.min(R * 0.06, h * 0.25)      // tread block height
  const R0 = R - dt * 0.7                      // tyre carcass radius (blocks sit on it)
  const f  = Math.min(h * 0.45, (R0 - Rr) * 0.6) // shoulder rounding

  // ── tyre carcass: closed loop, rounded outer shoulders ─────────────────────
  const V = (x, y) => new THREE.Vector2(x, y)
  const ym = 0
  const tp = [], tc = new Set()
  const add = (p, corner = false) => { if (corner) tc.add(tp.length); tp.push(p) }
  add(V(Rr, ym))
  add(V(Rr, -h), true)
  add(V(R0 - f, -h))
  arc(R0 - f, -h + f, f, -Math.PI / 2, 0, 5).slice(1).forEach((p) => add(p))
  arc(R0 - f,  h - f, f, 0, Math.PI / 2, 5).forEach((p) => add(p))
  add(V(Rr, h), true)
  add(V(Rr, ym))
  const tyreParts = [new THREE.LatheGeometry(creased(tp, tc), segments)]
  // Clean selection-outline shape: the smooth carcass alone (no tread blocks).
  const tyreOutline = new THREE.LatheGeometry(creased(tp, tc), segments).rotateZ(Math.PI / 2)

  // ── tread: two staggered rows of flat blocks on the tread band ─────────────
  const groove = h * 0.12                       // centre groove between the rows
  const band   = h - f * 0.4                    // usable half-width of the tread
  const a      = Math.max(0.05, band - groove / 2)  // axial length of one block
  const n      = Math.max(14, Math.min(64, Math.round((2 * Math.PI * R) / (R * 0.28 + 0.15))))
  const pitch  = (2 * Math.PI) / n
  const L      = 2 * R0 * Math.sin(pitch / 2) * 0.62   // tangential block length
  // Outer face placed so the block CORNERS land exactly on radius R.
  const rOut   = Math.sqrt(R * R - (L / 2) ** 2)
  const depth  = rOut - (R0 - dt * 0.3)          // reaches slightly into the carcass
  for (let row = 0; row < 2; row++) {
    const yc = (row === 0 ? -1 : 1) * (groove / 2 + a / 2)
    for (let i = 0; i < n; i++) {
      const phi = (i + (row ? 0.5 : 0)) * pitch
      const box = new THREE.BoxGeometry(L, a, depth)
      box.rotateY(phi)
      const rc = rOut - depth / 2
      box.translate(rc * Math.sin(phi), yc, rc * Math.cos(phi))
      tyreParts.push(box)
    }
  }

  // ── rim: outer ring + hub with bore + five spokes ──────────────────────────
  const rimT = R * 0.07
  const RrIn = Rr - rimT
  const hr   = h * 0.96
  const Rh   = R * 0.17
  const bore = R * 0.06
  const rimParts = [
    ringLathe(RrIn, Rr, -hr, hr, segments),
    ringLathe(bore, Rh, -hr, h, Math.max(24, segments / 2)),
  ]
  const ts = h * 0.5                            // spoke thickness (axial)
  const yS = h - ts / 2 - h * 0.12              // spokes sit toward the outer (+) face
  const shape = new THREE.Shape()
  const u0 = Rh * 0.7, u1 = RrIn + rimT * 0.4   // overlap hub and rim
  const w0 = R * 0.07, w1 = R * 0.13            // spokes widen toward the rim
  shape.moveTo(u0, -w0); shape.lineTo(u1, -w1); shape.lineTo(u1, w1); shape.lineTo(u0, w0); shape.closePath()
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.ExtrudeGeometry(shape, { depth: ts, bevelEnabled: false })
    sp.translate(0, 0, -ts / 2)
    sp.rotateX(-Math.PI / 2)                    // extrude axis Z → wheel axis Y
    sp.rotateY((k / 5) * Math.PI * 2)
    sp.translate(0, yS, 0)
    rimParts.push(sp)
  }

  // Lathe/box are indexed, extrude is not — mergeGeometries needs them all alike.
  const finish = (parts) => {
    const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p))
    const g = mergeGeometries(flat, false)
    new Set([...parts, ...flat]).forEach((p) => p.dispose())
    g.rotateZ(Math.PI / 2)                      // wheel axis Y → axle along X
    g.computeBoundingBox()
    return g
  }
  return { tyre: finish(tyreParts), rim: finish(rimParts), tyreOutline }
}

/**
 * Mecanum wheel, styled on the common yellow 60–80 mm kit wheel:
 *   rollers — fat black barrels with rounded ends, set at 45° to the axle
 *             (utils/mecanum.js — the same roller axes the drive physics reads)
 *   rim     — two yellow side plates with a "flower" edge: one rounded lobe
 *             cups each roller end, so the lobes on the two plates are offset
 *             by the roller's slant
 *   hub     — the grey bushing through the middle, standing proud of one face
 * Axle = local X like the plain wheel; the rollers reach the requested diameter.
 * `hand` A / B mirrors the rollers (and the lobes with them).
 */
export function createMecanumParts({ diameter = 3.4, width = 1.3, hand = 'A', rollers = 9 } = {}) {
  const R  = Math.max(0.3, diameter / 2)
  const hw = Math.max(0.15, width) / 2
  const rr = R * 0.2                            // roller radius at its middle
  const rc = R - rr                             // roller centre radius
  const L  = (2 * hw * 0.98) / Math.SQRT1_2 - 2 * rr * 0.8   // roller length: spans the width at 45° (its thickness too)
  const pt = Math.max(0.05, hw * 0.2)           // side-plate thickness

  // ── rollers: barrel profile along Y with rounded (hemispherical-ish) ends ──
  const prof = [], n = 14, cap = rr * 0.55
  prof.push(new THREE.Vector2(0, -L / 2))
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = -L / 2 + L * t
    const end = Math.min(y + L / 2, L / 2 - y)                      // distance to the nearer end
    const round = end < cap ? Math.sqrt(Math.max(0, 1 - ((cap - end) / cap) ** 2)) : 1
    const barrel = 0.86 + 0.14 * Math.cos((Math.PI * y) / L)      // slightly fatter in the middle
    prof.push(new THREE.Vector2(rr * barrel * (0.35 + 0.65 * round), y))
  }
  prof.push(new THREE.Vector2(0, L / 2))
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), ax = new THREE.Vector3()
  const rollerGeos = [], endAngles = { '1': [], '-1': [] }
  for (let k = 0; k < rollers; k++) {
    const phi = (k / rollers) * Math.PI * 2
    ax.set(...rollerAxisLocal(phi, hand))
    const g = new THREE.LatheGeometry(prof, 16)
    g.applyQuaternion(q.setFromUnitVectors(up, ax))
    g.translate(0, rc * Math.cos(phi), rc * Math.sin(phi))
    rollerGeos.push(g.toNonIndexed()); g.dispose()
    // where this roller's two ends meet the plates (angle around the axle)
    for (const sgn of [1, -1]) {
      const k2 = (sgn * Math.sign(ax.x) * L) / 2
      const ey = rc * Math.cos(phi) + ax.y * k2, ez = rc * Math.sin(phi) + ax.z * k2
      endAngles[String(sgn)].push({ a: Math.atan2(ez, ey), phi })
    }
  }

  // ── side plates: a ring, and one swept petal per roller end ──────────────
  // Each petal runs from the ring out to a rounded tip that cups the roller's
  // end, leaning toward the roller's middle — so the petals swirl the same way
  // as the rollers (mirrored on an A vs a B wheel), like the kit wheel.
  const Rb = rc - rr * 1.25                     // ring radius
  const tipR = rr * 0.78                        // petal tip radius
  const baseR = rr * 0.95                       // petal root half-width
  const polar = (r, th) => [-r * Math.sin(th), r * Math.cos(th)]   // shape (u, v) → wheel (z = −u, y = v)
  // `k` < 1 makes the petals a hair thinner than the ring, so where they
  // overlap the ring's faces win cleanly (no coplanar flicker)
  const extrude = (sh, x, k = 1) => {
    const d = pt * k
    const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: d * 0.3, bevelSize: pt * 0.25, bevelSegments: 2, curveSegments: 10 })
    g.translate(0, 0, -d / 2)
    g.rotateY(Math.PI / 2)                                          // extrude axis Z → axle X
    g.translate(x, 0, 0)
    return g
  }
  const petal = ({ a, phi }) => {
    const lean = Math.atan2(Math.sin(phi - a), Math.cos(phi - a))   // toward the roller's middle
    const [tx, ty] = polar(rc + rr * 0.12, a)                       // tip centre, at the roller end
    const [bx, by] = polar(Rb, a + lean * 1.6)                      // root centre, on the ring
    const dir = Math.atan2(ty - by, tx - bx), sh = new THREE.Shape(), N = 12
    for (let i = 0; i <= N; i++) {                                  // round tip
      const t = dir - Math.PI / 2 + (Math.PI * i) / N
      const px = tx + tipR * Math.cos(t), py = ty + tipR * Math.sin(t)
      i ? sh.lineTo(px, py) : sh.moveTo(px, py)
    }
    for (let i = 0; i <= N; i++) {                                  // wider root
      const t = dir + Math.PI / 2 + (Math.PI * i) / N
      sh.lineTo(bx + baseR * Math.cos(t), by + baseR * Math.sin(t))
    }
    return sh
  }
  const plate = (ends, x) => {
    const ring = new THREE.Shape(); ring.absarc(0, 0, Rb + rr * 0.15, 0, Math.PI * 2, false)
    const hole = new THREE.Path(); hole.absarc(0, 0, R * 0.4, 0, Math.PI * 2, true)   // the hub disc shows through
    ring.holes.push(hole)
    return [extrude(ring, x), ...ends.map((e) => extrude(petal(e), x, 0.92))]
  }
  const rimGeos = [...plate(endAngles['1'], hw - pt * 0.8), ...plate(endAngles['-1'], -hw + pt * 0.8)]
  // a drum joining the plates under the rollers, and the recessed hub disc with its two screws
  rimGeos.push(new THREE.CylinderGeometry(Rb * 0.92, Rb * 0.92, 2 * hw * 0.8, 36, 1, true).rotateZ(Math.PI / 2))
  rimGeos.push(new THREE.CylinderGeometry(R * 0.42, R * 0.42, 2 * hw * 0.55, 36).rotateZ(Math.PI / 2))
  for (const a of [0.6, 0.6 + Math.PI])
    rimGeos.push(new THREE.CylinderGeometry(R * 0.035, R * 0.035, 2 * hw * 0.6, 10).rotateZ(Math.PI / 2).translate(0, R * 0.3 * Math.cos(a), R * 0.3 * Math.sin(a)))

  // ── hub: grey bushing, proud of the outer (+x) face ───────────────────────
  const bushR = R * 0.17, bushL = 2 * hw * 1.25
  const hubGeos = [
    new THREE.CylinderGeometry(bushR, bushR, bushL, 28).rotateZ(Math.PI / 2).translate(bushL / 2 - hw * 0.9, 0, 0),
    new THREE.CylinderGeometry(bushR * 1.45, bushR * 1.45, pt * 1.2, 28).rotateZ(Math.PI / 2).translate(hw * 0.95, 0, 0),
  ]

  const merge = (parts) => {
    const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p))
    const keep = flat.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g })
    const g = mergeGeometries(keep, false)
    new Set([...parts, ...flat]).forEach((p) => p.dispose())
    g.computeBoundingBox()
    return g
  }
  const outline = new THREE.CylinderGeometry(R, R, 2 * hw * 0.9, 48, 1, true).rotateZ(Math.PI / 2)
  return { tyre: merge(rollerGeos), rim: merge(rimGeos), hub: merge(hubGeos), tyreOutline: outline }
}

/** The whole wheel as ONE geometry (mass estimate, export, tests). */
export function createWheelGeometry(opts) {
  const { tyre, rim, tyreOutline } = createWheelParts(opts)
  const g = mergeGeometries([tyre, rim], false)
  tyre.dispose(); rim.dispose(); tyreOutline.dispose()
  return g
}

/**
 * Ball-transfer caster (the stamped zinc kind): a round flat flange with three
 * screw holes on top, a deep cylindrical housing whose rounded bottom shoulder
 * curls in to a lip that grips the ball, and a steel ball poking out underneath.
 * Returned as two geometries (body, ball) so the ball can stay polished steel
 * whatever colour the body is. Height = flange top → ball bottom (what sets the
 * chassis level). Axis is local Y. The ball shrinks to fit the height.
 */
export function createCasterParts({ height = 1.6, ball = 1.0, segments = 48 } = {}) {
  const H  = Math.max(0.3, height)
  const fT = Math.min(H * 0.08, 0.15)          // flange thickness (stamped sheet)
  // The whole ball must fit under the flange (2·rb ≤ H − fT), which also keeps
  // the housing a positive height.
  const rb = Math.max(0.05, Math.min(ball / 2, ((H - fT) / 2) * 0.95))
  const yb   = -H / 2 + rb                     // ball centre (ball bottom = −H/2)
  const yLip = yb - 0.1 * rb                   // lip just below the ball's equator (~45 % shows)
  const yTab = H / 2 - fT                      // underside of the flange
  const Rh   = rb * 1.22                       // housing radius
  const xLip = rb * 1.0                        // lip hugs the ball
  const rs   = Math.min(Rh - xLip, (yTab - yLip) * 0.45)   // rounded bottom shoulder
  const V = (x, y) => new THREE.Vector2(x, y)

  // housing: flat lip ring → rounded shoulder → straight wall; top hides in the flange
  const pts = [V(0, yLip), V(Rh - rs, yLip)]
  arc(Rh - rs, yLip + rs, rs, -Math.PI / 2, 0, 8).slice(1).forEach((p) => pts.push(p))
  pts.push(V(Rh, yTab + fT * 0.5), V(0, yTab + fT * 0.5))
  const housing = new THREE.LatheGeometry(creased(pts, new Set([pts.length - 2])), segments)

  // flange: round plate, three screw holes 120° apart
  const Rf = Rh * 1.95, rHoleAt = Rh * 1.5, rHole = Rh * 0.24
  const shape = new THREE.Shape()
  shape.absarc(0, 0, Rf, 0, Math.PI * 2, false)
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / 3
    const hole = new THREE.Path()
    hole.absarc(rHoleAt * Math.cos(a), rHoleAt * Math.sin(a), rHole, 0, Math.PI * 2, true)
    shape.holes.push(hole)
  }
  const tab = new THREE.ExtrudeGeometry(shape, { depth: fT, bevelEnabled: false, curveSegments: 24 })
  tab.rotateX(-Math.PI / 2)                    // extrude axis Z → up (Y)
  tab.translate(0, yTab, 0)

  const flat = [housing.toNonIndexed(), tab]
  const body = mergeGeometries(flat, false)
  housing.dispose(); flat.forEach((g) => g.dispose())
  const ballGeo = new THREE.SphereGeometry(rb, 32, 20).translate(0, yb, 0)
  return { body, ball: ballGeo }
}

/** The whole caster as ONE geometry (mass estimate, tests). */
export function createCasterGeometry(opts) {
  const { body, ball } = createCasterParts(opts)
  const g = mergeGeometries([body, ball.toNonIndexed()], false)
  body.dispose(); ball.dispose()
  return g
}

/**
 * Apply a cylindrical bend deformation to a BufferGeometry in-place.
 * The geometry is bent along `bAxis` and curves toward the first perpendicular axis.
 * Original positions are saved in geometry.userData.origPos on the first call.
 */
export function applyBendDeform(geometry, angleDeg, bAxis = 'y') {
  const pos = geometry.attributes.position
  if (!pos) return

  if (geometry.userData.currentBend     === angleDeg &&
      geometry.userData.currentBendAxis === bAxis) return
  geometry.userData.currentBend     = angleDeg
  geometry.userData.currentBendAxis = bAxis

  if (!geometry.userData.origPos) {
    geometry.userData.origPos = new Float32Array(pos.array.buffer.slice())
  }
  const orig = geometry.userData.origPos

  if (angleDeg === 0) {
    pos.array.set(orig)
    pos.needsUpdate = true
    geometry.computeVertexNormals()
    return
  }

  const idxH = bAxis === 'x' ? 0 : bAxis === 'y' ? 1 : 2
  let minH = Infinity, maxH = -Infinity
  for (let i = idxH; i < orig.length; i += 3) {
    if (orig[i] < minH) minH = orig[i]
    if (orig[i] > maxH) maxH = orig[i]
  }
  const H = maxH - minH
  if (H < 1e-4) return

  const θ = angleDeg * Math.PI / 180
  const R = H / θ   // radius of neutral axis (negative angle = reverse curve)

  for (let i = 0; i < pos.array.length; i += 3) {
    const ox = orig[i], oy = orig[i + 1], oz = orig[i + 2]
    // Map to (h, a, b): h = height along bend axis, a = displacement axis, b = unchanged
    let h, a, b
    if      (bAxis === 'y') { h = oy; a = oz; b = ox }
    else if (bAxis === 'z') { h = oz; a = ox; b = oy }
    else                    { h = ox; a = oy; b = oz }

    const alpha = ((h - minH) / H) * θ
    const Reff  = R - a

    const h_new = minH + Reff * Math.sin(alpha)
    const a_new = R   - Reff * Math.cos(alpha)
    const b_new = b

    if      (bAxis === 'y') { pos.array[i] = b_new; pos.array[i + 1] = h_new; pos.array[i + 2] = a_new }
    else if (bAxis === 'z') { pos.array[i] = a_new; pos.array[i + 1] = b_new; pos.array[i + 2] = h_new }
    else                    { pos.array[i] = h_new; pos.array[i + 1] = a_new; pos.array[i + 2] = b_new }
  }

  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

// ── Spur Gear ─────────────────────────────────────────────────────────────────
export function createSpurGearGeometry({ teeth = 12, module: mod = 0.25, faceWidth = 0.5, bore = 0 } = {}) {
  const pitchR = (teeth * mod) / 2
  const outerR = pitchR + mod
  const rootR  = Math.max(mod * 0.25, pitchR - 1.25 * mod)

  const toothAng = (2 * Math.PI) / teeth
  const halfGap  = toothAng * 0.28

  const pts = []
  for (let i = 0; i < teeth; i++) {
    const base = i * toothAng
    pts.push(new THREE.Vector2(rootR * Math.cos(base + halfGap),                          rootR * Math.sin(base + halfGap)))
    pts.push(new THREE.Vector2(outerR * Math.cos(base + halfGap + 0.025),                 outerR * Math.sin(base + halfGap + 0.025)))
    pts.push(new THREE.Vector2(outerR * Math.cos(base + toothAng * 0.5),                  outerR * Math.sin(base + toothAng * 0.5)))
    pts.push(new THREE.Vector2(outerR * Math.cos(base + toothAng - halfGap - 0.025),      outerR * Math.sin(base + toothAng - halfGap - 0.025)))
    pts.push(new THREE.Vector2(rootR * Math.cos(base + toothAng - halfGap),               rootR * Math.sin(base + toothAng - halfGap)))
  }

  const shape = new THREE.Shape(pts)

  // bore=0 → solid gear; bore>0 → shaft hole with radius = bore * rootR (clamped 0.05–0.9)
  if (bore > 0) {
    const boreR  = Math.min(rootR * 0.9, Math.max(0.05, bore * rootR))
    const holePts = []
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2
      holePts.push(new THREE.Vector2(boreR * Math.cos(a), boreR * Math.sin(a)))
    }
    shape.holes.push(new THREE.Path(holePts))
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: faceWidth, bevelEnabled: false })
  geo.translate(0, 0, -faceWidth / 2)
  geo.rotateX(-Math.PI / 2)
  geo.computeVertexNormals()
  return geo
}

// ── Bolt (hex head + cylindrical shaft) ───────────────────────────────────────
export function createBoltGroup(color = '#aaaaaa') {
  const group  = new THREE.Group()
  const mkMat  = () => new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.25 })
  const headH  = 0.28, headR = 0.30
  const shaftH = 0.85, shaftR = 0.15

  const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 6), mkMat())
  head.position.y = shaftH * 0.5 + headH * 0.5
  head.castShadow = true
  group.add(head)

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR * 0.9, shaftH, 14), mkMat())
  shaft.castShadow = true
  group.add(shaft)

  return group
}

// ── Screw (disc head + threaded shaft) ────────────────────────────────────────
export function createScrewGroup(color = '#aaaaaa') {
  const group  = new THREE.Group()
  const mkMat  = () => new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.25 })
  const headH  = 0.18, headR = 0.32
  const shaftH = 0.85, shaftR = 0.12, tipH = 0.12

  const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 32), mkMat())
  head.position.y = shaftH * 0.5 + headH * 0.5
  head.castShadow = true
  group.add(head)

  const threadCount = 9
  const steps = threadCount * 6
  const thrPts = [new THREE.Vector2(0, -shaftH / 2 - tipH)]
  thrPts.push(new THREE.Vector2(shaftR, -shaftH / 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = t * shaftH - shaftH / 2
    const bump = 0.022 * Math.abs(Math.sin(t * threadCount * Math.PI))
    thrPts.push(new THREE.Vector2(shaftR + bump, y))
  }

  const shaft = new THREE.Mesh(new THREE.LatheGeometry(thrPts, 20), mkMat())
  shaft.castShadow = true
  group.add(shaft)

  return group
}

export function createMaterial(color = '#3b82f6', materialType = 'standard') {
  switch (materialType) {
    case 'metallic':
      return new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.2 })
    case 'transparent':
      return new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.45, roughness: 0.3 })
    // Polished steel for small parts (caster ball). Deliberately NOT fully
    // metallic: the scene has no environment map, and a metalness≈1 surface
    // with nothing to reflect renders almost black.
    case 'steel':
      return new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.18 })
    default:
      return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.65 })
  }
}
