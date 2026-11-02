import * as THREE from 'three'
import { expandByRobust } from '../../utils/robustBounds.js'
import { physicsManager } from '../physics/PhysicsManager.js'
import { raycastFirst, prepareSurfaceRaycast } from '../../utils/surfaceRaycast.js'
import { useRigidStore } from '../../stores/rigidStore.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { isWeaponType } from '../../combat/weaponRegistry.js'

// ─────────────────────────────────────────────────────────────────────────────
// RobotDamageView — the COMPONENT model of every robot in a match: which parts
// it is made of, how they hang on each other, how damaged each one and each mount
// is, and how that looks and moves. It is the single authority for component
// identity + structural state; the renderer (marks, sag, glow), the weapons
// (WeaponManager asks partHealth / resolve) and the drive (CombatManager asks
// driveState) all read THIS, never a copy.
//
// Robot-level health (armor / core / stagger / overheat / destroyed) stays owned
// by DamageManager. A component being wrecked does NOT zero the robot.
//
// Component identity = the scene object id (the Robot-Builder part: one logical
// component even when its model has many meshes; motor-riding wheels belong to
// their motor's drive unit). Attachments = the saved bonds (+ surface contact
// frames). Optional author metadata on a scene object: `breakable: false` keeps
// a part from ever detaching (old files: everything except the root may break).
//
//   resolve()   – the exact component a SHOT meets along its real path (before any
//                 damage is applied) → part, point, normal; null = the shot passed
//                 the robot's collision box without touching its geometry
//   locate()    – which real part of the robot a hit landed on (raycast against
//                 the robot's actual Robot-Builder meshes → part, point, normal)
//   hit()       – an impact mark exactly where the hit landed, per-part damage
//                 bookkeeping (the REAL damage dealt), part jolt, chassis rock,
//                 and STRUCTURAL damage to the mounts near the hit
//   step()      – damped-spring reactions applied on top of the physics pose,
//                 smoke/sparks driven by the real armor/core state, loose parts
//                 following their own Rapier bodies, the destruction sequence
//
// Damage kinds: a hit wears the struck PART (integrity → DAMAGED → SEVERE →
// WRECKED: still attached but dead — a wrecked gun can't fire, a wrecked drive
// unit doesn't drive), loads its MOUNT (structure, below), and reaches the
// robot's armor/core only through what the part lets past (shieldFor: an intact
// armour plate soaks most of a hit, a weapon or drive unit takes it itself,
// electronics pass armour damage straight to the core). Blasts load every part
// in their radius once, by distance (blast). Wear shows on the part's own
// materials (scorch tint, rougher), plus smoke / arcing / glowing breaches.
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
  // Mount strength = share of the robot's STRUCTURE budget (CombatStats
  // structureMax — the unscaled HP, so match pacing never makes parts immortal)
  // its mount can take. Focused fire on a gun's base tears it off in a few
  // seconds; the same rounds spread over the robot never do.
  weaponMount: 0.42, partMountMin: 0.14, partMountMax: 0.34,
  mountAt: [0.25, 0.5, 0.78, 1],   // DAMAGED / WEAKENED / CRITICAL / FAILED (fraction of mount strength)
  mountNear: 0.25,           // su — a hit this close to the mount goes straight into it
  mountReach: 0.7,           // su — beyond this only the shock reaches the mount…
  mountFar: 0.3,             // …this share of the hit (the part levers on its bracket)
  mountRadius: 0.9,          // su — hits on the PARENT this close to a mount strain it
  partCapMin: 0.45, partCapMax: 0.9,   // part integrity (share of the structure budget)
  damagedAt: 0.3, severeAt: 0.65, // part integrity used: ≥ 1 = WRECKED (no function, still attached)
  wreckedStrain: 1.5,        // a wrecked part's mount takes this much more of every hit
  // How hard each impact kind loads STRUCTURE (mounts) per point of damage.
  strainByKind: { kinetic: 1, pellet: 0.85, blast: 1.5, blunt: 1.4, collision: 1.1, heat: 0.3 },
  blastShare: 0.18,          // a blast loads every OTHER part in its radius by this × falloff²
  // Share of a hit's ROBOT damage (armor/core) an intact component soaks itself
  // — armour plates protect what's behind them until they're shot through; a
  // hit on a weapon / drive unit mostly wrecks that unit. Electronics are the
  // robot's critical systems: they soak nothing and pass half the armour
  // damage straight to the core.
  shield: { armor: 0.6, weapon: 0.5, drive: 0.4, electronics: 0, chassis: 0, part: 0 },
  electronicsToCore: 0.5,
  tintSoot: 0x231f1c, tintMax: 0.55, tintRough: 0.35,   // progressive scorch / wear on a part's own materials
  looseMax: 36,              // live debris bodies; past this the oldest SETTLED piece is frozen in place
  settleSpeed: 0.25, settleTime: 1,                     // su/s, s — a resting piece goes to sleep
  maxDecals: 48,             // impact marks per robot (oldest are recycled)
  clusterRadius: 0.75,       // su — hits this close together wear the surface down
  tiltK: 170, tiltC: 13, tiltMax: 0.13,     // chassis rock spring (rad)
  dipK: 220, dipC: 16, dipMax: 0.22,        // suspension dip (su)
  pushK: 120, pushC: 15, pushMax: 0.9,      // lunge / recoil slide (su)
  kickK: 300, kickC: 20, kickMax: 0.35,     // per-part jolt (su)
}

