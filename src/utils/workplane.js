// ─────────────────────────────────────────────────────────────────────────────
// Workplane + Ruler maths (Tinkercad 3D Design tools) — pure, testable.
//
// Workplane: Tinkercad lets you drop the grid onto any face; new shapes are
// then created ON that face, standing along its normal. A workplane is
// { origin:{x,y,z}, normal:{x,y,z} }; null = the default floor (y = 0).
//
// Ruler: placed at a point, it reads the selected object's offset from that
// point (to the near corner of its bounding box) and its size, and lets you type
// exact values that move / resize the object.
// ─────────────────────────────────────────────────────────────────────────────
import { Vector3, Quaternion, Euler, Plane } from 'three'

const UP = new Vector3(0, 1, 0)
const v3 = (o) => new Vector3(o.x, o.y, o.z)
const obj3 = (v) => ({ x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) })

/** A workplane from a picked surface point and its (world) face normal. */
export function workplaneFromHit(point, normal) {
  const n = v3(normal).normalize()
  if (!(n.lengthSq() > 0.5)) return null
  return { origin: obj3(v3(point)), normal: obj3(n) }
}

/** Rotation taking +Y onto the workplane normal. */
export function workplaneQuaternion(wp) {
  return wp ? new Quaternion().setFromUnitVectors(UP, v3(wp.normal).normalize()) : new Quaternion()
}

/** The THREE.Plane of a workplane (the floor when null). */
export function workplanePlane(wp) {
  return wp ? new Plane().setFromNormalAndCoplanarPoint(v3(wp.normal).normalize(), v3(wp.origin)) : new Plane(UP.clone(), 0)
}

/**
 * Where a new object goes on the workplane: `local` is its default floor
 * position (x along the plane, y = height above it, z along the plane), mapped
 * into the plane's frame. Returns { position, rotation (Euler XYZ radians) }.
 */
export function placeOnWorkplane(wp, local) {
  if (!wp) return { position: { ...local }, rotation: { x: 0, y: 0, z: 0 } }
  const q = workplaneQuaternion(wp)
  const p = v3(local).applyQuaternion(q).add(v3(wp.origin))
  const e = new Euler().setFromQuaternion(q, 'XYZ')
  return { position: obj3(p), rotation: { x: +e.x.toFixed(6), y: +e.y.toFixed(6), z: +e.z.toFixed(6) } }
}

// ── Ruler ────────────────────────────────────────────────────────────────────
/** Readings for a bounding box (min/max {x,y,z}) against the ruler origin. */
export function rulerReadings(box, origin) {
  return {
    x: +(box.min.x - origin.x).toFixed(3), y: +(box.min.y - origin.y).toFixed(3), z: +(box.min.z - origin.z).toFixed(3),
    w: +(box.max.x - box.min.x).toFixed(3), h: +(box.max.y - box.min.y).toFixed(3), d: +(box.max.z - box.min.z).toFixed(3),
  }
}

/**
 * Apply a typed ruler value. Offsets (x/y/z) move the object so its box corner
 * lands at origin + value; sizes (w/h/d) scale it on that axis, keeping the
 * corner nearest the ruler fixed. Returns the scene-object patch.
 */
export function applyRulerEdit(field, value, obj, box, origin) {
  const axis = { x: 'x', y: 'y', z: 'z', w: 'x', h: 'y', d: 'z' }[field]
  if (!axis || !Number.isFinite(value)) return null
  if (field === axis) {
    const delta = origin[axis] + value - box.min[axis]
    return { position: { ...obj.position, [axis]: +(obj.position[axis] + delta).toFixed(4) } }
  }
  const cur = box.max[axis] - box.min[axis]
  if (!(value > 0) || !(cur > 0)) return null
  const k = value / cur
  const scale = { ...obj.scale, [axis]: +(obj.scale[axis] * k).toFixed(5) }
  // Scaling about the object's origin moves the box corner; shift it back.
  const cornerAfter = obj.position[axis] + (box.min[axis] - obj.position[axis]) * k
  const position = { ...obj.position, [axis]: +(obj.position[axis] + (box.min[axis] - cornerAfter)).toFixed(4) }
  return { scale, position }
}
