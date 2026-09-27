// Scene → Physics graph. Turns the CAD/electronics model of ONE robot into the
// pure-data physics graph that ArticulatedRobot instantiates.
//
// Links (rigid bodies) come from COMPONENT RELATIONSHIPS, not from guessing a
// robot type:
//   • bonds (surface welds) and attachments-into-a-servo-horn union parts into
//     rigid groups; everything inside servo S's horn forms S's "rotor" group;
//   • a jointStore joint separates its child into its own link;
//   • a loose part that isn't bonded to anything joins the group it physically
//     touches (e.g. a knee servo sitting on a thigh), preferring a moving rotor
//     group; an isolated part rides with the base (legacy behaviour).
// Joints: every servo with something attached to its horn → an actuated
// revolute joint (anchor = horn pivot, axis = shaft); DC-motor attachments →
// free continuous joints; jointStore hinge/revolute/slider/ball → passive joints.
import * as THREE from 'three'
import { getMassForObject } from '../MassCalculator.js'
import { resolveObjectPhysics, resolveServoConfig, resolveJointConfig } from './config.js'

const SERVO_TYPES = new Set(['servo'])
const MOTOR_TYPES = new Set(['motor', 'motor_dc', 'motor_bo'])
const CONTROLLER_TYPES = new Set(['arduino', 'subo'])
const DEG = Math.PI / 180
const TOUCH = 0.05   // su — AABB tolerance for "physically touching"

class DSU {
  constructor() { this.p = new Map() }
  find(a) { if (!this.p.has(a)) this.p.set(a, a); let r = a; while (this.p.get(r) !== r) r = this.p.get(r); this.p.set(a, r); return r }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(rb, ra); return ra }
}

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _box = new THREE.Box3()

/**
 * Visit an object's OWN meshes. Parts attached into a servo/motor horn are
 * re-parented inside that servo's pivot group, so a plain traverse would count
 * the whole limb as part of the servo; stop at any descendant that is another
 * scene object (it has its own userData.id).
 */
// Editor overlays that live inside object hierarchies but are not solid matter
// (wiring pins/labels, wires, selection outlines, surface patches, handles…).
const NON_PHYSICAL_FLAGS = [
  'isPin', 'isPinSphere', 'isPinLabel', 'isWire', 'isWireLine', 'isWireHandle',
  'isSelectionOutline', 'isPatchMesh', 'isJointHelper', 'isHandle', 'isGuide',
  'isAttachMarker', 'isHelper', 'isPrintBed', 'isBattleProxy',
]
const isNonPhysical = (n) => { const u = n.userData; return !!u && (u.pinId != null || NON_PHYSICAL_FLAGS.some(f => u[f])) }

function forOwnMeshes(root, fn) {
  const id = root.userData?.id
  const visit = (n) => {
    if (n !== root && n.userData?.id && n.userData.id !== id) return   // another scene object
    if (isNonPhysical(n)) return
    if (n.isMesh && n.geometry) fn(n)
    for (const c of n.children) visit(c)
  }
  visit(root)
}

/** World AABB of an object's own geometry (attached parts excluded). */
function ownAABB(root) {
  root.updateMatrixWorld(true)
  const b = new THREE.Box3()
  forOwnMeshes(root, (n) => {
    if (!n.geometry.boundingBox) n.geometry.computeBoundingBox()
    b.union(_box.copy(n.geometry.boundingBox).applyMatrix4(n.matrixWorld))
  })
  if (b.isEmpty()) b.setFromCenterAndSize(root.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.5, 0.5, 0.5))
  return b
}

/** Oriented bounding box of an object in its own frame, expressed in world. */
function objectOBB(mesh) {
  mesh.updateMatrixWorld(true)
  _inv.copy(mesh.matrixWorld).invert()
  const box = new THREE.Box3()
  forOwnMeshes(mesh, (n) => {
    if (!n.geometry.boundingBox) n.geometry.computeBoundingBox()
    _m.multiplyMatrices(_inv, n.matrixWorld)
    box.union(_box.copy(n.geometry.boundingBox).applyMatrix4(_m))
  })
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.5, 0.5, 0.5))
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  mesh.matrixWorld.decompose(p, q, s)
  const cLocal = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
  return {
    center: cLocal.applyMatrix4(mesh.matrixWorld),
    half: new THREE.Vector3(Math.abs(size.x * s.x) / 2, Math.abs(size.y * s.y) / 2, Math.abs(size.z * s.z) / 2),
    quat: q,
    aabb: ownAABB(mesh),
  }
}

