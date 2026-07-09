// ─────────────────────────────────────────────────────────────────────────────
// StabilitySystem — the physical stagger meter.
//
// Weapons/impacts add stability damage (via DamageManager amounts.stability).
// When stability crosses the max the robot STUMBLES: reduced move + turn (and
// later aim). It then recovers over a fixed window and the meter drains.
//
// Recovery depends on the robot's build: heavier / more knockback-resistant
// robots (recoilResist, mass-derived) shrug it off faster and drain faster.
// Legged robots recover differently (lower stability when legs are damaged) —
// that nuance plugs in here once leg-damage tracking exists (marked below).
// ─────────────────────────────────────────────────────────────────────────────

const STAGGER_MS       = 1300    // stumble duration once triggered
const DRAIN_BASE       = 16      // stability points/sec drained while active
const STAGGER_MOVE     = 0.35    // move multiplier while staggered
const STAGGER_TURN     = 0.40    // turn multiplier while staggered

class StabilitySystem {
  // Tick one actor. `stats` is its CombatStats block. Mutates actor.
  tick(actor, stats, dt, now) {
    if (!actor || actor.state === 'destroyed') return

    if (actor.staggered) {
      if (now >= actor._staggerUntil) { actor.staggered = false; actor.stability = 0 }
      return
    }

    // Trigger stumble when the meter tops out.
    if (actor.stability >= actor.stabilityMax) {
      actor.staggered = true
      actor._staggerUntil = now + STAGGER_MS
      actor.stability = actor.stabilityMax
      return
    }

    // Otherwise drain toward zero; sturdier builds (recoilResist) drain faster.
    // TODO(legged): reduce recovery when leg links are damaged.
    const drain = DRAIN_BASE * (0.6 + (stats?.recoilResist ?? 0.4))
    actor.stability = Math.max(0, actor.stability - drain * dt)
  }

  // Control authority while staggered → { move, turn } multipliers (1 = full).
  authority(actor) {
    return actor?.staggered ? { move: STAGGER_MOVE, turn: STAGGER_TURN } : { move: 1, turn: 1 }
  }
}

export const stabilitySystem = new StabilitySystem()
