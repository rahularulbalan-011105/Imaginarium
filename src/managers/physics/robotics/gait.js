// Generic gait generator. It produces FOOT TARGETS in the body frame plus
// stance/swing phase for each leg. It never touches meshes or joints — targets go
// to IK, IK to the servos, the servos make torque, and physics moves the robot.
//
// Legs are classified from their neutral positions (side = left/right of the
// forward axis, rank = fore→aft order), so the same patterns work for 2, 4, 6 or
// 8 legs without assuming "4 legs = quadruped".
import * as THREE from 'three'

export const GAIT_TYPES = ['standing', 'walk', 'crawl', 'trot', 'pace', 'bound', 'gallop', 'tripod', 'wave', 'custom']
export const TRAJECTORY_TYPES = ['linear', 'cubic', 'bezier']

export const DEFAULT_GAIT = {
  type:          'auto',      // auto → trot (4), tripod (6), walk (2) …
  // Defaults sized for hobby servos (MG90S/MG996R class, ~0.1–0.14 s/60°):
  // faster cadences or higher steps push the joints toward no-load speed where
  // a DC motor has no torque left, and the legs fold (as they would for real).
  frequency:     null,        // Hz, full cycle; null → per-gait default (FREQ)
  dutyFactor:    null,        // stance fraction; null → per-gait default
  stepHeight:    0.8,         // su lifted during swing (4 cm)
  strideLength:  2.0,         // su max foot travel per stance
  trajectory:    'bezier',
  maxSpeed:      2.5,         // su/s at full command
  maxTurnRate:   0.6,         // rad/s at full command
  commandRamp:   0.5,         // s — time constant for starting/stopping
  // Quasi-static COM sway: before a leg lifts, shift the body over the legs that
  // stay planted (essential for crawl/walk; ≈0 for trot/pace where the support
  // centroid is the body centre).
  comSway:       true,
  swayLookahead: 0.2,         // fraction of a cycle — legs lifting sooner don't count as support
  swayGain:      1.0,
  swayTime:      0.3,         // s — sway filter time constant (a body can't be flung over its feet)
  customOffsets: null,        // [phase per leg] for 'custom'
  standHeightOffset: 0,       // su: lower (−) / raise (+) the stance
}

// Duty factor (stance fraction) and cadence per gait. Crawl/wave keep ≥3 feet
// down with 4-leg overlap phases in which the body can sway over the next
// support triangle; trot/pace/bound are dynamic (2 feet down) and need speed.
const DUTY = { walk: 0.7, crawl: 0.85, trot: 0.5, pace: 0.5, bound: 0.45, gallop: 0.4, tripod: 0.5, wave: 0.85, custom: 0.6, standing: 1 }
const FREQ = { walk: 0.7, crawl: 0.4, trot: 1.0, pace: 1.0, bound: 1.2, gallop: 1.4, tripod: 0.8, wave: 0.4, custom: 0.8, standing: 0.8 }

export function autoGaitType(nLegs) {
  if (nLegs >= 6) return 'tripod'
  if (nLegs >= 4) return 'trot'
  if (nLegs >= 2) return 'walk'
  return 'standing'
}

/** Assign side (0 left / 1 right) and rank (0 = frontmost) to each leg. */
export function classifyLegs(neutrals, axes) {
  const info = neutrals.map((n, i) => ({
    i,
    side: n.dot(axes.right) >= 0 ? 1 : 0,
    fwd:  n.dot(axes.forward),
  }))
  for (const side of [0, 1]) {
    const s = info.filter(l => l.side === side).sort((a, b) => b.fwd - a.fwd)
    s.forEach((l, r) => { l.rank = r; l.ranks = s.length })
  }
  return info
}

/** Phase offset of each leg (0…1) for a gait pattern. */
export function phaseOffsets(type, legInfo, custom) {
  const n = legInfo.length
  if (type === 'custom' && Array.isArray(custom) && custom.length >= n) return legInfo.map(l => ((custom[l.i] % 1) + 1) % 1)
  return legInfo.map(l => {
    const front = l.ranks > 1 ? l.rank / (l.ranks - 1) : 0   // 0 front … 1 rear
    switch (type) {
      case 'trot':
      case 'tripod':  return ((l.side + l.rank) % 2) * 0.5        // diagonal / alternating tripods
      case 'pace':    return l.side * 0.5                          // same side together
      case 'bound':   return front >= 0.5 ? 0.5 : 0                // fronts, then rears
      case 'gallop':  return (front >= 0.5 ? 0.5 : 0) + l.side * 0.1
      case 'walk':
      case 'crawl':
      case 'wave': {
        // Lateral sequence: left legs rear→front, then right legs rear→front,
        // evenly spaced. Four legs → LH, LF, RH, RF (the classic crawl/walk).
        const leftCount = legInfo.filter(o => o.side === 0).length
        const order = l.side * leftCount + (l.ranks - 1 - l.rank)
        return order / Math.max(1, n)
      }
      default:        return 0
    }
  })
}

// Swing profile: horizontal progress u(s) and lift z(s), s ∈ [0,1].
function swingProfile(s, kind) {
  let u
  if (kind === 'linear') u = s
  else if (kind === 'cubic') u = s * s * (3 - 2 * s)
  else { // bezier: quintic-ish via cubic Bézier with flat ends (0,0,1,1)
    const t = s, a = 1 - t
    u = 3 * a * t * t + t * t * t
  }
  // Lift: Bézier bump that leaves and lands vertically (0, 1.33, 1.33, 0) → peak 1.
  const a = 1 - s
  const z = (3 * a * a * s + 3 * a * s * s) * (4 / 3)
  return { u, z: Math.min(1, z) }
}

