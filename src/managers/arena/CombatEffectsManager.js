import * as THREE from 'three'
import { HitEffects } from './HitEffects.js'
import { RobotDamageView } from './RobotDamageView.js'
import { DamageNumbers } from './DamageNumbers.js'
import { arenaAudio } from './ArenaAudio.js'
import { physicsManager } from '../physics/PhysicsManager.js'
import { getWeapon } from '../../combat/weaponRegistry.js'

// ─────────────────────────────────────────────────────────────────────────────
// CombatEffectsManager — the single orchestration seam for arena combat feedback.
//
// CombatManager/WeaponManager emit high-level combat events here. Every damage
// event that DamageManager actually applied becomes ONE impact description:
//
//   { attackerId, targetId, weapon, kind, dealt, level, point, normal, dir, part }
//
// and that drives everything the player perceives — localized sparks / debris /
// scorch on the part that was hit, the part + chassis reaction, a bounded yaw
// twist from off-centre hits, audio, camera shake, part damage states and
// break-offs (RobotDamageView). Nothing here changes health or decides outcomes:
// the damage pipeline stays authoritative and this only presents it.
// ─────────────────────────────────────────────────────────────────────────────

// Impact signature per weapon — keyed by the weapon registry's existing `class`.
const CLASS_KIND = { sustained: 'kinetic', burst: 'pellet', area: 'blast', brawl: 'blunt', denial: 'heat' }

const UP = new THREE.Vector3(0, 1, 0)
const SHAKE_PER_FRAME = 0.32          // trauma budget so stacked hits never saturate the camera
const _v = new THREE.Vector3()
const _bias = new THREE.Vector3()

export class CombatEffectsManager {
  constructor() {
    this._hits = new HitEffects()
    this._damage = new RobotDamageView(this._hits)
    this._numbers = new DamageNumbers()
    this._camera = null
    this._canvas = null
    this._shake = null          // the ArenaCameraManager's CameraShake
    this._getRobot = null
    this._getActor = null
    this._playerId = null
    this._lastDir = new Map()   // targetId → last hit direction (for the death fall)
    this._shakeLeft = SHAKE_PER_FRAME
    this.lastImpact = null      // dev/test: the most recent impact description
  }

  configure({ scene, camera, canvas, shake, getRobot, getActor = null, playerId = null, robots = [], onDetach = null }) {
    this._hits.configure(scene)
    this._numbers.mount()
    this._camera = camera
    this._canvas = canvas
    this._shake = shake
    this._getRobot = getRobot
    this._getActor = getActor
    this._playerId = playerId
    if (getActor) {
      this._damage.bind(robots, {
        getActor,
        onDetach: (robotId, mesh, part) => onDetach?.(robotId, mesh, part),
        onEvent: (name, data) => this._onViewEvent(name, data),
      })
    }
    arenaAudio.resume()
    return this
  }

  _addShake(amount) {
    if (!this._shake || amount <= 0) return
    const a = Math.min(amount, this._shakeLeft)
    if (a <= 0) return
    this._shakeLeft -= a
    this._shake.add(a)
  }

  _fwd(robotId, out) {
    const body = physicsManager.getBody(this._getRobot?.(robotId)?.bodyId)
    if (!body) return null
    const r = body.rotation()
    return out.set(2 * (r.x * r.z + r.w * r.y), 0, 1 - 2 * (r.x * r.x + r.y * r.y)).normalize()
  }

  // A shot was fired. `mesh` = the weapon part that fired (null for built-in melee).
  onFire(robotId, def, isPlayer, mesh = null) {
    const cls = def?.class
    arenaAudio.play(
      cls === 'denial' ? 'fire_secondary' : cls === 'brawl' ? 'melee_swing' : cls === 'burst' ? 'fire_shotgun' : cls === 'area' ? 'fire_rocket' : 'fire_primary',
      { minGap: 0.04 })
    const fwd = this._fwd(robotId, _v)
    if (fwd) {
      if (cls === 'brawl') this._damage.lunge(robotId, fwd, 0.8)
      else if (mesh && def?.recoil) this._damage.recoil(robotId, mesh, _bias.copy(fwd).negate(), Math.min(1, 0.12 + def.recoil / 9))
      if (mesh && (cls === 'burst' || cls === 'area')) {
        // Muzzle smoke (shotgun) / back-blast (rocket).
        mesh.getWorldPosition(_bias).addScaledVector(fwd, cls === 'area' ? -1.2 : 1.4)
        this._hits.smoke(_bias, { size: 0.3, rise: 0.8, life: 0.5, color: 0x8a8d93, opacity: 0.25, grow: 2 })
      }
    }
    if (isPlayer) this._addShake(def?.recoil > 6 ? 0.16 : cls === 'denial' ? 0.015 : 0.07)
  }

