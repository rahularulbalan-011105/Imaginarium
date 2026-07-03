// ── AI behaviors ─────────────────────────────────────────────────────────────
// Each behavior maps the robot's situation (sensor readings + time) to a pair of
// drive commands { left, right } in PWM (-255..255). They drive a robot exactly
// like firmware does — through the same motor channel — but reactively, from
// sensors. New behaviors = one entry here; no engine changes.
//
// ctx = { dt, phase(sec), range(cm|null), hasRange(bool), nearCm }

export const AI_BEHAVIORS = {
  idle: {
    label: 'Off',
    fn: () => ({ left: 0, right: 0 }),
  },

  wander: {
    label: 'Wander',
    fn: (ctx) => {
      // Cruise forward, weaving gently with a slow sine.
      const turn = Math.sin(ctx.phase * 0.7) * 70
      return { left: 150 + turn, right: 150 - turn }
    },
  },

  avoid: {
    label: 'Avoid obstacles',
    fn: (ctx) => {
      // If a range sensor sees something close ahead, pivot in place; else cruise.
      if (ctx.hasRange && ctx.range != null && ctx.range < ctx.nearCm) {
        return { left: 170, right: -170 }   // spin to clear the obstacle
      }
      return { left: 180, right: 180 }      // forward
    },
  },

  follow: {
    label: 'Follow / approach',
    fn: (ctx) => {
      // Drive toward whatever the range sensor sees; stop at a set standoff.
      if (!ctx.hasRange || ctx.range == null) return { left: 0, right: 0 }
      const standoff = ctx.nearCm
      if (ctx.range > standoff + 5) return { left: 170, right: 170 }   // approach
      if (ctx.range < standoff - 5) return { left: -120, right: -120 } // too close, back off
      return { left: 0, right: 0 }                                     // hold
    },
  },
}

export const AI_BEHAVIOR_KEYS = Object.keys(AI_BEHAVIORS)