// Component roles (from the part's type, never its index or mesh names) and how
// much of a hit each one's structure takes. Deterministic.
const ELECTRONICS = /^(arduino|subo|led|oled|buzzer|ldr|dht11|ultrasonic|ir_sensor|gas_sensor|color_sensor|servo)$/
const DRIVE = /^(motor|motor_bo|motor_dc)$/
const ROLE_TOUGHNESS = { chassis: 0.85, armor: 0.8, drive: 1.0, weapon: 1.1, electronics: 1.25, part: 1.0 }
// Functional health by component state / mount state (1 = full function).
const STATE_HEALTH = [1, 0.85, 0.6, 0]
const MOUNT_HEALTH = [1, 1, 0.9, 0.7, 0]
// Deterministic 0..1 from a string (stable per component — no per-hit dice).
const hash01 = (str, salt = 0) => { let h = 2166136261 ^ salt; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) } return ((h >>> 0) % 10000) / 10000 }

const UP = new THREE.Vector3(0, 1, 0)
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _e = new THREE.Euler()
const _box = new THREE.Box3()
const _rc = new THREE.Raycaster()
const _nm = new THREE.Matrix3()
const _c = new THREE.Color()
const rand = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export class RobotDamageView {
  constructor(fx) {
    this._fx = fx
    this._views = new Map()      // robotId → view
    this._loose = []             // detached parts (own physics bodies)
    this._orig = new Map()       // material → its original look (wear tint / glow are undone from this)
    this._host = null
    this._t = 0
  }

  // host: { getActor(id), onDetach(robotId, mesh, part), onEvent(name, data) }
  // (events: part_break · part_wrecked · zap · pop · clank)
  bind(robots, host) {
    this._host = host
    const objs = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
    const bonds = useRigidStore.getState().getBonds()
    for (const robot of robots) {
      const actor = host.getActor(robot.id)
      const totalHp = robot.stats?.structureMax ?? ((actor?.armorMax ?? 100) + (actor?.coreMax ?? 100))
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
        _box.makeEmpty(); expandByRobust(_box, mesh)
        if (_box.isEmpty()) _box.setFromObject(mesh)
        const size = _box.getSize(new THREE.Vector3())
        const vol = Math.max(0.05, size.x * size.y * size.z)
        volSum += vol
        const obj = objs.get(id)
        const type = obj?.type || ''
        const isWeapon = isWeaponType(type)
        // A drive unit: a motor (its wheel rides its rotor, so hitting the wheel
        // hits the unit), else a part the author named as a wheel/track.
        const carriesWheel = mesh.userData.rotorGroup?.children?.length > 0
        const role = id === robot.id ? 'chassis' : isWeapon ? 'weapon' : (DRIVE.test(type) || carriesWheel) ? 'drive'
          : ELECTRONICS.test(type) ? 'electronics' : /wheel|tyre|tire|track/i.test(obj?.name || '') ? 'drive' : 'armor'
        parts.push({
          mesh, id, meshes, vol, type, role,
          toughness: ROLE_TOUGHNESS[role] ?? 1,
          breakable: obj?.breakable !== false,
          side: Math.sign(Math.round((mv.off?.x ?? 0) * 10) / 10),   // robot frame: +x = left of the nose
          mass: 0,
          isRoot: id === robot.id,
          isWeapon,
          children: new Set(bonds.filter(b => b.parentId === id && ids.has(b.childId)).map(b => b.childId)),
          top: mesh.worldToLocal(new THREE.Vector3(_box.min.x + size.x / 2, _box.max.y, _box.min.z + size.z / 2)),
          damage: 0, cap: 1, state: PART_STATE.HEALTHY,
          wrecked: false,                   // integrity used up: still attached, no longer works
          tint: 0,                          // scorch / wear shown on its own materials (0..1)
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
        // Mass share: a part weighs its volume share of the robot (bounded), so
        // what it takes away when it breaks off — and how it flies — follow its size.
        p.mass = Math.max(0.03, (robot.mass || 1) * clamp(p.vol / volSum, 0.01, 0.6))
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
    // The part's own structure takes the hit scaled by its role's toughness
    // (a sensor board is more fragile than a chassis plate) — deterministic.
    const pd = (info.dealt || 0) * (part.toughness || 1)
    part.damage += pd
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

    // Part wear (how beaten-up the part itself looks, and whether it still works).
    const { changed, wrecked } = this._condition(view, part, point, normal)

    // Structure: the hit strains this part's own mount (more the closer it landed
    // to it) and any mount on this part that sits right next to the impact. How
    // much a point of damage loads structure depends on the impact kind (a blast
    // or a blow wrenches brackets; flame barely does).
    const mounts = []
    const load = pd * (TUNE.strainByKind[info.kind] ?? 1)
    if (load > 0 && info.surface !== false) {
      if (part.mount) this._strain(view, part, load * this._transfer(part, point) * (part.wrecked ? TUNE.wreckedStrain : 1), info, mounts)
      for (const cid of part.children) {
        const c = view.byId.get(cid)
        if (!c?.mount || c.mount.parent !== part || c.state === PART_STATE.DETACHED) continue
        const d = part.mesh.localToWorld(_v.copy(c.mount.aParent)).distanceTo(point)
        if (d < TUNE.mountRadius) this._strain(view, c, load * (1 - d / TUNE.mountRadius), info, mounts)
      }
    }
    return { state: part.state, changed, wrecked, detached: part.state === PART_STATE.DETACHED, mounts }
  }

  // Integrity → state (HEALTHY → DAMAGED → SEVERE), WRECKED once it is used up
  // (the part hangs on but no longer works), and the scorch / wear on its own
  // materials. Deterministic thresholds; states only ever get worse.
  _condition(view, part, point, normal) {
    const f = part.damage / part.cap
    const next = f >= TUNE.severeAt ? PART_STATE.SEVERE : f >= TUNE.damagedAt ? PART_STATE.DAMAGED : PART_STATE.HEALTHY
    const changed = next > part.state
    if (changed) {
      part.state = next
      if (next === PART_STATE.SEVERE) this._mark(view, part, point, normal, 'hot', 0.4)   // exposed, glowing damage
    }
    let wrecked = false
    if (!part.wrecked && !part.isRoot && f >= 1) {
      part.wrecked = wrecked = true
      // The unit dies where it was hit: a burst of sparks, a glowing breach,
      // and from now on it smokes (step) and does nothing (partHealth = 0).
      this._fx.flash(point, { size: 0.6, color: 0xffd9a0, life: 0.08 })
      this._fx.sparks(point, normal, { count: 18, speed: 11, spread: 1.1, color: 0xffc46a, life: 0.35 })
      this._fx.debris(point, normal, { count: 3, speed: 5, size: 0.1, life: 1 })
      this._mark(view, part, point, normal, 'hot', 0.55)
      this._host.onEvent('part_wrecked', { robotId: view.robot.id, part, pos: point })
    }
    this._setTint(part, part.wrecked ? 1 : Math.min(1, f))
    return { changed, wrecked }
  }

  // Scorch / wear on the part's OWN materials (colour toward soot, rougher),
  // proportional to how much of its integrity is gone. Restored by clear().
  _setTint(part, k) {
    if (k - part.tint < 0.02) return
    part.tint = k
    const soot = _c.setHex(TUNE.tintSoot)
    for (const r of this._partMats(part)) {
      if (r.col != null) r.m.color.setHex(r.col).lerp(soot, k * TUNE.tintMax)
      if (r.rough != null) r.m.roughness = r.rough + (1 - r.rough) * k * TUNE.tintRough
    }
  }

  // The materials one part draws with — each recorded ONCE with its original
  // values (a material shared between parts is restored exactly).
  _partMats(p) {
    if (p.mats) return p.mats
    p.mats = []
    const seen = new Set()
    for (const m of p.meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat || seen.has(mat)) continue
      seen.add(mat)
      let r = this._orig.get(mat)
      if (!r) {
        r = { m: mat, hex: mat.emissive ? mat.emissive.getHex() : null, i: mat.emissiveIntensity ?? 1, col: mat.color ? mat.color.getHex() : null, rough: typeof mat.roughness === 'number' ? mat.roughness : null }
        this._orig.set(mat, r)
      }
      p.mats.push(r)
    }
    return p.mats
  }

  // How a hit on this component reaches the robot's armor / core — read BEFORE
  // the damage is applied (WeaponManager). { mul, toCore }: mul = share of the
  // robot damage that gets past the component (an intact armour plate soaks
  // most of it; a shot-through one nothing), toCore = share of the armour
  // damage that goes straight to the core (critical electronics).
  shieldFor(robotId, partId) {
    const p = this._views.get(robotId)?.byId.get(partId)
    if (!p || p.state === PART_STATE.DETACHED) return { mul: 1, toCore: 0 }
    const integrity = p.wrecked ? 0 : 1 - clamp(p.damage / p.cap, 0, 1)
    return { mul: 1 - (TUNE.shield[p.role] ?? 0) * integrity, toCore: p.role === 'electronics' ? TUNE.electronicsToCore : 0 }
  }

  // A blast centred at `pos` (radius `radius`) loads every OTHER attached part of
  // this robot by its distance — once per part per explosion (`skip` = the part
  // that took the direct hit). `impact` = the blast's damage at this robot.
  // Returns the mount transitions it caused.
  blast(robotId, pos, radius, impact, info, skip = null) {
    const view = this._views.get(robotId)
    const events = []
    if (!view || view.dead || !(impact > 0) || !(radius > 0)) return events
    const c = new THREE.Vector3()
    for (const p of [...view.parts]) {
      if (p === skip || p.state === PART_STATE.DETACHED) continue
      p.mesh.getWorldPosition(c)
      const fall = 1 - Math.max(0, c.distanceTo(pos) - p.size.length() * 0.5) / radius
      if (fall <= 0) continue
      const amount = impact * TUNE.blastShare * fall * fall       // the parts nearest the blast take most of it
      const dir = new THREE.Vector3().subVectors(c, pos)
      if (dir.lengthSq() < 1e-6) dir.copy(info.dir)
      dir.normalize()
      p.damage += amount * p.toughness
      this._condition(view, p, c, _v2.copy(dir).negate())
      if (p.mount) this._strain(view, p, amount * TUNE.strainByKind.blast * (p.wrecked ? TUNE.wreckedStrain : 1) * 0.5, { ...info, dir, force: Math.max(0.4, fall) }, events)
    }
    return events
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
      const h = (k) => hash01(part.id, k) * 2 - 1
      part.sag = new THREE.Quaternion().setFromEuler(_e.set(0.035 * h(1), 0.02 * h(2), 0.045 * h(3)))
      this._fx.sparks(anchor, out, { count: 7, speed: 7, spread: 1.1, color: 0xa8d8ff, life: 0.2, size: 0.05 })
    } else if (next === MOUNT_STATE.CRITICAL) {
      // Barely holding: the part hangs visibly off true and the joint is exposed.
      const h = (k) => hash01(part.id, k)
      part.sag = new THREE.Quaternion().setFromEuler(_e.set((0.06 + 0.05 * h(4)) * (h(5) < 0.5 ? -1 : 1), 0.05 * (h(6) * 2 - 1), (0.08 + 0.06 * h(7)) * (h(8) < 0.5 ? -1 : 1)))
      this._fx.flash(anchor, { size: 0.35, color: 0xbfe4ff, life: 0.06 })
      this._fx.sparks(anchor, out, { count: 12, speed: 9, spread: 1.1, color: 0xa8d8ff, life: 0.25, size: 0.05 })
      this._fx.debris(anchor, out, { count: 2, speed: 4, size: 0.08, life: 0.9, up: 3 })
      this._mark(view, m.parent, anchor, out, 'hot', 0.55)
      m.sparkIn = 0.3
    }
    events.push({ part, state: next, failed: next === MOUNT_STATE.FAILED })
  }

  _canFail(view, part) {
    if (part.isRoot || !part.breakable) return false
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
    _box.makeEmpty(); expandByRobust(_box, mesh)   // same robust bounds as the robot body
    if (_box.isEmpty()) return false
    const center = _box.getCenter(new THREE.Vector3())
    const half = _box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
    const bodyId = 'arena_part_' + part.id
    const body = physicsManager.createDebrisBody(
      bodyId, { x: center.x, y: Math.max(center.y, half.y + 0.05), z: center.z },
      { x: Math.max(0.12, half.x), y: Math.max(0.12, half.y), z: Math.max(0.12, half.z) },
      part.mass || 0.35,
    )
    if (!body) return false                                      // no physics → it stays on (never fake it)
    // It leaves with the robot's motion at that point (linear + the yaw spin's
    // tangential speed), plus the impulse of the impact that broke it — a bounded
    // impulse, so a light board flies further than a heavy wheel assembly. (The
    // arena runs scene-unit gravity, ~196 su/s², so a hop needs real upward speed.)
    const rb = physicsManager.getBody(view.robot.bodyId)
    const rv = rb ? rb.linvel() : { x: 0, y: 0, z: 0 }
    const rw = rb ? rb.angvel() : { x: 0, y: 0, z: 0 }
    const rc = rb ? rb.translation() : center
    const rx = center.x - rc.x, rz = center.z - rc.z
    const k = clamp(force, 0.15, 1)
    const light = clamp(Math.sqrt(0.35 / Math.max(0.03, part.mass || 0.35)), 0.45, 1.8)   // ∝ 1/√m (bounded)
    const speed = (4 + 12 * k) * light
    const up = (8 + 13 * k) * Math.sqrt(light)
    body.setLinvel({ x: rv.x + rw.y * rz + dir.x * speed, y: Math.max(0, rv.y) + up, z: rv.z - rw.y * rx + dir.z * speed }, true)
    // Tumble about the axis the impact pushes it over (dir × up), deterministic.
    const spin = clamp((3 + 7 * k) * light, 1.5, 14)
    const axis = new THREE.Vector3().crossVectors(UP, dir).normalize()
    body.setAngvel({ x: axis.x * spin, y: rw.y + spin * 0.3 * (hash01(part.id, 9) * 2 - 1), z: axis.z * spin }, true)

    part.state = PART_STATE.DETACHED
    if (part.mount) part.mount.state = MOUNT_STATE.FAILED
    part.sag = null
    part.kick.set(0, 0, 0); part.kickVel.set(0, 0, 0)
    part.loose = {
      bodyId, halfY: half.y, t: 0, landed: false, smokeIn: 0, still: 0, settled: false, frozen: false,
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

  // ── Shot resolution (BEFORE damage) ─────────────────────────────────────────
  // A shot travelling `dir` (unit) entered the robot's collision box at `entry`.
  // Which component does it actually meet? Casts along the shot's own line
  // through the robot's visible, still-attached geometry (nested meshes, any
  // pose / scale). null = it passes through the box without touching anything
  // (the caller lets it fly on).
  resolve(robotId, entry, dir) {
    const view = this._views.get(robotId)
    if (!view || !view.meshes.length) return null
    const reach = (view.robot.radius || 2) * 2.4 + 2
    _rc.ray.origin.copy(entry).addScaledVector(dir, -0.6)
    _rc.ray.direction.copy(dir)
    _rc.near = 0; _rc.far = reach + 0.6
    const hit = raycastFirst(_rc, view.meshes)
    if (!hit) return null
    const normal = hit.face.normal.clone().applyMatrix3(_nm.getNormalMatrix(hit.object.matrixWorld)).normalize()
    if (normal.dot(dir) > 0) normal.negate()
    const part = view.partOf.get(hit.object)
    return part ? { part, partId: part.id, role: part.role, toughness: part.toughness, point: hit.point.clone(), normal, surface: true } : null
  }

  // Exit point of a ray through a robot (for a shot that missed its geometry):
  // past the robot's far side along `dir`.
  exitPoint(robotId, entry, dir, out = new THREE.Vector3()) {
    const view = this._views.get(robotId)
    return out.copy(entry).addScaledVector(dir, (view?.robot.radius || 2) * 2.2 + 0.5)
  }

  // ── Function from structure (read by weapons + drive) ──────────────────────
  // 0..1: how well a component still does its job (state × mount condition).
  partHealth(part) {
    if (!part || part.state === PART_STATE.DETACHED || part.wrecked) return 0
    return STATE_HEALTH[part.state] * (part.mount ? MOUNT_HEALTH[part.mount.state] : 1)
  }

  partForId(robotId, id) { return this._views.get(robotId)?.byId.get(id) ?? null }

  // What an opponent can SEE of a robot: its attached components, where they
  // are, and their visible condition (wear, sag, smoke — all shown on screen).
  visibleParts(robotId) {
    const view = this._views.get(robotId)
    if (!view) return []
    const out = []
    for (const p of view.parts) {
      if (p.state === PART_STATE.DETACHED) continue
      out.push({
        id: p.id, role: p.role, isWeapon: p.isWeapon, side: p.side, mesh: p.mesh,
        center: p.mesh.getWorldPosition(new THREE.Vector3()),
        health: this.partHealth(p), wear: Math.min(1, p.damage / p.cap),
        mountState: p.mount?.state ?? 0, breakable: p.breakable && !p.isRoot,
      })
    }
    return out
  }

  partForMesh(robotId, mesh) { return this._views.get(robotId)?.parts.find(p => p.mesh === mesh) ?? null }

  // Drivetrain from the robot's real drive units. { units, left, right, mean }:
  // left / right = mean health of the units on each side (centre units count for
  // both); units = 0 → the design has no drive components (caller falls back).
  driveState(robotId) {
    const view = this._views.get(robotId)
    if (!view) return { units: 0, left: 1, right: 1, mean: 1 }
    let n = 0, l = 0, ln = 0, r = 0, rn = 0, sum = 0
    for (const p of view.parts) {
      if (p.role !== 'drive') continue
      const h = this.partHealth(p)
      n++; sum += h
      if (p.side >= 0) { l += h; ln++ }
      if (p.side <= 0) { r += h; rn++ }
    }
    if (!n) return { units: 0, left: 1, right: 1, mean: 1 }
    return { units: n, left: ln ? l / ln : sum / n, right: rn ? r / rn : sum / n, mean: sum / n }
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
    // The final blow finishes mounts that were already WEAKENED or worse, and
    // parts already wrecked; every sound part stays on the wreck. Outermost first
    // (a part goes before its carrier).
    const depth = (p, seen = new Set()) => { let n = 0; for (const c of p.children) if (!seen.has(c)) { seen.add(c); const cp = view.byId.get(c); if (cp) n = Math.max(n, 1 + depth(cp, seen)) } return n }
    const queue = view.parts.filter(p => !p.isRoot && p.state !== PART_STATE.DETACHED && p.mount && p.breakable &&
      (p.mount.state >= MOUNT_STATE.WEAKENED || p.wrecked))
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
      // A badly damaged drive unit wobbles while the robot moves.
      if (p.role === 'drive' && this.partHealth(p) < 0.65 && !view.dead) {
        const sp = body.linvel(), v = Math.hypot(sp.x, sp.z)
        if (v > 1) mesh.quaternion.multiply(_q2.setFromEuler(_e.set(Math.sin(this._t * (6 + v)) * 0.06 * (1 - this.partHealth(p)), 0, 0)))
      }
      this._stepGlow(p, dt)
    }
    // Badly damaged parts smoulder where they were hit — wrecked ones heavily,
    // severe working units (weapons / drive) lightly, severe plates now and
    // then; damaged electronics arc. Bounded per tick.
    view.partSmokeIn = (view.partSmokeIn ?? 0.5) - dt
    if (view.partSmokeIn <= 0) {
      view.partSmokeIn = 0.35
      view.smokeTick = (view.smokeTick ?? 0) + 1
      let n = 0
      for (const p of view.parts) {
        if (p.state === PART_STATE.DETACHED || n >= 6) continue
        const working = p.role === 'weapon' || p.role === 'drive'
        if (p.wrecked) {
          n++; this._fx.smoke(this._emitPoint(p, _v), { size: 0.32, rise: 2.2, life: 1, color: 0x5f636a, opacity: 0.4, grow: 1.8 })
        } else if (p.state === PART_STATE.SEVERE && (working || view.smokeTick % 3 === 0)) {
          n++; this._fx.smoke(this._emitPoint(p, _v), { size: 0.22, rise: 1.8, life: 0.8, color: 0x7a7e85, opacity: 0.28, grow: 1.6 })
        }
        if (p.role === 'electronics' && p.state >= PART_STATE.DAMAGED && Math.random() < (p.wrecked ? 0.5 : 0.22)) {
          this._emitPoint(p, _v)
          this._fx.sparks(_v, UP, { count: 5, speed: 6, spread: 1.3, color: 0xa8d8ff, life: 0.16, size: 0.05 })
          this._fx.flash(_v, { size: 0.18, color: 0xbfe4ff, life: 0.04 })
        }
      }
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
    p.glow = Math.max(0, p.glow - dt * 2.2)
    for (const r of this._partMats(p)) {
      if (r.hex == null) continue
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
      if (p.state !== PART_STATE.DETACHED && this._canFail(view, p)) {   // its own children went first
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
      if (L.frozen) continue
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
      // Settled debris: once it has been at rest for a moment its body sleeps
      // (Rapier wakes it if something hits it again).
      if (L.landed && !L.settled) {
        const v = body.linvel(), w = body.angvel()
        if (Math.hypot(v.x, v.y, v.z) < TUNE.settleSpeed && Math.hypot(w.x, w.y, w.z) < 0.6) {
          L.still += dt
          if (L.still >= TUNE.settleTime) { L.settled = true; body.sleep?.() }
        } else L.still = 0
      }
      this._stepGlow(p, dt)
    }
    // Bounded: past looseMax live bodies, the oldest settled pieces are frozen
    // where they lie (body removed, mesh stays put — they no longer simulate).
    let live = 0
    for (const p of this._loose) if (!p.loose.frozen) live++
    for (const p of this._loose) {
      if (live <= TUNE.looseMax) break
      if (p.loose.frozen || !p.loose.settled) continue
      physicsManager.removeBody(p.loose.bodyId); p.loose.frozen = true; live--
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
        id: p.id, isRoot: p.isRoot, isWeapon: p.isWeapon, role: p.role, breakable: p.breakable, side: p.side, mass: +p.mass.toFixed(3), health: +this.partHealth(p).toFixed(3),
        state: p.state, wrecked: p.wrecked, tint: +p.tint.toFixed(2), damage: +p.damage.toFixed(1), cap: +p.cap.toFixed(1), hits: p.hits.length,
        loose: p.loose ? { settled: !!p.loose.settled, frozen: !!p.loose.frozen } : null,
        wear: p.wear.map(w => w.level),
        mount: p.mount ? { state: p.mount.state, damage: +p.mount.damage.toFixed(1), cap: +p.mount.cap.toFixed(1), parent: p.mount.parent.id, anchor: p.state === PART_STATE.DETACHED ? null : p.mesh.localToWorld(new THREE.Vector3().copy(p.mount.aChild)).toArray() } : null,
      })),
      marks: view.decals.map(d => { d.updateWorldMatrix(true, false); const e = d.matrixWorld.elements; const n = new THREE.Vector3(e[8], e[9], e[10]).normalize(); return { type: d.userData.markType, pos: [e[12], e[13], e[14]], normal: n.toArray(), host: d.parent?.userData.id ?? null } }),
    }
  }

  get looseCount() { return this._loose.length }

  clear() {
    for (const view of this._views.values()) for (const d of view.decals) this._fx.releaseDecal(d)
    // Every material back exactly as it was (wear tint, roughness, glow).
    for (const r of this._orig.values()) {
      if (r.hex != null) { r.m.emissive.setHex(r.hex); r.m.emissiveIntensity = r.i }
      if (r.col != null) r.m.color.setHex(r.col)
      if (r.rough != null) r.m.roughness = r.rough
    }
    this._orig.clear()
    for (const p of this._loose) physicsManager.removeBody(p.loose.bodyId)
    this._views.clear()
    this._loose = []
    this._host = null
    this._t = 0
  }
}