  // A damage event landed on `targetId`. `result` from DamageManager, `evt` raw.
  onHit(targetId, worldPos, result, evt, { armorBreak = false, isPlayerTarget = false } = {}) {
    const fx = this._hits
    const dealt = (result?.coreDealt || 0) + (result?.armorDealt || 0)
    const def = evt?.weaponKey ? getWeapon(evt.weaponKey) : null
    const type = evt?.damageType
    const kind = type === 'collision' ? 'collision'
      : def ? (CLASS_KIND[def.class] || 'kinetic')
      : type === 'burn' ? 'burnTick'
      : type === 'explosion' ? 'blast' : 'kinetic'
    const robot = this._getRobot?.(targetId)
    const actor = this._getActor?.(targetId)
    const maxHp = (actor?.armorMax ?? 100) + (actor?.coreMax ?? 100)
    const frac = dealt / maxHp
    const level = frac < 0.02 ? 1 : frac < 0.07 ? 2 : 3
    const s = level === 1 ? 0.65 : level === 2 ? 1 : 1.45

    // Damage-over-time ticks have no impact: they just keep the damage smouldering.
    if (kind === 'burnTick') {
      if (dealt > 0) this._numbers.add(targetId, worldPos, dealt, { crit: false, kind: 'burn' })
      const at = this._damage.worstPoint(targetId, _v) || worldPos
      fx.sparks(at, UP, { count: 2, speed: 3, spread: 0.9, color: 0xff7a22, life: 0.5, size: 0.06, grav: -0.1, drag: 1.2 })
      if (Math.random() < 0.35) fx.smoke(at, { size: 0.25, rise: 1.6, life: 0.7, color: 0x8a8e96, opacity: 0.25 })
      return
    }

    // ── Where and from which direction ──
    const dir = new THREE.Vector3()
    let point = null
    const center = _v.copy(worldPos)
    if (evt?.hitDir) dir.set(evt.hitDir.x, evt.hitDir.y, evt.hitDir.z)
    if (evt?.hitPoint && (type === 'explosion' || !evt.hitDir)) {
      // Blast / undirected: push away from the source point, hit the facing side.
      dir.set(center.x - evt.hitPoint.x, (center.y - evt.hitPoint.y) * 0.5, center.z - evt.hitPoint.z)
      if (dir.lengthSq() < 1e-4) dir.set(0, -1, 0)
      dir.normalize()
      point = center.clone().addScaledVector(dir, -((robot?.radius || 2) + 0.5))
    } else if (evt?.hitPoint) {
      point = new THREE.Vector3(evt.hitPoint.x, evt.hitPoint.y, evt.hitPoint.z)
    }
    if (dir.lengthSq() < 1e-6) {
      const src = evt?.sourceId != null ? physicsManager.getBody(this._getRobot?.(evt.sourceId)?.bodyId) : null
      if (src) { const t = src.translation(); dir.set(center.x - t.x, 0, center.z - t.z) }
      if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0)
      dir.normalize()
    }
    if (!point) point = center.clone().addScaledVector(dir, -((robot?.radius || 2) + 0.5))

