import * as THREE from 'three'
import { physicsManager } from '../physics/PhysicsManager.js'
import { raycastFirst, prepareSurfaceRaycast } from '../../utils/surfaceRaycast.js'
import { useRigidStore } from '../../stores/rigidStore.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { isWeaponType } from '../../combat/weaponRegistry.js'

// ─────────────────────────────────────────────────────────────────────────────
// RobotDamageView — how combat damage LOOKS and MOVES on each robot.
//
// The combat state (armor / core / stagger / overheat / destroyed) stays owned by
// DamageManager + the combat systems. This layer only reacts to it:
//
//   locate()    – which real part of the robot a hit landed on (raycast against
//                 the robot's actual Robot-Builder meshes → part, point, normal)
//   hit()       – an impact mark exactly where the hit landed, per-part damage
//                 bookkeeping (the REAL damage dealt), part jolt, chassis rock,
//                 and STRUCTURAL damage to the mounts near the hit
//   step()      – damped-spring reactions applied on top of the physics pose,
//                 smoke/sparks driven by the real armor/core state, loose parts
//                 following their own Rapier bodies, the destruction sequence
//
// Parts vs mounts: every non-root part hangs on its parent by a MOUNT — the
// Robot-Builder bond, anchored where the two parts meet. Hitting a part damages
// the part; how much of that reaches its mount depends on how close to the mount
// the hit landed (a round on the muzzle barely strains the mount, a round at the
// base goes straight into it). Hitting the parent right next to a mount strains
// that mount too. A mount goes HEALTHY → DAMAGED → WEAKENED → CRITICAL → FAILED,
// visibly (sparks at the joint, the part sagging then hanging loose), and ONLY a
// FAILED mount lets its part go. Nothing else detaches a part — not being hit,
// not the robot being destroyed. Breaking off is physical (the actual component
// gets its own rigid body, pushed by the impact that broke it) and real (the host
// removes it from the robot; a lost weapon can no longer fire). Everything is
// runtime-only and undone by clear() — the saved robot is never touched.
// ─────────────────────────────────────────────────────────────────────────────

export const PART_STATE = { HEALTHY: 0, DAMAGED: 1, SEVERE: 2, DETACHED: 3 }
export const MOUNT_STATE = { HEALTHY: 0, DAMAGED: 1, WEAKENED: 2, CRITICAL: 3, FAILED: 4 }

const TUNE = {
  weaponBreakoff: true,      // a weapon whose mount fails really comes off (and can no longer fire)
  // Mount strength = share of the robot's total HP (real damage) its mount can take.
  weaponMount: 0.45, partMountMin: 0.12, partMountMax: 0.3,
  mountAt: [0.25, 0.5, 0.78, 1],   // DAMAGED / WEAKENED / CRITICAL / FAILED (fraction of mount strength)
  mountNear: 0.25,           // su — a hit this close to the mount goes straight into it
  mountReach: 0.7,           // su — beyond this only the shock reaches the mount…
  mountFar: 0.2,             // …this share of the hit
  mountRadius: 0.9,          // su — hits on the PARENT this close to a mount strain it
  partCapMin: 0.2, partCapMax: 0.5,
  damagedAt: 0.3, severeAt: 0.65,
  maxDecals: 48,             // impact marks per robot (oldest are recycled)
  clusterRadius: 0.75,       // su — hits this close together wear the surface down
  tiltK: 170, tiltC: 13, tiltMax: 0.13,     // chassis rock spring (rad)
  dipK: 220, dipC: 16, dipMax: 0.22,        // suspension dip (su)
  pushK: 120, pushC: 15, pushMax: 0.9,      // lunge / recoil slide (su)
  kickK: 300, kickC: 20, kickMax: 0.35,     // per-part jolt (su)
}

