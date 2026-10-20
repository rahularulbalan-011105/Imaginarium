import * as THREE from 'three'
import { useSceneStore } from '../stores/sceneStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { assemblyMembers } from '../utils/robotAssembly.js'
import { weaponForType } from './weaponRegistry.js'

// ─────────────────────────────────────────────────────────────────────────────
// Robot front — which side of a robot is its nose.
//
// Stored on the robot's ROOT scene object as `front` ('+z' | '+x' | '-z' | '-x'),
// an axis in the root part's OWN local frame, so turning the robot in the
// editor carries the front with it. Saved / exported / duplicated like any
// object field.
//
// When it isn't set, the front is INFERRED from the mounted weapons: their
// barrels (mount.forward through each weapon's pose), expressed in the root's
// frame, summed and snapped to the nearest of the four axes — a combat robot's
// guns point out of its nose. No weapons (or barrels that cancel out) → '+z',
// the convention the arena, the Robo-Sumo `front` control and every built-in
// model use (local +Z forward, yaw = atan2(fwd.x, fwd.z)). An explicit setting
// always wins.
//
// The arena puts the body's drive axis (+Z) on this direction, so "forward" for
// WASD, the chase camera and the AI is the declared front. Weapons are NOT
// derived from it — each fires along its own mounted axis (WeaponManager).
// ─────────────────────────────────────────────────────────────────────────────

export const FRONTS = ['+z', '+x', '-z', '-x']
export const FRONT_LABEL = { '+z': '+Z', '+x': '+X', '-z': '−Z', '-x': '−X' }
export const DEFAULT_FRONT = '+z'

const AXIS = {
  '+z': new THREE.Vector3(0, 0, 1), '+x': new THREE.Vector3(1, 0, 0),
  '-z': new THREE.Vector3(0, 0, -1), '-x': new THREE.Vector3(-1, 0, 0),
}
const UP = new THREE.Vector3(0, 1, 0)

export function normalizeFront(v) { return FRONTS.includes(v) ? v : DEFAULT_FRONT }

/** Front implied by the robot's mounted weapons, or null (none / no clear direction). */
export function inferFrontFromWeapons(rootId) {
  const root = objectManager.getMesh(rootId)
  if (!root) return null
  const byId = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
  root.updateWorldMatrix(true, false)
  const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert()
  const sum = new THREE.Vector3()
  let n = 0
  for (const id of assemblyMembers(rootId)) {
    const f = weaponForType(byId.get(id)?.type)?.mount?.forward
    const m = f ? objectManager.getMesh(id) : null
    if (!m) continue
    const v = new THREE.Vector3(...({ '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] })[f] || [0, 0, 1])
    m.updateWorldMatrix(true, false)
    v.applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(inv)   // barrel in the root frame
    v.y = 0
    if (v.lengthSq() < 1e-4) continue
    sum.add(v.normalize()); n++
  }
  if (!n || sum.length() < 0.5 * n) return null              // barrels disagree → no clear nose
  return Math.abs(sum.x) > Math.abs(sum.z) ? (sum.x > 0 ? '+x' : '-x') : (sum.z > 0 ? '+z' : '-z')
}

/** The robot's front: explicit `front` on the root, else inferred from its weapons, else +Z. */
export function resolveFront(rootId) {
  const obj = useSceneStore.getState().objects.find(o => o.id === rootId)
  if (FRONTS.includes(obj?.front)) return { front: obj.front, auto: false }
  const inferred = inferFrontFromWeapons(rootId)
  return { front: inferred ?? DEFAULT_FRONT, auto: true }
}
export function frontOf(rootObj) { return normalizeFront(rootObj?.front) }
export function frontAxisLocal(front) { return AXIS[normalizeFront(front)].clone() }

/**
 * The robot's full frame: its root part's live world orientation re-based so
 * that local +Z is the declared front (roll / pitch kept). This is the frame a
 * weapon is aligned to when it's mounted — "forward" on a tipped robot follows
 * the robot, not the ground.
 */
export function robotFrame(rootId) {
  const mesh = objectManager.getMesh(rootId)
  if (!mesh) return null
  const a = frontAxisLocal(resolveFront(rootId).front)
  mesh.updateWorldMatrix(true, false)
  const rebase = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(a.x, a.z))   // local +Z → local front
  return mesh.getWorldQuaternion(new THREE.Quaternion()).multiply(rebase)
}

/**
 * The robot's heading in the world, from its root part's live pose:
 *   axis — unit world vector of the declared front, flattened to the ground
 *   yaw  — atan2(axis.x, axis.z)
 *   q    — the yaw-only rotation that takes local +Z onto `axis`
 * Returns null when the root has no mesh.
 */
export function robotHeading(rootId) {
  const mesh = objectManager.getMesh(rootId)
  if (!mesh) return null
  const front = resolveFront(rootId).front
  mesh.updateWorldMatrix(true, false)
  const axis = frontAxisLocal(front).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()))
  axis.y = 0
  if (axis.lengthSq() < 1e-6) {
    // Root tipped so its front points straight up/down: fall back to its local
    // "up" projected, else world +Z — never a NaN heading.
    axis.copy(UP).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion())); axis.y = 0
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1)
  }
  axis.normalize()
  const yaw = Math.atan2(axis.x, axis.z)
  return { front, axis, yaw, q: new THREE.Quaternion().setFromAxisAngle(UP, yaw) }
}
