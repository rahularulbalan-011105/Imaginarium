// ─────────────────────────────────────────────────────────────────────────────
// Breadboard plugging — pure functions (no Three scene, no stores), so the rule
// is testable headless and plugManager.js only has to apply the result.
//
// A part pin is PLUGGED into a breadboard hole when, in the breadboard's own
// frame, the pin lies within HOLE_R of the hole centre and at the board's top
// surface (legs end at y = 0 of their part, which sits on the board top).
// snapOffset() is the small move that lands a nearly-placed part exactly on the
// 2.54 mm grid, like dropping a part onto a real board.
// ─────────────────────────────────────────────────────────────────────────────
import { Matrix4, Vector3, Euler, Quaternion } from 'three'
import { getPart } from './registry.js'
import { pinsOf } from './definePart.js'
import { PITCH } from './model.js'

export const HOLE_R = 0.08        // cm — how close a leg must be to a hole centre
export const SNAP_R = 0.13        // cm — how close (≈ half a pitch) to be snapped onto the grid
const Y_BELOW = 0.2, Y_ABOVE = 0.35

export function objectMatrix(o) {
  const p = o.position ?? { x: 0, y: 0, z: 0 }, r = o.rotation ?? { x: 0, y: 0, z: 0 }, s = o.scale ?? { x: 1, y: 1, z: 1 }
  return new Matrix4().compose(new Vector3(p.x, p.y, p.z), new Quaternion().setFromEuler(new Euler(r.x, r.y, r.z)), new Vector3(s.x, s.y, s.z))
}

const key = (x, z) => `${Math.round((x * 2) / PITCH)},${Math.round((z * 2) / PITCH)}`
function boardIndex(board) {
  const part = getPart(board.type)
  const map = new Map()
  for (const h of pinsOf(part, board)) map.set(key(h.x, h.z), h)
  return { board, top: part.breadboard.top, map, inv: objectMatrix(board).invert() }
}

/** World positions of a part's pins. */
export function pinWorld(o) {
  const part = getPart(o.type)
  if (!part) return []
  const M = objectMatrix(o)
  return pinsOf(part, o).map(p => ({ name: p.name, y0: p.y, w: new Vector3(p.x, p.y, p.z).applyMatrix4(M) }))
}

function nearestHole(idx, w, radius) {
  const l = w.clone().applyMatrix4(idx.inv)
  if (l.y < idx.top - Y_BELOW || l.y > idx.top + Y_ABOVE) return null
  let best = null, bestD = radius
  const cx = Math.round((l.x * 2) / PITCH), cz = Math.round((l.z * 2) / PITCH)
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const h = idx.map.get(`${cx + dx},${cz + dz}`)
    if (!h) continue
    const d = Math.hypot(h.x - l.x, h.z - l.z)
    if (d < bestD) { bestD = d; best = h }
  }
  return best ? { hole: best, local: l, d: bestD } : null
}

/**
 * Every plug between a part pin and a breadboard hole.
 * @returns {{ fromPinId: string, toPinId: string }[]}  part pin → hole
 */
export function computePlugs(objects) {
  const boards = objects.filter(o => getPart(o.type)?.breadboard).map(boardIndex)
  if (!boards.length) return []
  const out = []
  for (const o of objects) {
    const part = getPart(o.type)
    if (!part || part.breadboard) continue
    for (const { name, w } of pinWorld(o)) {
      for (const idx of boards) {
        const hit = nearestHole(idx, w, HOLE_R)
        if (hit) { out.push({ fromPinId: `${o.id}:${name}`, toPinId: `${idx.board.id}:${hit.hole.name}` }); break }
      }
    }
  }
  return out
}

/**
 * World-space move that lands `o` exactly on a breadboard's grid, or null when
 * it is not close to one. Every leg near a hole must agree on the same offset
 * (so a rotated or mis-sized part never jumps).
 */
export function snapOffset(o, objects) {
  const part = getPart(o.type)
  if (!part || part.breadboard) return null
  const boards = objects.filter(b => b.id !== o.id && getPart(b.type)?.breadboard).map(boardIndex)
  for (const idx of boards) {
    const offs = []
    for (const { w, y0 } of pinWorld(o)) {
      const hit = nearestHole(idx, w, SNAP_R)
      // The leg's END (part y = 0) lands on the board top; the pin marker sits y0 above it.
      if (hit) offs.push(new Vector3(hit.hole.x - hit.local.x, idx.top + y0 * (o.scale?.y ?? 1) - hit.local.y, hit.hole.z - hit.local.z))
    }
    if (!offs.length) continue
    const avg = offs.reduce((a, v) => a.add(v), new Vector3()).multiplyScalar(1 / offs.length)
    if (offs.some(v => v.distanceTo(avg) > 0.03)) return null           // legs disagree: not a clean fit
    // Board-local offset → world offset (rotation + scale of the board only).
    const M = objectMatrix(idx.board)
    const origin = new Vector3().applyMatrix4(M)
    const wOff = avg.clone().applyMatrix4(M).sub(origin)
    return wOff.length() < 1e-4 ? null : wOff
  }
  return null
}
