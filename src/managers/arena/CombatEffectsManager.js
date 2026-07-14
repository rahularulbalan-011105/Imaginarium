import * as THREE from 'three'
import { HitEffects } from './HitEffects.js'
import { DamageNumbers } from './DamageNumbers.js'
import { arenaAudio } from './ArenaAudio.js'
import { physicsManager } from '../physics/PhysicsManager.js'

// ─────────────────────────────────────────────────────────────────────────────
// CombatEffectsManager — the single orchestration seam for arena "juice".
//
// CombatManager/WeaponManager emit high-level combat events here; this fans them
// out to HitEffects (3D VFX), DamageNumbers (DOM overlay), ArenaAudio, and the
// camera shake. Nothing in the damage/weapon pipeline knows about VFX — they just
// call these hooks, so feedback can grow without touching combat logic.
// ─────────────────────────────────────────────────────────────────────────────

export class CombatEffectsManager {
  constructor() {
    this._hits = new HitEffects()
    this._numbers = new DamageNumbers()
    this._camera = null
    this._canvas = null
    this._shake = null          // set to the ArenaCameraManager's CameraShake
    this._getRobot = null       // (id) → robot (for mover meshes / body)
  }

  configure({ scene, camera, canvas, shake, getRobot }) {
    this._hits.configure(scene)
    this._numbers.mount()
    this._camera = camera
    this._canvas = canvas
    this._shake = shake
    this._getRobot = getRobot
    arenaAudio.resume()
    return this
  }

  // A shot was fired (muzzle owned by WeaponManager; add recoil shake + audio).
  onFire(robotId, def, isPlayer) {
    arenaAudio.play(def?.strategy === 'flame' ? 'fire_secondary' : (def?.key === 'melee' ? 'fire_secondary' : 'fire_primary'), { minGap: 0.04 })
    if (isPlayer && this._shake) this._shake.add(def?.recoil > 6 ? 0.18 : 0.09)
  }

  // A damage event landed on `targetId`. `result` from DamageManager, `evt` raw.
  onHit(targetId, worldPos, result, evt, { armorBreak = false, isPlayerTarget = false } = {}) {
    const dealt = (result?.coreDealt || 0) + (result?.armorDealt || 0)
    const kind = evt?.damageType === 'burn' ? 'burn' : (result?.armorDealt > 0 && result?.coreDealt === 0 ? 'armor' : 'core')
    if (dealt > 0) this._numbers.add(targetId, worldPos, dealt, { crit: !!evt?.crit, kind })
    this._hits.impact(worldPos, { armorBreak, crit: !!evt?.crit })
    const robot = this._getRobot?.(targetId)
    if (robot) this._hits.hitFlash(robot.movers, evt?.crit ? 0xfff2a0 : armorBreak ? 0x7dd3fc : 0xff5544)
    arenaAudio.play(evt?.damageType === 'collision' ? 'armor_impact' : 'hit', { minGap: 0.03 })
    // Feeling the hit: shake the camera a touch when the PLAYER is the one hit.
    if (isPlayerTarget && this._shake) this._shake.add(armorBreak ? 0.22 : 0.12)
  }

  // Rocket/grenade blast at a point.
  onExplosion(pos, isNearPlayer = false) {
    arenaAudio.play('explosion')
    if (this._shake) this._shake.add(isNearPlayer ? 'medium' : 0.28)
  }

  // A robot was destroyed — wreck stays; spawn fire/smoke/debris.
  onDestroyed(robotId) {
    const robot = this._getRobot?.(robotId)
    const pos = new THREE.Vector3()
    const body = robot ? physicsManager.getBody(robot.bodyId) : null
    if (body) { const t = body.translation(); pos.set(t.x, t.y, t.z) }
    this._hits.destroyed(pos)
    arenaAudio.play('destruction')
    if (this._shake) this._shake.add('heavy')
  }

  onOverheat() { arenaAudio.play('overheat') }

  // Per-frame: advance VFX + project damage numbers.
  step(dt) {
    this._hits.step(dt)
    this._numbers.update(this._camera, this._canvas)
  }

  clear() {
    this._hits.clear()
    this._numbers.clear()
    arenaAudio.clear()
    this._getRobot = null
  }
}