    // A shot already resolved to its component BEFORE damage (WeaponManager →
    // resolveShot): use exactly that part / point / normal — never re-guess.
    const pre = evt?.partId ? this._damage.partForId(targetId, evt.partId) : null
    let loc = pre && evt.hitPoint && evt.hitNormal
      ? { part: pre, point: new THREE.Vector3(evt.hitPoint.x, evt.hitPoint.y, evt.hitPoint.z), normal: new THREE.Vector3(evt.hitNormal.x, evt.hitNormal.y, evt.hitNormal.z), surface: true }
      : this._damage.locate(targetId, point, dir)
    // Contact-type hits (a blast wave, a melee blow, a ram) strike the robot's
    // near side as a whole: if the registered line passed over the hull, find
    // where that side actually is. Bullets/pellets/flame get no such help — if
    // their ray met no visible surface, they leave no mark.
    if (loc && !loc.surface && (kind === 'blast' || kind === 'blunt' || kind === 'collision') && robot) {
      const body = physicsManager.getBody(robot.bodyId)
      if (body) {
        const c = body.translation()
        const flat = new THREE.Vector3(dir.x, 0, dir.z)
        if (flat.lengthSq() > 1e-6) {
          flat.normalize()
          const near = this._damage.locate(targetId, new THREE.Vector3(c.x, c.y, c.z).addScaledVector(flat, -((robot.radius || 2) + 0.5)), flat)
          if (near?.surface) loc = near
        }
      }
    }
    const P = loc?.point ?? point
    const N = loc?.normal ?? dir.clone().negate()
    this._lastDir.set(targetId, dir)

    if (dealt > 0) {
      const nk = result?.armorDealt > 0 && result?.coreDealt === 0 ? 'armor' : 'core'
      this._numbers.add(targetId, P, dealt, { crit: !!evt?.crit, kind: type === 'burn' ? 'burn' : nk })
    }

    // ── Signature of the weapon that hit ──
    const crit = !!evt?.crit
    const hot = crit ? 0xfff2a0 : 0xffc879
    _bias.copy(dir).reflect(N)                                   // ricochet direction
    const info = { dealt, dir, point: P, normal: N, kick: 0, rock: 0 }
    // A grazing round glanced off: a bright streak along the surface, a scratch
    // instead of a hole (its reduced damage was already applied upstream).
    if (evt?.ricochet && (kind === 'kinetic' || kind === 'pellet')) {
      fx.sparks(P, _bias, { count: 7, speed: 18, spread: 0.25, color: 0xfff2c0, life: 0.22, bias: _bias })
      arenaAudio.play('impact_light', { minGap: 0.08, level: 1 })
    }
    let sound = null, gap = 0.04
    switch (kind) {
      case 'kinetic':
        fx.flash(P, { size: 0.24 * s, life: 0.05 })
        fx.sparks(P, N, { count: Math.round((crit ? 10 : 6) * s), speed: 15, spread: 0.55, color: hot, life: 0.2, bias: _bias })
        if (level >= 2 && Math.random() < 0.6) fx.debris(P, N, { count: 1, speed: 5, size: 0.07, life: 0.8, up: 2 })
        info.mark = { type: evt?.ricochet ? 'wear' : 'bullet', size: (evt?.ricochet ? 0.22 : 0.34) * s }; info.force = 0.3
        info.kick = 0.3 * s; info.rock = 0.12 * s
        sound = 'impact_light'; gap = 0.05
        break
      case 'pellet':
        fx.flash(P, { size: 0.16, life: 0.04 })
        fx.sparks(P, N, { count: crit ? 5 : 3, speed: 12, spread: 0.8, color: hot, life: 0.17, bias: _bias })
        if (Math.random() < 0.3) fx.debris(P, N, { count: 1, speed: 4.5, size: 0.06, life: 0.7, up: 2 })
        info.mark = { type: 'bullet', size: 0.2 }; info.force = 0.35
        info.kick = 0.2; info.rock = 0.11
        sound = 'impact_pellet'; gap = 0.09
        break
      case 'blast':
        fx.sparks(P, N, { count: 14, speed: 14, spread: 1, color: 0xffb648, life: 0.35 })
        fx.debris(P, N, { count: 4, speed: 8, size: 0.15, life: 1.2 })
        fx.smoke(P, { size: 0.6, rise: 2, life: 1, color: 0x6e7279, opacity: 0.45 })
        info.mark = { type: 'scorch', size: 1.5 }; info.force = 1
        info.glow = { color: 0xff6a1a, amount: 0.45 }
        info.kick = 1.2; info.rock = 1.2
        break
      case 'blunt':
        fx.flash(P, { size: 0.42, color: 0xfff4dc, life: 0.07 })
        fx.sparks(P, N, { count: 10, speed: 9, spread: 1.1, color: 0xfff1cf, life: 0.22 })
        fx.debris(P, N, { count: 3, speed: 6, size: 0.14, life: 1.1 })
        fx.smoke(P, { size: 0.35, rise: 0.8, life: 0.5, color: 0x777b82, opacity: 0.2 })
        info.mark = { type: 'dent', size: 0.9 }; info.force = 1
        info.kick = 1.1; info.rock = 1.3
        sound = 'impact_heavy'; gap = 0.08
        break
      case 'heat':
        fx.sparks(P, N, { count: 2, speed: 3.5, spread: 0.9, color: 0xff7a22, life: 0.45, size: 0.06, grav: -0.1, drag: 1.2 })
        if (Math.random() < 0.2) fx.smoke(P, { size: 0.3, rise: 1.8, life: 0.7, color: 0x6e7279, opacity: 0.3 })
        info.mark = { type: 'soot', size: 0.8 }; info.soot = true; info.force = 0.15
        info.glow = { color: 0xff5a14, amount: 0.09 }
        sound = 'sizzle'; gap = 0.2
        break
      case 'collision': {
        const n = Math.min(22, 6 + Math.round(dealt * 0.7))
        fx.flash(P, { size: 0.3 + 0.03 * n, life: 0.06 })
        fx.sparks(P, N, { count: n, speed: 11, spread: 1.2, color: 0xffc46a, life: 0.28 })
        fx.smoke(P, { size: 0.4, rise: 0.7, life: 0.55, color: 0x777b82, opacity: 0.2 })
        if (level >= 2) fx.debris(P, N, { count: level, speed: 5, size: 0.11, life: 1 })
        info.mark = { type: 'dent', size: 0.7 }; info.force = 0.7
        info.kick = 0.5 * s; info.rock = 0.7 * s
        sound = level >= 3 ? 'impact_heavy' : 'armor_impact'; gap = 0.06
        break
      }
    }

