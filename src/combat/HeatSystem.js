// ─────────────────────────────────────────────────────────────────────────────
// HeatSystem — per-robot heat meter.
//
// Heat rises from action (impacts now; weapon fire in Stage 4) and cools
// naturally over time. At max the robot OVERHEATS: reduced move speed (and, once
// weapons exist, reduced fire rate) until it cools back below a resume threshold
// (hysteresis, so it doesn't flicker at the cap).
//
// Future: split into battery/motor/servo temperatures — this meter is the shared
// aggregate those will feed.
// ─────────────────────────────────────────────────────────────────────────────

const COOL_RATE      = 14    // heat points/sec dissipated
const RESUME_FRAC    = 0.5   // must cool below 50% to clear overheat
const OVERHEAT_MOVE  = 0.6   // move multiplier while overheated

class HeatSystem {
  tick(actor, dt) {
    if (!actor || actor.state === 'destroyed') return
    actor.heat = Math.max(0, actor.heat - COOL_RATE * dt)
    if (actor.overheated) {
      if (actor.heat <= actor.heatMax * RESUME_FRAC) actor.overheated = false
    } else if (actor.heat >= actor.heatMax) {
      actor.overheated = true
    }
  }

  // Move multiplier from heat (1 = full).
  moveMult(actor) { return actor?.overheated ? OVERHEAT_MOVE : 1 }
}

export const heatSystem = new HeatSystem()
