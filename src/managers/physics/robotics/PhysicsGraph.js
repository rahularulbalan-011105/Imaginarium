// Physics graph: the pure-data description of a robot's physical structure that
// sits between the Robot Blueprint / component graph and the Rapier runtime.
//
//   Blueprint → component graph → PHYSICS GRAPH → ArticulatedRobot (Rapier)
//
// Everything is in world units (su) at the authored ("rest") pose. Link frames
// are world-aligned at rest, which makes joint axes and anchors identical in
// both bodies' local frames.
//
// @typedef {{x:number,y:number,z:number}} V3
// @typedef {{x:number,y:number,z:number,w:number}} Q4
// @typedef {{
//   shape: 'box'|'sphere'|'cylinder'|'capsule'|'convex'|'mesh',
//   halfExtents?: V3, radius?: number, halfHeight?: number,
//   points?: number[], indices?: number[],
//   offset: { p: V3, q?: Q4 },            // link-local
//   mass: number,                         // kg (0 → from material density)
//   material?: string|object,
//   objectId?: string,
// }} ColliderSpec
// @typedef {{ id:string, name?:string, origin:V3, colliders:ColliderSpec[],
//   objectIds?:string[], isFoot?:boolean, footPoint?:V3 }} LinkSpec
// @typedef {{ id:string, type:'revolute'|'continuous'|'prismatic'|'ball'|'fixed'|'universal',
//   parent:string, child:string, anchor:V3, axis:V3, axis2?:V3,
//   limits?:{min:number,max:number}|null, damping?:number, friction?:number,
//   actuatorId?:string|null }} JointSpec
// @typedef {{ id:string, jointId:string, kind:'servo', componentId?:string,
//   spec?:object, thermal?:object, encoder?:object|false }} ActuatorSpec
// @typedef {{ id:string, name?:string, baseLinkId:string, forward?:V3,
//   links:LinkSpec[], joints:JointSpec[], actuators:ActuatorSpec[],
//   imu?:{ linkId?:string, spec?:object }|false,
//   power?:object, locomotion?:{ type:string, gait?:object, balance?:object },
//   controllerLoad_A?:number }} PhysicsGraphSpec

export const JOINT_TYPES = ['revolute', 'continuous', 'prismatic', 'ball', 'fixed', 'universal']

export function validateGraph(g) {
  const errors = []
  if (!g || !Array.isArray(g.links) || g.links.length === 0) return ['graph has no links']
  const ids = new Set(g.links.map(l => l.id))
  if (!ids.has(g.baseLinkId)) errors.push(`base link ${g.baseLinkId} missing`)
  const parentOf = new Map()
  for (const j of g.joints ?? []) {
    if (!JOINT_TYPES.includes(j.type)) errors.push(`joint ${j.id}: unknown type ${j.type}`)
    if (!ids.has(j.parent) || !ids.has(j.child)) errors.push(`joint ${j.id}: dangling link`)
    if (j.parent === j.child) errors.push(`joint ${j.id}: parent === child`)
    if (parentOf.has(j.child)) errors.push(`link ${j.child} has two parent joints (loops not supported)`)
    parentOf.set(j.child, j)
    const a = j.axis
    if (j.type !== 'fixed' && j.type !== 'ball' && !(a && Math.hypot(a.x, a.y, a.z) > 1e-9)) errors.push(`joint ${j.id}: zero axis`)
  }
  // Tree check: walking up from every link must reach the base without a cycle.
  for (const l of g.links) {
    const seen = new Set(); let cur = l.id
    while (cur !== g.baseLinkId) {
      if (seen.has(cur)) { errors.push(`cycle at ${l.id}`); break }
      seen.add(cur)
      const j = parentOf.get(cur)
      if (!j) break   // a free-floating extra link is allowed (it's its own body)
      cur = j.parent
    }
  }
  const jointIds = new Set((g.joints ?? []).map(j => j.id))
  for (const a of g.actuators ?? []) if (!jointIds.has(a.jointId)) errors.push(`actuator ${a.id}: joint ${a.jointId} missing`)
  return errors
}

/** Parent joint per link and child joints per link. */
export function topology(g) {
  const parentJoint = new Map(), childJoints = new Map()
  for (const l of g.links) childJoints.set(l.id, [])
  for (const j of g.joints ?? []) { parentJoint.set(j.child, j); childJoints.get(j.parent)?.push(j) }
  return { parentJoint, childJoints }
}

/** Joints from the base down to `linkId` (base→tip order), or null if detached. */
export function jointPathTo(g, linkId, topo = topology(g)) {
  const path = []
  let cur = linkId
  while (cur !== g.baseLinkId) {
    const j = topo.parentJoint.get(cur)
    if (!j) return null
    path.unshift(j)
    cur = j.parent
  }
  return path
}

// y-component of a quaternion-rotated vector (only the vertical extent matters).
function rotY(q, x, y, z) {
  if (!q) return y
  const { x: qx, y: qy, z: qz, w: qw } = q
  // v' = v + 2w(q×v) + 2 q×(q×v); take the y row.
  const cx = qy * z - qz * y, cy = qz * x - qx * z, cz = qx * y - qy * x
  return y + 2 * qw * cy + 2 * (qz * cx - qx * cz)
}

/** Vertical half-extent of a collider shape under its offset rotation. */
export function colliderHalfHeightY(c) {
  const q = c.offset?.q
  if (c.shape === 'sphere') return c.radius ?? 0
  if (c.shape === 'cylinder' || c.shape === 'capsule') {
    // Local axis is Y; extent = |axis_y|·halfHeight + radius·√(1 − axis_y²) (+ radius for capsule caps)
    const ay = Math.abs(rotY(q, 0, 1, 0))
    const r = c.radius ?? 0, hh = c.halfHeight ?? 0
    return ay * hh + r * (c.shape === 'capsule' ? 1 : Math.sqrt(Math.max(0, 1 - ay * ay)))
  }
  if (c.halfExtents) {
    const h = c.halfExtents
    return Math.abs(rotY(q, h.x, 0, 0)) + Math.abs(rotY(q, 0, h.y, 0)) + Math.abs(rotY(q, 0, 0, h.z))
  }
  if (Array.isArray(c.points) && c.points.length >= 3) {
    let min = Infinity
    for (let i = 0; i < c.points.length; i += 3) min = Math.min(min, rotY(q, c.points[i], c.points[i + 1], c.points[i + 2]))
    return -min
  }
  return 0
}

/** Lowest world point of a link's collider set at rest. */
export function linkLowestPoint(link) {
  let best = null
  for (const c of link.colliders) {
    const p = c.offset?.p ?? { x: 0, y: 0, z: 0 }
    const y = link.origin.y + p.y - colliderHalfHeightY(c)
    if (!best || y < best.y) best = { x: link.origin.x + p.x, y, z: link.origin.z + p.z }
  }
  return best ?? { ...link.origin }
}