    // Armor layer just gave out: plates shatter off around the hit.
    if (armorBreak) {
      fx.flash(P, { size: 0.9, color: 0xcfe8ff, life: 0.09 })
      fx.sparks(P, N, { count: 12, speed: 12, spread: 1.1, color: 0xbfe0ff, life: 0.3 })
      fx.debris(P, N, { count: 8, speed: 8, size: 0.17, color: 0x8fa9b8, life: 1.3 })
      arenaAudio.play('armor_break')
    }

    // ── Part damage state + reaction ──
    // A mark is only ever left where the hit really met the robot's surface.
    info.surface = !!loc?.surface
    if (!info.surface) info.mark = null
    const res = loc ? this._damage.hit(targetId, loc.part, info) : null
    for (const m of res?.mounts ?? []) {
      // A mount giving way is heard before it is seen to fail.
      if (!m.failed) arenaAudio.play(m.state >= 3 ? 'clank' : 'zap', { minGap: 0.1 })
    }
    if (res?.changed && !res.detached && res.state === 2) {
      fx.sparks(P, N, { count: 9, speed: 8, spread: 1.2, color: 0xa8d8ff, life: 0.22, size: 0.055 })
      arenaAudio.play('zap', { minGap: 0.15 })
    }

    // ── Physical twist: an off-centre hit turns the robot (bounded) ──
    const knock = def?.knockback || 0
    if (knock > 0 && robot && actor?.state !== 'destroyed') {
      const body = physicsManager.getBody(robot.bodyId)
      if (body) {
        const c = body.translation()
        const rx = P.x - c.x, rz = P.z - c.z
        const R2 = 0.5 * (robot.radius || 2) ** 2
        const dw = THREE.MathUtils.clamp(0.18 * knock * (rz * dir.x - rx * dir.z) / R2, -0.9, 0.9)
        if (Math.abs(dw) > 0.02) physicsManager.applyTorqueImpulse(robot.bodyId, { x: 0, y: dw * (body.mass() || 1) * R2, z: 0 })
      }
    }

