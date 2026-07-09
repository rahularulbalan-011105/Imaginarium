// ─────────────────────────────────────────────────────────────────────────────
// StatusEffectSystem — timed per-robot debuffs (framework).
//
// Stage 3 ships the machinery + the movement-slow aggregation and burn ticking;
// Stage 4 weapons populate it (flamethrower → 'burning', shots → 'slow', EMP →
// 'disabled', …). Each effect: { type, expiresAt(ms), magnitude, dps? }.
//
//   burning  : deals dps as burn damage over time (via onBurn callback)
//   slow     : multiplies movement by (1 - magnitude)
//   disabled : magnitude 1 slow (can't move) — reserved for EMP
//   repairing: reserved (co-op) — no movement effect
// ─────────────────────────────────────────────────────────────────────────────

class StatusEffectSystem {
  // Add/refresh an effect on an actor. durationMs from `now`.
  add(actor, { type, magnitude = 0, durationMs = 1000, dps = 0 }, now) {
    if (!actor) return
    const expiresAt = now + durationMs
    const existing = actor.effects.find(e => e.type === type)
    if (existing) { existing.expiresAt = Math.max(existing.expiresAt, expiresAt); existing.magnitude = Math.max(existing.magnitude, magnitude); existing.dps = Math.max(existing.dps || 0, dps) }
    else actor.effects.push({ type, magnitude, expiresAt, dps })
  }

  has(actor, type) { return !!actor?.effects?.some(e => e.type === type) }

  // Tick: drop expired effects and apply per-tick damage (burn). onBurn(actorId, amount).
  tick(actor, now, dt, onBurn) {
    if (!actor || !actor.effects.length) return
    let burn = 0
    actor.effects = actor.effects.filter(e => {
      if (now >= e.expiresAt) return false
      if (e.type === 'burning' && e.dps) burn += e.dps * dt
      return true
    })
    if (burn > 0 && onBurn) onBurn(actor.id, burn)
  }

  // Aggregate movement multiplier from slow/disabled effects (0..1).
  moveMult(actor) {
    let m = 1
    if (!actor?.effects) return m
    for (const e of actor.effects) {
      if (e.type === 'slow' || e.type === 'disabled') m *= Math.max(0, 1 - e.magnitude)
    }
    return m
  }

  clear(actor) { if (actor) actor.effects = [] }
}

export const statusEffectSystem = new StatusEffectSystem()