/** World-space vertices of an object (down-sampled) for convex/mesh colliders. */
function objectPoints(mesh, max = 256) {
  const pts = []
  mesh.updateMatrixWorld(true)
  const v = new THREE.Vector3()
  forOwnMeshes(mesh, (n) => {
    if (!n.geometry.attributes?.position) return
    const pos = n.geometry.attributes.position
    const step = Math.max(1, Math.floor(pos.count / max))
    for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld).clone())
  })
  return pts
}

function colliderFor(obj, mesh, origin, material) {
  const phys = resolveObjectPhysics(obj)
  const obb = objectOBB(mesh)
  const mass = phys.mass ?? getMassForObject(obj)
  const rel = (p) => ({ x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z })
  const q = { x: obb.quat.x, y: obb.quat.y, z: obb.quat.z, w: obb.quat.w }
  let shape = phys.collider
  if (shape === 'auto') shape = obj.type === 'sphere' ? 'sphere' : obj.type === 'cylinder' ? 'cylinder' : obj.type === 'capsule' ? 'capsule' : 'box'
  const base = { objectId: obj.id, mass, material: phys.material ?? material, offset: { p: rel(obb.center), q } }
  const h = obb.half
  switch (shape) {
    case 'sphere':   return { ...base, shape, radius: Math.max(h.x, h.y, h.z) }
    case 'cylinder': return { ...base, shape, radius: Math.max(h.x, h.z), halfHeight: h.y }
    case 'capsule':  return { ...base, shape, radius: Math.max(h.x, h.z), halfHeight: Math.max(0.01, h.y - Math.max(h.x, h.z)) }
    case 'convex':
    case 'mesh': {
      // Points relative to the collider centre, in the collider (= object) frame.
      const invQ = obb.quat.clone().invert()
      const pts = objectPoints(mesh).flatMap(p => { const r = p.clone().sub(obb.center).applyQuaternion(invQ); return [r.x, r.y, r.z] })
      return { ...base, shape, points: pts }
    }
    default:         return { ...base, shape: 'box', halfExtents: { x: h.x, y: h.y, z: h.z } }
  }
}

/**
 * @param opts.objects        scene objects of this robot (top-level, non-standalone)
 * @param opts.allObjects     every scene object (attached children live here too)
 * @param opts.objectMgr      ObjectManager (meshes)
 * @param opts.attachments    childId → motorOrServoId
 * @param opts.bonds          [{ parentId, childId }]
 * @param opts.joints         jointStore joints
 * @param opts.robotConfig    resolveRobotConfig(root)
 * @param opts.rootId         assembly root object id (base link seed)
 * @returns { graph, linkNodes: Map<linkId, THREE.Object3D[]>, warnings[] }
 */