    if (sound) arenaAudio.play(sound, { minGap: gap, level })
    if (isPlayerTarget) this._addShake(armorBreak ? 0.22 : level === 1 ? 0.025 : level === 2 ? 0.07 : 0.2)
    else if (evt?.sourceId === this._playerId && level === 3) this._addShake(0.05)

    this.lastImpact = { attackerId: evt?.sourceId ?? null, targetId, weapon: evt?.weaponKey ?? null, kind, dealt, level, ricochet: !!evt?.ricochet, point: P, normal: N, dir, partId: loc?.part?.id ?? null, onSurface: !!loc?.surface, state: res?.state ?? null, detached: !!res?.detached, mounts: (res?.mounts ?? []).map(m => ({ partId: m.part.id, state: m.state, failed: m.failed })) }
    if (globalThis.__ARENA_DEBUG) console.debug('[impact]', this.lastImpact)
  }

  _onViewEvent(name, data) {
    if (name === 'part_break') {
      arenaAudio.play('part_break')
      this._addShake(data.robotId === this._playerId ? 0.24 : 0.1)
    } else if (name === 'zap') arenaAudio.play('zap', { minGap: 0.5 })
    else if (name === 'pop') arenaAudio.play('impact_heavy', { minGap: 0.1 })
    else if (name === 'clank') arenaAudio.play('clank', { minGap: 0.08 })
  }

  // Rocket/grenade blast at a point (robots in range get their own onHit).
  onExplosion(pos, isNearPlayer = false) {
    const fx = this._hits
    const g = _v.set(pos.x, Math.max(0.15, pos.y), pos.z)
    fx.flash(g, { size: 1.5, color: 0xffb45a, life: 0.13 })
    fx.ring(g, { radius: 7 })
    fx.sparks(g, UP, { count: 18, speed: 15, spread: 1, color: 0xffb648, life: 0.4 })
    fx.debris(g, UP, { count: 6, speed: 8, size: 0.17, color: 0x2b2f38, life: 1.2 })
    fx.smoke(g, { size: 1, rise: 2.4, life: 1.3, color: 0x5c6067, opacity: 0.45 })
    fx.smoke(g, { size: 0.7, rise: 1.4, life: 1, color: 0x8a8e96, opacity: 0.35 })
    arenaAudio.play('explosion')
    this._addShake(isNearPlayer ? 0.32 : 0.14)
  }

  // A robot was destroyed (combat state) — play the mechanical destruction.
  onDestroyed(robotId) {
    this._damage.destroyed(robotId, this._lastDir.get(robotId))
    arenaAudio.play('destruction')
    this._shakeLeft = 1
    this._addShake(robotId === this._playerId ? 0.7 : 0.45)
  }

  onOverheat() { arenaAudio.play('overheat') }

  // Per-frame, AFTER the robots' meshes were placed from physics.
  step(dt) {
    this._shakeLeft = SHAKE_PER_FRAME
    this._damage.step(dt)
    this._hits.step(dt)
    this._numbers.update(this._camera, this._canvas)
  }

  // ── Component model queries (RobotDamageView is the authority) ─────────────
  resolveShot(robotId, entry, dir) { return this._damage.resolve(robotId, entry, dir) }
  exitPoint(robotId, entry, dir) { return this._damage.exitPoint(robotId, entry, dir) }
  partHealthForMesh(robotId, mesh) { const p = this._damage.partForMesh(robotId, mesh); return p ? this._damage.partHealth(p) : 1 }
  driveState(robotId) { return this._damage.driveState(robotId) }

  // Dev/test introspection.
  stats() { return { ...this._hits.stats(), loose: this._damage.looseCount } }
  partState(robotId) { return this._damage.snapshot(robotId) }

  clear() {
    this._damage.clear()
    this._hits.clear()
    this._numbers.clear()
    arenaAudio.clear()
    this._lastDir.clear()
    this._getRobot = this._getActor = null
    this.lastImpact = null
  }
}