export class GaitController {
  /**
   * @param neutrals THREE.Vector3[] body-frame neutral foot positions
   * @param axes     { forward, up, right } body-frame unit vectors
   */
  constructor(neutrals, axes, params = {}) {
    this.axes = axes
    this.neutrals = neutrals.map(n => n.clone())
    this.setParams(params)
    this.time = 0
    this.targets = neutrals.map(n => n.clone())
    this.phases = neutrals.map(() => 0)
    this.stance = neutrals.map(() => true)
    this.cmd = { forward: 0, strafe: 0, turn: 0 }   // ramped command actually executed
    this.sway = new THREE.Vector3()
    this._swayTarget = new THREE.Vector3()
    this._c0 = new THREE.Vector3()
    for (const n of neutrals) this._c0.add(n)
    this._c0.divideScalar(Math.max(1, neutrals.length))
  }

  setParams(params) {
    this.params = { ...DEFAULT_GAIT, ...params }
    const t = this.params.type === 'auto' ? autoGaitType(this.neutrals.length) : this.params.type
    this.type = GAIT_TYPES.includes(t) ? t : 'trot'
    this.legInfo = classifyLegs(this.neutrals, this.axes)
    this.offsets = phaseOffsets(this.type, this.legInfo, this.params.customOffsets)
    this.duty = this.params.dutyFactor ?? DUTY[this.type] ?? 0.6
    this.frequency = this.params.frequency ?? FREQ[this.type] ?? 0.8
  }

  /**
   * Advance the gait clock and compute every foot's body-frame target.
   * @param cmd { forward (−1…1), strafe (−1…1), turn (−1…1) }
   */
  step(h, cmd = {}) {
    const p = this.params, ax = this.axes
    // Ramp the command (no step changes in stride → no torque spikes at start/stop).
    const k = 1 - Math.exp(-h / Math.max(1e-3, p.commandRamp))
    const clamp1 = (v) => Math.max(-1, Math.min(1, v || 0))
    const c = this.cmd
    c.forward += (clamp1(cmd.forward) - c.forward) * k
    c.strafe  += (clamp1(cmd.strafe)  - c.strafe)  * k
    c.turn    += (clamp1(cmd.turn)    - c.turn)    * k
    const fwd = c.forward, str = c.strafe, trn = c.turn
    const requested = Math.abs(cmd.forward || 0) + Math.abs(cmd.strafe || 0) + Math.abs(cmd.turn || 0) > 1e-3
    const moving = requested || Math.abs(fwd) + Math.abs(str) + Math.abs(trn) > 0.02
    const standing = this.type === 'standing' || !moving

    if (!standing) this.time += h
    const T = 1 / Math.max(0.05, this.frequency)
    const Tst = this.duty * T

    // COM sway target: centroid of the legs that stay planted through the lookahead.
    const sw = this._swayTarget.set(0, 0, 0)
    if (p.comSway && !standing && this.neutrals.length >= 3) {
      let cnt = 0
      for (let i = 0; i < this.neutrals.length; i++) {
        const ph = (this.time * this.frequency + this.offsets[i]) % 1
        if (ph < this.duty - p.swayLookahead) { sw.add(this.neutrals[i]); cnt++ }
      }
      if (cnt >= 3) {
        sw.divideScalar(cnt).sub(this._c0).multiplyScalar(p.swayGain)
        sw.addScaledVector(ax.up, -sw.dot(ax.up))
      } else sw.set(0, 0, 0)
    }
    this.sway.lerp(sw, 1 - Math.exp(-h / Math.max(1e-3, p.swayTime)))

    const v = new THREE.Vector3()
      .addScaledVector(ax.forward, fwd * p.maxSpeed)
      .addScaledVector(ax.right, str * p.maxSpeed)
    const w = trn * p.maxTurnRate
    const d = new THREE.Vector3(), lift = ax.up
    for (let i = 0; i < this.neutrals.length; i++) {
      const n = this.neutrals[i]
      // Feet move opposite to the desired body shift (body goes over the support).
      const tgt = this.targets[i].copy(n).addScaledVector(lift, p.standHeightOffset).sub(this.sway)
      if (standing) { this.stance[i] = true; this.phases[i] = 0; continue }
      // Ground velocity of this foot's hip under the commanded twist (v + ω × n).
      d.copy(ax.up).cross(n).multiplyScalar(w).add(v)
      d.addScaledVector(ax.up, -d.dot(ax.up))            // horizontal only
      d.multiplyScalar(Tst / 2)
      const L = d.length(), maxL = p.strideLength / 2
      if (L > maxL) d.multiplyScalar(maxL / L)

      const ph = (this.time / T + this.offsets[i]) % 1
      this.phases[i] = ph
      if (ph < this.duty) {
        // Stance: foot sweeps from +d (touchdown, ahead) to −d (lift-off, behind).
        const s = ph / this.duty
        this.stance[i] = true
        tgt.addScaledVector(d, 1 - 2 * s)
      } else {
        // Swing: lift, carry forward, lower, re-contact.
        const s = (ph - this.duty) / (1 - this.duty)
        const { u, z } = swingProfile(s, p.trajectory)
        this.stance[i] = false
        tgt.addScaledVector(d, -1 + 2 * u).addScaledVector(lift, z * p.stepHeight)
      }
    }
    return this.targets
  }
}
