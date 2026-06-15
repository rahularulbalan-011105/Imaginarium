/**
 * Gait engine for multi-legged robots.
 *
 * Generates per-leg foot target positions each simulation frame based on a
 * gait pattern (tripod, trot, wave) and the robot's velocity command.
 *
 * Coordinate system: all positions are in the ROBOT's body frame.
 * +X = right, +Y = up, +Z = forward.
 */

// ── Gait phase offsets ────────────────────────────────────────────────────────

// Tripod gait for hexapods: two groups of 3 alternate at 0.5 phase offset.
// Leg order: FR=0, FM=1, FL=2, RR=3, RM=4, RL=5
export const TRIPOD_PHASES  = [0, 0.5, 0, 0.5, 0, 0.5]

// Wave gait: each leg offset by 1/6 of a cycle (most stable, slowest)
export const WAVE_PHASES    = [0, 1/6, 2/6, 3/6, 4/6, 5/6]

// Trot gait for quadrupeds: diagonal pairs move together
// Leg order: FR=0, FL=1, RR=2, RL=3  →  (FR,RL) and (FL,RR) are pairs
export const TROT_PHASES    = [0, 0.5, 0.5, 0]

// Walk (crawl) gait for quadrupeds: one leg at a time, 0.25 offset
export const WALK_PHASES    = [0, 0.25, 0.5, 0.75]

// ── GaitEngine ────────────────────────────────────────────────────────────────

export class GaitEngine {
  /**
   * @param {object[]} legs
   *   Each entry: { id: string, restPosition: {x,y,z} }
   *   restPosition = neutral foot position in body frame
   * @param {number[]} phaseOffsets  per-leg phase offset (0..1)
   * @param {object}   options
   *   @option {number} stepHeight    max foot lift in scene units  (default 1.5)
   *   @option {number} stepLength    max stride length in scene units (default 2.0)
   *   @option {number} cycleFreq     gait cycles per second (default 1.5)
   *   @option {number} stanceRatio   fraction of cycle in stance (default 0.6)
   */
  constructor(legs, phaseOffsets, options = {}) {
    this.legs         = legs
    this.phases       = phaseOffsets.slice(0, legs.length)
    this.stepHeight   = options.stepHeight   ?? 1.5
    this.stepLength   = options.stepLength   ?? 2.0
    this.cycleFreq    = options.cycleFreq    ?? 1.5
    this.stanceRatio  = options.stanceRatio  ?? 0.6
    this._clock       = 0   // accumulated time (s)
    this._targets     = {}
    // Initialise all feet at rest
    for (const leg of legs) {
      this._targets[leg.id] = { ...leg.restPosition }
    }
  }

  reset() {
    this._clock = 0
    for (const leg of this.legs) {
      this._targets[leg.id] = { ...leg.restPosition }
    }
  }

  /**
   * Advance the gait clock and compute new foot targets.
   *
   * @param {number} dt               delta time (s)
   * @param {number} forwardVelocity  desired forward speed (scene u/s, signed)
   * @param {number} turnRate         desired yaw rate (rad/s)
   * @returns {object}  { [legId]: {x, y, z} } foot targets in body frame
   */
  step(dt, forwardVelocity, turnRate) {
    this._clock += dt
    const period  = 1 / Math.max(0.1, this.cycleFreq)
    const swingRatio = 1 - this.stanceRatio

    const speed = Math.abs(forwardVelocity)
    // Scale step length with speed (up to the maximum)
    const stride = Math.min(this.stepLength, speed * period * this.stanceRatio * 2)

    for (let i = 0; i < this.legs.length; i++) {
      const leg  = this.legs[i]
      const rest = leg.restPosition
      const phase = ((this._clock / period) + (this.phases[i] ?? 0)) % 1

      let target
      if (phase < this.stanceRatio) {
        // ── Stance phase: foot on ground, moves backward relative to body ───
        const t = phase / this.stanceRatio           // 0 → 1 within stance
        const dx = forwardVelocity > 0
          ? stride * (0.5 - t)                       // foot slides back
          : stride * (t - 0.5)                       // reversed
        // Turn contribution: outer legs move faster than inner
        const turnOffset = turnRate * rest.x * period * 0.3
        target = {
          x: rest.x + turnOffset,
          y: 0,
          z: rest.z + dx,
        }
      } else {
        // ── Swing phase: foot lifts and steps forward ────────────────────────
        const t     = (phase - this.stanceRatio) / swingRatio  // 0 → 1
        const lift  = this.stepHeight * Math.sin(t * Math.PI)  // smooth arc
        const dx    = forwardVelocity > 0
          ? stride * (t - 0.5)
          : stride * (0.5 - t)
        target = {
          x: rest.x,
          y: lift,
          z: rest.z + dx,
        }
      }

      this._targets[leg.id] = target
    }

    return { ...this._targets }
  }

  getTargets() { return { ...this._targets } }
}

// ── Factory functions ─────────────────────────────────────────────────────────

/**
 * Build a tripod gait engine for a hexapod robot.
 * @param {object[]} legs  6 legs with { id, restPosition }
 * @param {object}   opts  stepHeight, stepLength, cycleFreq
 */
export function createTripodGait(legs, opts = {}) {
  return new GaitEngine(legs, TRIPOD_PHASES, { stanceRatio: 0.5, ...opts })
}

/**
 * Build a trot gait engine for a quadruped robot.
 * @param {object[]} legs  4 legs with { id, restPosition }
 */
export function createTrotGait(legs, opts = {}) {
  return new GaitEngine(legs, TROT_PHASES, { stanceRatio: 0.6, ...opts })
}

/**
 * Build a wave gait engine for a hexapod (most stable, slowest).
 */
export function createWaveGait(legs, opts = {}) {
  return new GaitEngine(legs, WAVE_PHASES, { stanceRatio: 5/6, ...opts })
}