const UP = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _e = new THREE.Euler()
const _box = new THREE.Box3()
const _rc = new THREE.Raycaster()
const _nm = new THREE.Matrix3()
const rand = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export class RobotDamageView {
  constructor(fx) {
    this._fx = fx
    this._views = new Map()      // robotId → view
    this._loose = []             // detached parts (own physics bodies)
    this._host = null
    this._t = 0
  }

  // host: { getActor(id), onDetach(robotId, mesh), onEvent(name, data) }
  bind(robots, host) {
    this._host = host
    const objs = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
    const bonds = useRigidStore.getState().getBonds()
    for (const robot of robots) {
      const actor = host.getActor(robot.id)
      const totalHp = (actor?.armorMax ?? 100) + (actor?.coreMax ?? 100)
      const ids = new Set(robot.movers.map(mv => mv.mesh.userData.id))
      const parts = []
      let volSum = 0
      for (const mv of robot.movers) {
        const mesh = mv.mesh
        const id = mesh.userData.id
        const meshes = []
        mesh.traverseVisible(c => {
          if (c.isMesh && c.geometry && !c.userData.isPinSphere && !c.userData.isPinLabel && !c.userData.isAttachMarker) meshes.push(c)
        })
        mesh.updateWorldMatrix(true, true)
        _box.setFromObject(mesh)
        const size = _box.getSize(new THREE.Vector3())
        const vol = Math.max(0.05, size.x * size.y * size.z)
        volSum += vol
        parts.push({
          mesh, id, meshes, vol,
          isRoot: id === robot.id,
          isWeapon: isWeaponType(objs.get(id)?.type),
          children: new Set(bonds.filter(b => b.parentId === id && ids.has(b.childId)).map(b => b.childId)),
          top: mesh.worldToLocal(new THREE.Vector3(_box.min.x + size.x / 2, _box.max.y, _box.min.z + size.z / 2)),
          damage: 0, cap: 1, state: PART_STATE.HEALTHY,
          last: null,                       // last hit point, part-local
          kick: new THREE.Vector3(), kickVel: new THREE.Vector3(),
          sag: null,                        // how far a failing mount lets the part hang off true
          glow: 0, glowColor: new THREE.Color(), mats: null,
          nextSoot: 0,
          hits: [], wear: [],               // recent mark positions (part-local) + worn patches
          mount: null,
          loose: null,
          size,
        })
      }
      if (!parts.some(p => p.isRoot) && parts.length) parts[0].isRoot = true
      // Mounts: one per non-root part, from the Robot-Builder bond that carries it.
      const byId0 = new Map(parts.map(p => [p.id, p]))
      const rootPart = parts.find(p => p.isRoot)
      for (const p of parts) {
        if (p.isRoot) continue
        const bond = bonds.find(b => b.childId === p.id && byId0.has(b.parentId))
        const parent = (bond && byId0.get(bond.parentId)) || rootPart
        if (!parent || parent === p) continue
        const childBox = new THREE.Box3().setFromObject(p.mesh)
        const childCenter = childBox.getCenter(new THREE.Vector3())
        // Anchor = where the part meets its parent: the bond's recorded contact
        // point (surface mounts store one), else the parent's nearest point.
        const anchor = bond?.contactLocalCenter
          ? parent.mesh.localToWorld(new THREE.Vector3(bond.contactLocalCenter.x, bond.contactLocalCenter.y, bond.contactLocalCenter.z))
          : new THREE.Box3().setFromObject(parent.mesh).clampPoint(childCenter, new THREE.Vector3())
        childBox.clampPoint(anchor, anchor)          // keep it on the part itself
        const out = childCenter.clone().sub(anchor)
        if (out.lengthSq() < 1e-6) out.set(0, 1, 0)
        out.normalize()
        p.mount = {
          parent,
          aChild: p.mesh.worldToLocal(anchor.clone()),
          aParent: parent.mesh.worldToLocal(anchor.clone()),
          outParent: out.clone().applyQuaternion(parent.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()),
          cap: 1, damage: 0, state: MOUNT_STATE.HEALTHY, sparkIn: 0,
        }
        parent.children.add(p.id)
      }
      for (const p of parts) {
        p.cap = totalHp * (p.isRoot ? 0.6 : clamp(TUNE.partCapMin + 0.5 * (p.vol / volSum), TUNE.partCapMin, TUNE.partCapMax))
        if (p.mount) {
          p.mount.cap = totalHp * (p.isWeapon ? TUNE.weaponMount
            : clamp(TUNE.partMountMin + 0.4 * (p.vol / volSum), TUNE.partMountMin, TUNE.partMountMax))
        }
      }
      const view = {
        robot, parts, byId: new Map(parts.map(p => [p.id, p])),
        meshes: [], partOf: new Map(),
        tilt: { x: 0, z: 0, vx: 0, vz: 0, rx: 0, rz: 0 },     // rx/rz = rest pose (wreck lean)
        dip: { y: 0, v: 0, rest: 0 },
        push: new THREE.Vector3(), pushVel: new THREE.Vector3(),
        decals: [],
        smokeIn: 0, sparkIn: rand(1, 2), heatIn: 0,
        dead: null,
      }
      this._rebuild(view)
      prepareSurfaceRaycast(view.meshes)
      this._views.set(robot.id, view)
    }
  }

  _rebuild(view) {
    view.meshes = []
    view.partOf = new Map()
    for (const p of view.parts) {
      if (p.state === PART_STATE.DETACHED) continue
      for (const m of p.meshes) { view.meshes.push(m); view.partOf.set(m, p) }
    }
  }

  part(robotId, mesh) { return this._views.get(robotId)?.parts.find(p => p.mesh === mesh) ?? null }

  // ── Hit localization ────────────────────────────────────────────────────────
  // `point` = where the combat system registered the hit (physics box / blast
  // centre), `dir` = unit travel direction. Returns the part + exact surface
  // point + outward normal on the robot's real geometry.
  locate(robotId, point, dir) {
    const view = this._views.get(robotId)
    if (!view || !view.meshes.length) return null
    const reach = (view.robot.radius || 2) * 2 + 3
    _rc.ray.origin.copy(point).addScaledVector(dir, -1.5)
    _rc.ray.direction.copy(dir)
    _rc.near = 0; _rc.far = reach + 1.5
    const hit = raycastFirst(_rc, view.meshes)
    if (hit) {
      const normal = hit.face.normal.clone().applyMatrix3(_nm.getNormalMatrix(hit.object.matrixWorld)).normalize()
      if (normal.dot(dir) > 0) normal.negate()
      return { part: view.partOf.get(hit.object), point: hit.point.clone(), normal, surface: true }
    }
    // The shot clipped the collision box but met no visible geometry. The combat
    // system still counts the damage, so it goes to the hull as a whole — but it
    // touched no particular part: no mark, no mount strain (surface: false).
    const best = view.parts.find(p => p.isRoot && p.state !== PART_STATE.DETACHED) || view.parts.find(p => p.state !== PART_STATE.DETACHED)
    return best ? { part: best, point: new THREE.Vector3().copy(point), normal: new THREE.Vector3().copy(dir).negate(), surface: false } : null
  }

  // ── A hit landed on `part` ──────────────────────────────────────────────────
  // info: { dealt, dir, point, normal, kick (0..~1.5), rock (0..~1.5), force (0..1),
  //         mark?: {type,size}, glow?: {color, amount}, soot?: bool }
  // Returns { state, changed, detached, mounts: [{ part, state, failed }] }.
  hit(robotId, part, info) {
    const view = this._views.get(robotId)
    if (!view || !part) return null
    const { dir, point, normal } = info
    part.damage += info.dealt || 0
    if (info.surface !== false) part.last = part.mesh.worldToLocal(_v.copy(point)).clone()

    // Mechanical reaction: the struck part jolts along the hit, the chassis rocks
    // away from it and the suspension dips.
    if (info.kick) part.kickVel.addScaledVector(dir, info.kick * 5.5)
    if (info.rock) {
      view.tilt.vx += dir.z * info.rock * 1.5
      view.tilt.vz += -dir.x * info.rock * 1.5
      view.dip.v -= info.rock * 1.6
    }
    if (info.glow) { part.glow = Math.min(1, part.glow + info.glow.amount); part.glowColor.setHex(info.glow.color) }

    // The mark goes exactly where the hit landed, lying on that surface.
    if (info.mark && (!info.soot || this._t >= part.nextSoot)) {
      if (info.soot) part.nextSoot = this._t + 0.3
      this._mark(view, part, point, normal, info.mark.type, info.mark.size)
      if (info.mark.type === 'bullet') this._wear(view, part, point, normal)
    }
    // Loose parts rattle whenever the robot takes a hit.
    for (const p of view.parts) if (p.mount?.state === MOUNT_STATE.CRITICAL && p.state !== PART_STATE.DETACHED) p.kickVel.addScaledVector(dir, 1.2).y += rand(0.5, 1.5)

    if (view.dead || part.state === PART_STATE.DETACHED) return { state: part.state, changed: false, detached: false, mounts: [] }

    // Part wear (how beaten-up the part itself looks).
    const f = part.damage / part.cap
    const next = f >= TUNE.severeAt ? PART_STATE.SEVERE : f >= TUNE.damagedAt ? PART_STATE.DAMAGED : PART_STATE.HEALTHY
    const changed = next > part.state
    if (changed) {
      part.state = next
      if (next === PART_STATE.SEVERE) this._mark(view, part, point, normal, 'hot', 0.4)   // exposed, glowing damage
    }

    // Structure: the hit strains this part's own mount (more the closer it landed
    // to it) and any mount on this part that sits right next to the impact.
    const mounts = []
    const dealt = info.dealt || 0
    if (dealt > 0 && info.surface !== false) {
      if (part.mount) this._strain(view, part, dealt * this._transfer(part, point), info, mounts)
      for (const cid of part.children) {
        const c = view.byId.get(cid)
        if (!c?.mount || c.mount.parent !== part || c.state === PART_STATE.DETACHED) continue
        const d = part.mesh.localToWorld(_v.copy(c.mount.aParent)).distanceTo(point)
        if (d < TUNE.mountRadius) this._strain(view, c, dealt * (1 - d / TUNE.mountRadius), info, mounts)
      }
    }
    return { state: part.state, changed, detached: part.state === PART_STATE.DETACHED, mounts }
  }

  // Share of a hit on `part` that reaches its mount: all of it at the mount,
  // falling off with distance to just the transmitted shock (TUNE.mountFar).
  _transfer(part, point) {
    const d = part.mesh.localToWorld(_v.copy(part.mount.aChild)).distanceTo(point)
    return 1 - (1 - TUNE.mountFar) * clamp((d - TUNE.mountNear) / (TUNE.mountReach - TUNE.mountNear), 0, 1)
  }

  // Add structural damage to `part`'s mount and act on any state it crosses.
  _strain(view, part, amount, info, events) {
    const m = part.mount
    if (!m || m.state === MOUNT_STATE.FAILED || amount <= 0) return
    m.damage += amount
    const f = m.damage / m.cap
    let next = f >= TUNE.mountAt[3] ? MOUNT_STATE.FAILED : f >= TUNE.mountAt[2] ? MOUNT_STATE.CRITICAL : f >= TUNE.mountAt[1] ? MOUNT_STATE.WEAKENED : f >= TUNE.mountAt[0] ? MOUNT_STATE.DAMAGED : MOUNT_STATE.HEALTHY
    if (next === MOUNT_STATE.FAILED && !this._canFail(view, part)) next = MOUNT_STATE.CRITICAL
    if (next <= m.state) return
    m.state = next
    const anchor = part.mesh.localToWorld(new THREE.Vector3().copy(m.aChild))
    const out = _v2.copy(m.outParent).applyQuaternion(m.parent.mesh.getWorldQuaternion(_q2)).normalize()
    if (next === MOUNT_STATE.FAILED) {
      // Structural failure: the impact that finished the mount carries the part off.
      const dir = new THREE.Vector3().copy(info.dir).setY(0)
      if (dir.lengthSq() < 1e-4) dir.copy(out).setY(0)
      if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0)
      if (!this._detach(view, part, dir.normalize(), info.force ?? 0.5, anchor)) { m.state = MOUNT_STATE.CRITICAL; return }
    } else if (next === MOUNT_STATE.WEAKENED) {
      part.sag = new THREE.Quaternion().setFromEuler(_e.set(rand(-0.035, 0.035), rand(-0.02, 0.02), rand(-0.045, 0.045)))
      this._fx.sparks(anchor, out, { count: 7, speed: 7, spread: 1.1, color: 0xa8d8ff, life: 0.2, size: 0.05 })
    } else if (next === MOUNT_STATE.CRITICAL) {
      // Barely holding: the part hangs visibly off true and the joint is exposed.
      part.sag = new THREE.Quaternion().setFromEuler(_e.set(rand(0.06, 0.11) * (Math.random() < 0.5 ? -1 : 1), rand(-0.05, 0.05), rand(0.08, 0.14) * (Math.random() < 0.5 ? -1 : 1)))
      this._fx.flash(anchor, { size: 0.35, color: 0xbfe4ff, life: 0.06 })
      this._fx.sparks(anchor, out, { count: 12, speed: 9, spread: 1.1, color: 0xa8d8ff, life: 0.25, size: 0.05 })
      this._fx.debris(anchor, out, { count: 2, speed: 4, size: 0.08, life: 0.9, up: 3 })
      this._mark(view, m.parent, anchor, out, 'hot', 0.55)
      m.sparkIn = 0.3
    }
    events.push({ part, state: next, failed: next === MOUNT_STATE.FAILED })
  }

  _canFail(view, part) {
    if (part.isRoot) return false
    if (part.isWeapon && !TUNE.weaponBreakoff) return false
    for (const cid of part.children) if (view.byId.get(cid)?.state !== PART_STATE.DETACHED) return false   // still carries other parts
    return true
  }

  // One impact mark on `part` at a world point, lying on the surface (normal).
  _mark(view, part, point, normal, type, size) {
    if (view.decals.length >= TUNE.maxDecals) this._fx.releaseDecal(view.decals.shift())
    view.decals.push(this._fx.decal(part.mesh, point, normal, { type, size }))
  }

  // Repeated ballistic hits on the same spot wear the surface down: a chipped
  // patch once a few rounds cluster, then a deeper, exposed one.
  _wear(view, part, point, normal) {
    const local = part.mesh.worldToLocal(point.clone())
    let near = 0
    for (const h of part.hits) if (part.mesh.localToWorld(_v.copy(h)).distanceTo(point) < TUNE.clusterRadius) near++
    part.hits.push(local)
    if (part.hits.length > 30) part.hits.shift()
    let patch = null
    for (const w of part.wear) if (part.mesh.localToWorld(_v.copy(w.local)).distanceTo(point) < TUNE.clusterRadius * 1.3) { patch = w; break }
    if (near >= 2 && !patch) {
      part.wear.push({ local, level: 1 })
      this._mark(view, part, point, normal, 'wear', 1.0)
    } else if (near >= 6 && patch && patch.level === 1) {
      patch.level = 2
      this._mark(view, part, point, normal, 'wear', 1.45)
      this._mark(view, part, point, normal, 'hot', 0.32)
    }
  }

  // The mount failed: `part` leaves the robot and becomes a free rigid body in the
  // arena. `force` (0..1) = how hard the impact that broke it was.
  _detach(view, part, dir, force, anchor = null) {
    const mesh = part.mesh
    mesh.updateWorldMatrix(true, true)
    _box.setFromObject(mesh, true)
    if (_box.isEmpty()) return false
    const center = _box.getCenter(new THREE.Vector3())
    const half = _box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
    const bodyId = 'arena_part_' + part.id
    const body = physicsManager.createDebrisBody(
      bodyId, { x: center.x, y: Math.max(center.y, half.y + 0.05), z: center.z },
      { x: Math.max(0.12, half.x), y: Math.max(0.12, half.y), z: Math.max(0.12, half.z) },
    )
    if (!body) return false                                      // no physics → it stays on (never fake it)
    const rv = physicsManager.getLinvel(view.robot.bodyId) || { x: 0, y: 0, z: 0 }
    // Thrown by the impact that broke the mount: a bullet tips the part off, a
    // heavy blow flings it. (The arena world runs scene-unit gravity, ~196 su/s²,
    // so even a small hop needs a firm upward speed.)
    const k = clamp(force, 0.15, 1)
    const speed = 4 + 12 * k + rand(0, 2)
    body.setLinvel({ x: rv.x + dir.x * speed, y: 8 + 13 * k + rand(0, 3), z: rv.z + dir.z * speed }, true)
    body.setAngvel({ x: rand(-1, 1) * (3 + 7 * k), y: rand(-1, 1) * (2 + 4 * k), z: rand(-1, 1) * (3 + 7 * k) }, true)

    part.state = PART_STATE.DETACHED
    if (part.mount) part.mount.state = MOUNT_STATE.FAILED
    part.sag = null
    part.kick.set(0, 0, 0); part.kickVel.set(0, 0, 0)
    part.loose = {
      bodyId, halfY: half.y, t: 0, landed: false, smokeIn: 0,
      q0: mesh.getWorldQuaternion(new THREE.Quaternion()),
      off: mesh.getWorldPosition(new THREE.Vector3()).sub(center),
    }
    this._loose.push(part)
    this._rebuild(view)
    this._host.onDetach(view.robot.id, mesh, part)

    // The break happens AT THE MOUNT: a snap of sparks and fragments from the
    // joint, and the torn mounting point is left behind on the parent.
    const at = anchor || center
    this._fx.flash(at, { size: 0.7, color: 0xfff0c8, life: 0.09 })
    this._fx.sparks(at, UP, { count: 16, speed: 12, spread: 1, color: 0xffd27a, life: 0.4 })
    this._fx.debris(at, dir, { count: 5, speed: 6, size: 0.12, life: 1.3 })
    if (part.mount) {
      const pm = part.mount.parent
      if (pm.state !== PART_STATE.DETACHED) {
        const out = new THREE.Vector3().copy(part.mount.outParent).applyQuaternion(pm.mesh.getWorldQuaternion(_q2)).normalize()
        this._mark(view, pm, pm.mesh.localToWorld(new THREE.Vector3().copy(part.mount.aParent)), out, 'torn', 0.85)
      }
    }
    this._host.onEvent('part_break', { robotId: view.robot.id, part, pos: at })
    return true
  }

  // ── Self-inflicted motion ───────────────────────────────────────────────────
  // Weapon recoil: the weapon part snaps back along `dir` (unit, world).
  recoil(robotId, mesh, dir, amount) {
    const view = this._views.get(robotId)
    const part = view?.parts.find(p => p.mesh === mesh)
    if (part && part.state !== PART_STATE.DETACHED) part.kickVel.addScaledVector(dir, amount * 4)
    if (view) { view.tilt.vx += dir.z * amount * 0.35; view.tilt.vz += -dir.x * amount * 0.35 }
  }

  // Whole-chassis lunge (melee strike) along `dir`.
  lunge(robotId, dir, amount) {
    const view = this._views.get(robotId)
    if (!view || view.dead) return
    view.pushVel.addScaledVector(dir, amount * 9)
    view.tilt.vx += dir.z * amount * 0.9; view.tilt.vz += -dir.x * amount * 0.9
  }

  // World position of where a robot's damage shows most (for state emitters).
  worstPoint(robotId, out = new THREE.Vector3()) {
    const view = this._views.get(robotId)
    if (!view) return null
    const p = this._worst(view)
    return p ? this._emitPoint(p, out) : null
  }

  _worst(view) {
    let best = null, bf = -1
    for (const p of view.parts) {
      if (p.state === PART_STATE.DETACHED) continue
      const f = p.damage / p.cap + (p.last ? 0.001 : 0)
      if (f > bf) { bf = f; best = p }
    }
    return best
  }

  _emitPoint(part, out) {
    return part.mesh.localToWorld(out.copy(part.last || part.top))
  }

  // ── Robot destroyed (the combat state already says so) ─────────────────────
  destroyed(robotId, dir) {
    const view = this._views.get(robotId)
    if (!view || view.dead) return
    const d = dir && dir.lengthSq() > 1e-6 ? dir.clone().setY(0).normalize() : new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize()
    // The final blow only finishes mounts that were ALREADY critical; every other
    // part stays on the wreck. Outermost first (a part goes before its carrier).
    const depth = (p, seen = new Set()) => { let n = 0; for (const c of p.children) if (!seen.has(c)) { seen.add(c); const cp = view.byId.get(c); if (cp) n = Math.max(n, 1 + depth(cp, seen)) } return n }
    const queue = view.parts.filter(p => !p.isRoot && p.state !== PART_STATE.DETACHED && p.mount?.state === MOUNT_STATE.CRITICAL && this._canFail(view, p))
      .sort((a, b) => depth(a) - depth(b))
    view.dead = { t: 0, next: 0.1, queue, pops: [0.28, 0.6, 1.05], dir: d, emberFor: 6 }
    // The machine gives out: it slumps over and drops on its suspension.
    view.tilt.rx = d.z * rand(0.07, 0.12); view.tilt.rz = -d.x * rand(0.07, 0.12)
    view.tilt.vx += d.z * 2.2; view.tilt.vz += -d.x * 2.2
    view.dip.rest = -0.1; view.dip.v -= 2.5
    const root = view.parts.find(p => p.isRoot) || view.parts[0]
    const at = this._emitPoint(this._worst(view) || root, new THREE.Vector3())
    this._fx.flash(at, { size: 1.0, color: 0xffd9a0, life: 0.1 })
    this._fx.sparks(at, UP, { count: 30, speed: 16, spread: 1.1, color: 0xffc46a, life: 0.5 })
    this._fx.debris(at, d, { count: 9, speed: 9, size: 0.17, life: 1.5 })
    this._fx.smoke(at, { size: 0.9, rise: 2.4, life: 1.5, color: 0x70747b, opacity: 0.5 })
  }

  // ── Per-frame (called AFTER CombatManager placed the meshes) ───────────────
  step(dt) {
    this._t += dt
    for (const view of this._views.values()) this._stepView(view, dt)
    this._stepLoose(dt)
  }

  _stepView(view, dt) {
    const robot = view.robot
    const body = physicsManager.getBody(robot.bodyId)
    const actor = this._host.getActor(robot.id)
    if (!body || !actor) return
    const P = body.translation()

    // Stagger (existing stability state) reads as the chassis wobbling.
    if (actor.staggered && !view.dead) {
      view.tilt.vx += Math.sin(this._t * 11) * 9 * dt
      view.tilt.vz += Math.cos(this._t * 8.3) * 9 * dt
    }

    // Springs.
    const t = view.tilt
    t.vx += (-TUNE.tiltK * (t.x - t.rx) - TUNE.tiltC * t.vx) * dt; t.x = clamp(t.x + t.vx * dt, -TUNE.tiltMax, TUNE.tiltMax)
    t.vz += (-TUNE.tiltK * (t.z - t.rz) - TUNE.tiltC * t.vz) * dt; t.z = clamp(t.z + t.vz * dt, -TUNE.tiltMax, TUNE.tiltMax)
    const dp = view.dip
    dp.v += (-TUNE.dipK * (dp.y - dp.rest) - TUNE.dipC * dp.v) * dt; dp.y = clamp(dp.y + dp.v * dt, -TUNE.dipMax, TUNE.dipMax * 0.5)
    view.pushVel.addScaledVector(view.push, -TUNE.pushK * dt).multiplyScalar(Math.max(0, 1 - TUNE.pushC * dt))
    view.push.addScaledVector(view.pushVel, dt).clampLength(0, TUNE.pushMax)

    const moving = Math.abs(t.x) > 1e-4 || Math.abs(t.z) > 1e-4 || Math.abs(dp.y) > 1e-4 || view.push.lengthSq() > 1e-6
    if (moving) _q.setFromEuler(_e.set(t.x, 0, t.z, 'XYZ'))

    for (const p of view.parts) {
      if (p.state === PART_STATE.DETACHED) continue
      const mesh = p.mesh
      if (moving) {
        // Rock about the point under the robot on the floor, then slide/dip.
        mesh.position.set(mesh.position.x - P.x, mesh.position.y, mesh.position.z - P.z).applyQuaternion(_q)
        mesh.position.x += P.x + view.push.x; mesh.position.y += dp.y; mesh.position.z += P.z + view.push.z
        mesh.quaternion.premultiply(_q)
      }
      // Per-part jolt.
      if (p.kickVel.lengthSq() > 1e-6 || p.kick.lengthSq() > 1e-8) {
        const loose = p.mount?.state >= MOUNT_STATE.CRITICAL ? 0.4 : p.mount?.state === MOUNT_STATE.WEAKENED ? 0.7 : 1   // failing mounts rattle
        p.kickVel.addScaledVector(p.kick, -TUNE.kickK * loose * dt).multiplyScalar(Math.max(0, 1 - TUNE.kickC * loose * dt))
        p.kick.addScaledVector(p.kickVel, dt).clampLength(0, TUNE.kickMax)
        mesh.position.add(p.kick)
      }
      if (p.sag) mesh.quaternion.multiply(p.sag)
      this._stepGlow(p, dt)
    }

    // Failing mounts show it: arcing at the joint, more as they get worse.
    for (const p of view.parts) {
      const m = p.mount
      if (!m || p.state === PART_STATE.DETACHED || m.state < MOUNT_STATE.WEAKENED) continue
      m.sparkIn -= dt
      if (m.sparkIn > 0) continue
      const crit = m.state === MOUNT_STATE.CRITICAL
      m.sparkIn = crit ? rand(0.35, 0.9) : rand(1.5, 2.8)
      p.mesh.localToWorld(_v.copy(m.aChild))
      this._fx.sparks(_v, UP, { count: crit ? 6 : 4, speed: 6, spread: 1.2, color: 0xa8d8ff, life: 0.18, size: 0.05 })
      if (crit) {
        this._fx.flash(_v, { size: 0.2, color: 0xbfe4ff, life: 0.05 })
        if (Math.random() < 0.5) this._fx.smoke(_v, { size: 0.2, rise: 1.6, life: 0.7, color: 0x9a9ea6, opacity: 0.25, grow: 1.8 })
        if (!view.dead) this._host.onEvent('zap', { robotId: robot.id, pos: _v })
      }
    }

    if (view.dead) { this._stepDeath(view, dt); return }

    // ── Damage shown from the REAL combat state ──
    const coreFrac = actor.coreMax ? actor.core / actor.coreMax : 1
    const exposed = actor.armor <= 0
    if (coreFrac < 0.6) {
      view.smokeIn -= dt
      if (view.smokeIn <= 0) {
        const heavy = coreFrac < 0.3
        view.smokeIn = heavy ? 0.13 : 0.42
        const w = this._worst(view)
        if (w) this._fx.smoke(this._emitPoint(w, _v), heavy
          ? { size: 0.55, rise: 2.6, life: 1.3, color: 0x6e7279, opacity: 0.46 }
          : { size: 0.36, rise: 2, life: 1, color: 0x9a9ea6, opacity: 0.3 })
      }
    }
    if (exposed) {
      view.sparkIn -= dt
      if (view.sparkIn <= 0) {
        view.sparkIn = rand(1.1, 2.6) * (coreFrac < 0.3 ? 0.45 : 1)
        const hurt = view.parts.filter(p => p.state !== PART_STATE.DETACHED && p.last)
        const p = hurt.length ? hurt[Math.floor(Math.random() * hurt.length)] : null
        if (p) {
          this._emitPoint(p, _v)
          this._fx.sparks(_v, UP, { count: 6, speed: 7, spread: 1.2, color: 0xa8d8ff, life: 0.18, size: 0.055 })
          this._fx.flash(_v, { size: 0.22, color: 0xbfe4ff, life: 0.05 })
          this._host.onEvent('zap', { robotId: robot.id, pos: _v })
        }
      }
    }
    // Overheat (existing heat state): the weapons cook.
    if (actor.overheated) {
      view.heatIn -= dt
      if (view.heatIn <= 0) {
        view.heatIn = 0.22
        for (const p of view.parts) {
          if (!p.isWeapon || p.state === PART_STATE.DETACHED) continue
          this._fx.smoke(p.mesh.localToWorld(_v.copy(p.top)), { size: 0.22, rise: 2.6, life: 0.7, color: 0x9a9da3, opacity: 0.22, grow: 1.6 })
          p.glow = Math.min(0.7, p.glow + 0.25); p.glowColor.setHex(0xff5a14)
        }
      }
    }
  }

  // Localized emissive glow on ONE part (heat / white-hot impact), decaying.
  _stepGlow(p, dt) {
    if (p.glow <= 0 && !p._glowing) return
    if (!p.mats) {
      p.mats = []
      const seen = new Set()
      for (const m of p.meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (mat?.emissive && !seen.has(mat)) { seen.add(mat); p.mats.push({ m: mat, hex: mat.emissive.getHex(), i: mat.emissiveIntensity ?? 1 }) }
      }
    }
    p.glow = Math.max(0, p.glow - dt * 2.2)
    for (const r of p.mats) {
      r.m.emissive.setHex(r.hex).lerp(p.glowColor, Math.min(1, p.glow) * 0.7)
      r.m.emissiveIntensity = r.i + p.glow * 0.5
    }
    p._glowing = p.glow > 0
  }

  _stepDeath(view, dt) {
    const d = view.dead
    d.t += dt
    const root = view.parts.find(p => p.isRoot) || view.parts[0]
    // Parts shake loose one after another.
    if (d.queue.length && d.t >= d.next) {
      d.next += rand(0.1, 0.18)
      const p = d.queue.shift()
      if (p.state !== PART_STATE.DETACHED) {
        const out = p.mesh.getWorldPosition(_v2).sub(root.mesh.getWorldPosition(_v)).setY(0)
        if (out.lengthSq() < 0.04) out.set(rand(-1, 1), 0, rand(-1, 1))
        out.normalize().addScaledVector(d.dir, 0.6).normalize()
        this._detach(view, p, out, 0.55, p.mesh.localToWorld(new THREE.Vector3().copy(p.mount.aChild)))
      }
    }
    // Secondary failures inside the hull.
    if (d.pops.length && d.t >= d.pops[0]) {
      d.pops.shift()
      const p = view.parts.filter(x => x.state !== PART_STATE.DETACHED)
      const at = this._emitPoint(p[Math.floor(Math.random() * p.length)] || root, _v)
      this._fx.flash(at, { size: 0.7, color: 0xffb060, life: 0.09 })
      this._fx.sparks(at, UP, { count: 12, speed: 11, spread: 1, color: 0xffb648, life: 0.35 })
      this._fx.debris(at, UP, { count: 3, speed: 5, size: 0.12, life: 1.1 })
      this._host.onEvent('pop', { robotId: view.robot.id, pos: at })
    }
    // The wreck burns down: thick smoke + embers at first, a thin column later.
    view.smokeIn -= dt
    if (view.smokeIn <= 0) {
      const hot = d.t < d.emberFor
      view.smokeIn = hot ? 0.15 : 0.45
      const at = this._emitPoint(this._worst(view) || root, _v)
      this._fx.smoke(at, hot
        ? { size: 0.65, rise: 3, life: 1.6, color: 0x5c6067, opacity: 0.5 }
        : { size: 0.42, rise: 2, life: 1.3, color: 0x8a8e96, opacity: 0.28 })
      if (hot) {
        // A small flickering fire inside the hull, with rising embers.
        const k = 1 - d.t / d.emberFor
        this._fx.flash(at, { size: 0.28 + 0.3 * k * Math.random(), color: 0xff7a1f, life: 0.16 })
        this._fx.sparks(at, UP, { count: 2, speed: 3.5, spread: 0.8, color: 0xff7a22, life: 0.7, size: 0.05, grav: -0.12, drag: 1.2 })
      }
    }
  }

  // Loose parts follow their own rigid bodies (real arena physics).
  _stepLoose(dt) {
    for (const p of this._loose) {
      const L = p.loose
      const body = physicsManager.getBody(L.bodyId)
      if (!body) continue
      const bp = body.translation(), br = body.rotation()
      if (!Number.isFinite(bp.x + bp.y + bp.z)) continue
      _q2.set(br.x, br.y, br.z, br.w)
      p.mesh.position.copy(_v.copy(L.off).applyQuaternion(_q2)).add(bp)
      p.mesh.quaternion.copy(_q2).multiply(L.q0)
      L.t += dt
      if (L.t < 1.6) {                                       // trails a little smoke as it flies
        L.smokeIn -= dt
        if (L.smokeIn <= 0) { L.smokeIn = 0.09; this._fx.smoke(_v.set(bp.x, bp.y, bp.z), { size: 0.24, rise: 0.8, life: 0.55, color: 0x8a8e96, opacity: 0.3, grow: 1.6 }) }
      }
      if (!L.landed && L.t > 0.12 && bp.y <= L.halfY + 0.45) {
        L.landed = true
        _v.set(bp.x, 0.1, bp.z)
        this._fx.sparks(_v, UP, { count: 7, speed: 6, spread: 1.1, color: 0xffc46a, life: 0.22 })
        this._fx.smoke(_v, { size: 0.45, rise: 0.6, life: 0.6, color: 0x6b6f76, opacity: 0.22 })
        this._host.onEvent('clank', { pos: _v })
      }
      this._stepGlow(p, dt)
    }
  }

  // Debug / test snapshot.
  snapshot(robotId) {
    const view = this._views.get(robotId)
    if (!view) return null
    return {
      dead: !!view.dead, decals: view.decals.length,
      tilt: Math.hypot(view.tilt.x, view.tilt.z),
      parts: view.parts.map(p => ({
        id: p.id, isRoot: p.isRoot, isWeapon: p.isWeapon, state: p.state, damage: +p.damage.toFixed(1), cap: +p.cap.toFixed(1),
        wear: p.wear.map(w => w.level),
        mount: p.mount ? { state: p.mount.state, damage: +p.mount.damage.toFixed(1), cap: +p.mount.cap.toFixed(1), parent: p.mount.parent.id, anchor: p.state === PART_STATE.DETACHED ? null : p.mesh.localToWorld(new THREE.Vector3().copy(p.mount.aChild)).toArray() } : null,
      })),
      marks: view.decals.map(d => { d.updateWorldMatrix(true, false); const e = d.matrixWorld.elements; const n = new THREE.Vector3(e[8], e[9], e[10]).normalize(); return { type: d.userData.markType, pos: [e[12], e[13], e[14]], normal: n.toArray(), host: d.parent?.userData.id ?? null } }),
    }
  }

  get looseCount() { return this._loose.length }

  clear() {
    for (const view of this._views.values()) {
      for (const d of view.decals) this._fx.releaseDecal(d)
      for (const p of view.parts) if (p.mats) for (const r of p.mats) { r.m.emissive.setHex(r.hex); r.m.emissiveIntensity = r.i }
    }
    for (const p of this._loose) physicsManager.removeBody(p.loose.bodyId)
    this._views.clear()
    this._loose = []
    this._host = null
    this._t = 0
  }
}
