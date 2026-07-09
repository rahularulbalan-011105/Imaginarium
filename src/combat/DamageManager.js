// ─────────────────────────────────────────────────────────────────────────────
// DamageManager — the SINGLE funnel every damage source routes through.
//
// Stage 2: collision (ram) damage flows here; Stages 4+ (bullets, splash, burn,
// hazards) emit the same DamageEvent, so armor/core/crit/friendly-fire logic
// lives in exactly one place and never diverges.
//
// DamageEvent {
//   targetId, sourceId?,                     // robot ids (assembly rootId)
//   damageType,                              // 'collision'|'core'|'armor'|'stability'|'heat'|'explosion'|'burn'
//   amounts: { armor?, core?, stability?, heat? },
//   impulse?: {x,y,z}, hitPoint?: {x,y,z},   // physics response / VFX (applied by the host)
//   crit?: bool, critMul?: number,           // bonus when core is exposed (armor==0)
// }
//
// Decoupled from CombatManager via configure(): the host provides getActor(id)
// (runtime actor with mutable armor/core/heat/stability/state) + onApplied(id,
// result, evt) (HUD mirror, physics impulse, win check) + allowFriendlyFire hook.
// ─────────────────────────────────────────────────────────────────────────────

export const DAMAGE_TYPES = ['collision', 'armor', 'core', 'stability', 'heat', 'explosion', 'burn']

const DEFAULT_CRIT_MUL = 1.5

class DamageManager {
  constructor() {
    this._getActor = null
    this._onApplied = null
    this._friendly = null   // (sourceId, targetId) => bool "allow damage"
  }

  configure({ getActor, onApplied, allowFriendlyFire = null }) {
    this._getActor = getActor
    this._onApplied = onApplied
    this._friendly = allowFriendlyFire
    return this
  }

  reset() { this._getActor = this._onApplied = this._friendly = null }

  // Apply one DamageEvent. Returns a result object (or null if dropped).
  apply(evt) {
    if (!this._getActor) return null
    const actor = this._getActor(evt.targetId)
    if (!actor || actor.state === 'destroyed') return null

    // Friendly-fire gate (Stage 5 rules; default = allow when no hook set).
    if (evt.sourceId != null && this._friendly && !this._friendly(evt.sourceId, evt.targetId)) {
      return { applied: false, blocked: 'friendly-fire' }
    }

    const amt = evt.amounts || {}

    // Crit: hitting an already-exposed core does bonus core damage.
    let coreDmg = amt.core || 0
    if (evt.crit && actor.armor <= 0) coreDmg = Math.round(coreDmg * (evt.critMul || DEFAULT_CRIT_MUL))

    // Armor layer absorbs first; overflow spills into core.
    let overflow = 0
    const armorDmg = amt.armor || 0
    if (armorDmg > 0) {
      const before = actor.armor
      actor.armor = Math.max(0, actor.armor - armorDmg)
      overflow = armorDmg - (before - actor.armor)
    }

    const coreTotal = coreDmg + overflow
    if (coreTotal > 0) actor.core = Math.max(0, actor.core - coreTotal)

    // Stability + heat accumulate (consumed by the Stability/Heat systems, Stage 3).
    if (amt.stability) actor.stability = Math.min(actor.stabilityMax, actor.stability + amt.stability)
    if (amt.heat)      actor.heat      = Math.min(actor.heatMax,      actor.heat + amt.heat)

    const destroyed = actor.core <= 0
    if (destroyed) { actor.core = 0; actor.state = 'destroyed' }

    const result = {
      applied: true, destroyed,
      armor: actor.armor, core: actor.core,
      stability: actor.stability, heat: actor.heat,
      coreDealt: coreTotal, armorDealt: armorDmg - overflow,
    }
    if (this._onApplied) this._onApplied(evt.targetId, result, evt)
    return result
  }
}

export const damageManager = new DamageManager()