export function buildGraphFromScene(opts) {
  const { objects, allObjects, objectMgr, attachments = {}, bonds = [], joints = [], robotConfig = {}, rootId = null, id = 'robot' } = opts
  const warnings = []
  const byId = new Map(allObjects.map(o => [o.id, o]))
  const memberIds = new Set(objects.map(o => o.id))
  // Attached children (they live inside a servo/motor rotor group) belong to the robot too.
  for (const [childId, hostId] of Object.entries(attachments)) if (memberIds.has(hostId) && byId.has(childId)) memberIds.add(childId)
  const members = [...memberIds].map(i => byId.get(i)).filter(o => o && objectMgr.getMesh(o.id))

  const dsu = new DSU()
  const rotorKey = (sid) => `rotor:${sid}`
  for (const o of members) dsu.find(o.id)
  const hostOf = new Map()
  for (const [childId, hostId] of Object.entries(attachments)) {
    if (!memberIds.has(childId) || !memberIds.has(hostId)) continue
    hostOf.set(childId, hostId)
    dsu.union(rotorKey(hostId), childId)
  }
  const jointChildren = new Set(joints.filter(j => memberIds.has(j.parentId) && memberIds.has(j.childId) && j.type !== 'fixed').map(j => j.childId))
  for (const b of bonds) {
    if (!memberIds.has(b.parentId) || !memberIds.has(b.childId)) continue
    if (jointChildren.has(b.childId) || jointChildren.has(b.parentId)) continue   // a joint separates them
    dsu.union(b.parentId, b.childId)
  }
  for (const j of joints) if (j.type === 'fixed' && memberIds.has(j.parentId) && memberIds.has(j.childId)) dsu.union(j.parentId, j.childId)

  // Groups: root → { ids:Set, rotorOf: servoId|null }
  const groups = new Map()
  const groupOf = (k) => { const r = dsu.find(k); if (!groups.has(r)) groups.set(r, { ids: new Set(), rotorOf: null }); return groups.get(r) }
  for (const o of members) groupOf(o.id).ids.add(o.id)
  for (const hostId of new Set(hostOf.values())) {
    const g = groupOf(rotorKey(hostId))
    if (g.rotorOf && g.rotorOf !== hostId) warnings.push(`parts attached to both ${g.rotorOf} and ${hostId} are welded together — one servo will be blocked`)
    g.rotorOf = g.rotorOf ?? hostId
  }
  for (const [k, g] of [...groups]) if (g.ids.size === 0) groups.delete(k)

  // Per-group AABB for "touching" merges.
  const aabbOf = (g) => { const b = new THREE.Box3(); for (const i of g.ids) b.union(ownAABB(objectMgr.getMesh(i))); return b.expandByScalar(TOUCH) }
  const massOf = (g) => [...g.ids].reduce((s, i) => s + (resolveObjectPhysics(byId.get(i)).mass ?? getMassForObject(byId.get(i))), 0)

  // Base = group containing the assembly root, else the heaviest non-rotor group.
  let baseKey = rootId && memberIds.has(rootId) ? dsu.find(rootId) : null
  if (!baseKey || groups.get(baseKey)?.rotorOf) {
    let best = -1
    for (const [k, g] of groups) if (!g.rotorOf) { const m = massOf(g); if (m > best) { best = m; baseKey = k } }
  }
  if (!baseKey) baseKey = [...groups.keys()][0]

  // Merge loose groups (no rotor, not base, not a joint child) into what they touch.
  const servosIn = (g) => [...g.ids].filter(i => SERVO_TYPES.has(byId.get(i)?.type) || MOTOR_TYPES.has(byId.get(i)?.type))
  const isJointChildGroup = (g) => [...g.ids].some(i => jointChildren.has(i))
  let changed = true
  while (changed) {
    changed = false
    for (const [k, g] of groups) {
      if (k === baseKey || g.rotorOf || isJointChildGroup(g)) continue
      const box = aabbOf(g)
      const own = new Set(servosIn(g))
      let target = null, bestVol = -1, targetIsRotor = false
      for (const [k2, g2] of groups) {
        if (k2 === k || (g2.rotorOf && own.has(g2.rotorOf))) continue   // never ride on your own horn
        const inter = box.clone().intersect(aabbOf(g2))
        if (inter.isEmpty()) continue
        const sz = inter.getSize(new THREE.Vector3()), vol = sz.x * sz.y * sz.z
        const isRotor = !!g2.rotorOf
        if ((isRotor && !targetIsRotor) || (isRotor === targetIsRotor && vol > bestVol)) { target = k2; bestVol = vol; targetIsRotor = isRotor }
      }
      const into = target ?? baseKey
      for (const i of g.ids) groups.get(into).ids.add(i)
      groups.delete(k)
      changed = true
      break
    }
  }

  // ── Links ──────────────────────────────────────────────────────────────────
  const linkIdOfGroup = new Map()
  const linkIdOfObject = new Map()
  let n = 0
  for (const [k, g] of groups) {
    const lid = k === baseKey ? 'base' : g.rotorOf ? `rotor_${g.rotorOf}` : `link${n++}`
    linkIdOfGroup.set(k, lid)
    for (const i of g.ids) linkIdOfObject.set(i, lid)
  }

  const pivotOf = (sid) => objectMgr.getMesh(sid)?.userData?.rotorGroup ?? null
  const pivotFrame = (sid) => {
    const pv = pivotOf(sid)
    if (!pv) return null
    pv.updateMatrixWorld(true)
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    pv.matrixWorld.decompose(p, q, s)
    const axisName = objectMgr.getMesh(sid)?.userData?.rotorAxis ?? 'y'
    const a = new THREE.Vector3(axisName === 'x' ? 1 : 0, axisName === 'y' ? 1 : 0, axisName === 'z' ? 1 : 0).applyQuaternion(q).normalize()
    return { anchor: p, axis: a, pivot: pv }
  }

  const links = [], linkNodes = new Map()
  for (const [k, g] of groups) {
    const lid = linkIdOfGroup.get(k)
    let origin
    if (g.rotorOf && pivotFrame(g.rotorOf)) origin = pivotFrame(g.rotorOf).anchor.clone()
    else {
      origin = new THREE.Vector3(); let w = 0
      for (const i of g.ids) { const o = objectOBB(objectMgr.getMesh(i)); const m = Math.max(1e-3, getMassForObject(byId.get(i))); origin.addScaledVector(o.center, m); w += m }
      origin.divideScalar(Math.max(1e-9, w))
    }
    const colliders = []
    for (const i of g.ids) {
      const obj = byId.get(i), mesh = objectMgr.getMesh(i)
      colliders.push(colliderFor(obj, mesh, origin, undefined))
    }
    links.push({ id: lid, name: lid, origin: { x: origin.x, y: origin.y, z: origin.z }, colliders, objectIds: [...g.ids] })
    // Render nodes: top-level meshes of this link (attached ones ride inside their pivot).
    const nodes = []
    for (const i of g.ids) if (!hostOf.has(i)) nodes.push(objectMgr.getMesh(i))
    linkNodes.set(lid, nodes)
  }

  // ── Joints + actuators ────────────────────────────────────────────────────
  const gjoints = [], actuators = []
  for (const hostId of new Set(hostOf.values())) {
    const host = byId.get(hostId)
    const pf = pivotFrame(hostId)
    const childLink = `rotor_${hostId}`, parentLink = linkIdOfObject.get(hostId)
    if (!pf || !parentLink || parentLink === childLink || !links.some(l => l.id === childLink)) { warnings.push(`servo/motor ${hostId}: no usable pivot — skipped`); continue }
    // The pivot group (horn + attached parts) is rendered with the child link.
    linkNodes.get(childLink).push(pf.pivot)
    const jid = `j_${hostId}`
    if (SERVO_TYPES.has(host.type)) {
      const jc = resolveJointConfig(host), sc = resolveServoConfig(host)
      gjoints.push({
        id: jid, type: 'revolute', parent: parentLink, child: childLink, anchor: pf.anchor, axis: pf.axis,
        limits: { min: jc.minAngleDeg * DEG, max: jc.maxAngleDeg * DEG }, damping: jc.damping, friction: jc.friction,
      })
      const { thermal, encoder, ...spec } = sc
      actuators.push({
        id: `act_${hostId}`, jointId: jid, kind: 'servo', componentId: hostId,
        spec: { ...spec, minAngle: -Math.PI / 2, maxAngle: Math.PI / 2 }, thermal,
        encoder: encoder?.enabled === false ? false : encoder,
      })
    } else {
      // DC motor with a wheel/rotor: a free continuous joint (driven by the
      // wheeled path, not by this articulated model yet).
      gjoints.push({ id: jid, type: 'continuous', parent: parentLink, child: childLink, anchor: pf.anchor, axis: pf.axis, damping: 0.0005, friction: 0.001 })
    }
  }
  for (const j of joints) {
    if (j.type === 'fixed') continue
    const pl = linkIdOfObject.get(j.parentId), cl = linkIdOfObject.get(j.childId)
    if (!pl || !cl || pl === cl) continue
    const type = j.type === 'slider' ? 'prismatic' : j.type === 'ball' ? 'ball' : 'revolute'
    gjoints.push({
      id: `jt_${j.id}`, type, parent: pl, child: cl,
      anchor: { ...j.anchorPoint }, axis: { ...j.axis },
      limits: type === 'prismatic' ? { min: j.limits?.minDist ?? 0, max: j.limits?.maxDist ?? 5 }
        : type === 'revolute' ? { min: (j.limits?.minAngle ?? -180) * DEG, max: (j.limits?.maxAngle ?? 180) * DEG } : null,
      damping: 0.001, friction: 0.001,
    })
  }

  // IMU on the controller board's link.
  const ctrl = members.find(o => CONTROLLER_TYPES.has(o.type))
  const imuLink = ctrl ? linkIdOfObject.get(ctrl.id) : 'base'

  return {
    graph: {
      id, name: id, baseLinkId: 'base',
      forward: robotConfig.forwardVector ?? { x: 0, y: 0, z: -1 },
      links, joints: gjoints, actuators,
      imu: robotConfig.imu?.enabled === false ? false : { linkId: imuLink, spec: robotConfig.imu },
      power: robotConfig.power,
      locomotion: { type: 'legs', gait: robotConfig.gait, balance: robotConfig.balance },
    },
    linkNodes, warnings,
  }
}
