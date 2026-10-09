// ─────────────────────────────────────────────────────────────────────────────
// ArenaAudio — combat audio hook layer with synthesized PLACEHOLDER sounds.
//
// Every combat event routes through play(event). Sounds are generated with the
// WebAudio API (oscillator/noise bursts) so NO asset files are needed yet — but
// the seam is a simple event→generator registry, so swapping in real samples
// later is a one-line change per event (replace the generator with a buffer play).
//
// Events: fire_primary, fire_secondary, fire_shotgun, fire_rocket, melee_swing,
//         impact_light / impact_pellet / impact_heavy, sizzle, armor_impact,
//         armor_break, part_break, zap, clank, explosion, overheat, destruction,
//         move (looping servo hum).
// The AudioContext is created lazily and resumed on the first user gesture
// (the arena launch button click), per browser autoplay policy.
// ─────────────────────────────────────────────────────────────────────────────

class ArenaAudio {
  constructor() {
    this._ctx = null
    this._master = null
    this._enabled = true
    this._moveGain = null
    this._moveOsc = null
    this._lastPlay = {}   // event → last time (throttle)
  }

  setEnabled(v) { this._enabled = v; if (!v) this.stopMove() }

  // Create/resume the context. Call on a user gesture (arena start).
  resume() {
    if (!this._enabled) return
    try {
      if (!this._ctx) {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        this._ctx = new AC()
        this._master = this._ctx.createGain()
        this._master.gain.value = 0.35
        this._master.connect(this._ctx.destination)
      }
      if (this._ctx.state === 'suspended') this._ctx.resume()
    } catch (_) { /* audio unavailable — silent */ }
  }

  // ── Event dispatch ──────────────────────────────────────────────────────────
  play(event, opts = {}) {
    if (!this._enabled || !this._ctx) return
    // Throttle rapid repeats (e.g. autocannon 8Hz) so it doesn't clip.
    const now = this._ctx.currentTime
    const gap = opts.minGap ?? 0.03
    if (this._lastPlay[event] && now - this._lastPlay[event] < gap) return
    this._lastPlay[event] = now
    const gen = GENERATORS[event]
    if (gen) { try { gen(this, opts) } catch (_) {} }
  }

  // Looping servo/motor hum while the player moves (volume tracks speed 0..1).
  move(intensity) {
    if (!this._enabled || !this._ctx) return
    const target = Math.max(0, Math.min(1, intensity)) * 0.06
    if (target <= 0.001) { this.stopMove(); return }
    if (!this._moveOsc) {
      this._moveOsc = this._ctx.createOscillator()
      this._moveOsc.type = 'sawtooth'
      this._moveOsc.frequency.value = 70
      this._moveGain = this._ctx.createGain()
      this._moveGain.gain.value = 0
      this._moveOsc.connect(this._moveGain).connect(this._master)
      this._moveOsc.start()
    }
    this._moveOsc.frequency.setTargetAtTime(60 + intensity * 55, this._ctx.currentTime, 0.1)
    this._moveGain.gain.setTargetAtTime(target, this._ctx.currentTime, 0.08)
  }

  stopMove() {
    if (this._moveGain && this._ctx) this._moveGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1)
  }

  clear() {
    this.stopMove()
    if (this._moveOsc) { try { this._moveOsc.stop() } catch (_) {} this._moveOsc = null; this._moveGain = null }
    this._lastPlay = {}
  }

  // ── Low-level synth primitives ──────────────────────────────────────────────
  _tone({ type = 'sine', f0, f1, dur, gain = 0.3, delay = 0 }) {
    const ctx = this._ctx, t = ctx.currentTime + delay
    const osc = ctx.createOscillator(); osc.type = type
    osc.frequency.setValueAtTime(f0, t)
    if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(this._master)
    osc.start(t); osc.stop(t + dur + 0.02)
  }

  // `hp` (optional) switches the filter to a highpass at that frequency (hiss/crack).
  _noise({ dur, gain = 0.3, lp = 4000, hp = 0, delay = 0 }) {
    const ctx = this._ctx, t = ctx.currentTime + delay
    const n = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const src = ctx.createBufferSource(); src.buffer = buf
    const filt = ctx.createBiquadFilter(); filt.type = hp ? 'highpass' : 'lowpass'; filt.frequency.value = hp || lp
    const g = ctx.createGain(); g.gain.value = gain
    src.connect(filt).connect(g).connect(this._master)
    src.start(t)
  }
}

// event → generator. Swap any of these for sample playback later.
const GENERATORS = {
  fire_primary:   (a) => { a._tone({ type: 'square', f0: 320, f1: 120, dur: 0.09, gain: 0.22 }); a._noise({ dur: 0.06, gain: 0.14, lp: 3000 }) },
  fire_secondary: (a) => { a._noise({ dur: 0.14, gain: 0.24, lp: 1600 }); a._tone({ type: 'sawtooth', f0: 180, f1: 60, dur: 0.14, gain: 0.16 }) },
  hit:            (a) => { a._tone({ type: 'triangle', f0: 900, f1: 400, dur: 0.05, gain: 0.16 }) },
  armor_impact:   (a) => { a._tone({ type: 'square', f0: 220, f1: 110, dur: 0.08, gain: 0.16 }); a._noise({ dur: 0.05, gain: 0.1, lp: 2500 }) },
  explosion:      (a) => { a._noise({ dur: 0.5, gain: 0.5, lp: 1800 }); a._tone({ type: 'sine', f0: 90, f1: 30, dur: 0.5, gain: 0.35 }) },
  destruction:    (a) => { a._noise({ dur: 0.8, gain: 0.6, lp: 1400 }); a._tone({ type: 'sine', f0: 120, f1: 25, dur: 0.8, gain: 0.4 }); a._tone({ type: 'sawtooth', f0: 200, f1: 40, dur: 0.6, gain: 0.2, delay: 0.05 }) },
  overheat:       (a) => { a._tone({ type: 'sine', f0: 660, f1: 990, dur: 0.18, gain: 0.18 }); a._tone({ type: 'sine', f0: 660, f1: 990, dur: 0.18, gain: 0.18, delay: 0.22 }) },
  // Weapon reports.
  fire_shotgun:   (a) => { a._noise({ dur: 0.2, gain: 0.34, lp: 1300 }); a._tone({ type: 'sine', f0: 130, f1: 45, dur: 0.18, gain: 0.28 }) },
  fire_rocket:    (a) => { a._noise({ dur: 0.34, gain: 0.2, hp: 900 }); a._tone({ type: 'sawtooth', f0: 110, f1: 220, dur: 0.3, gain: 0.12 }) },
  melee_swing:    (a) => { a._noise({ dur: 0.13, gain: 0.16, hp: 1400 }); a._tone({ type: 'sine', f0: 210, f1: 90, dur: 0.12, gain: 0.14 }) },
  // Impacts, by weight (opts.level 1–3 scales loudness a little).
  impact_light:   (a, o) => { const g = 0.1 + 0.03 * (o.level || 2); a._tone({ type: 'triangle', f0: 1500 + Math.random() * 500, f1: 600, dur: 0.035, gain: g }); a._noise({ dur: 0.025, gain: g * 0.6, hp: 2500 }) },
  impact_pellet:  (a) => { a._noise({ dur: 0.07, gain: 0.2, lp: 3200 }); a._tone({ type: 'triangle', f0: 1100, f1: 500, dur: 0.05, gain: 0.1 }) },
  impact_heavy:   (a) => { a._tone({ type: 'sine', f0: 150, f1: 48, dur: 0.2, gain: 0.34 }); a._tone({ type: 'square', f0: 310, f1: 140, dur: 0.09, gain: 0.13 }); a._noise({ dur: 0.1, gain: 0.2, lp: 1500 }) },
  sizzle:         (a) => { a._noise({ dur: 0.16, gain: 0.07, hp: 3200 }) },
  // Things breaking.
  armor_break:    (a) => { a._noise({ dur: 0.16, gain: 0.26, hp: 1800 }); a._tone({ type: 'square', f0: 520, f1: 190, dur: 0.14, gain: 0.16 }); a._tone({ type: 'triangle', f0: 1900, f1: 900, dur: 0.1, gain: 0.1, delay: 0.03 }) },
  part_break:     (a) => { a._noise({ dur: 0.07, gain: 0.34, hp: 1200 }); a._tone({ type: 'square', f0: 420, f1: 110, dur: 0.18, gain: 0.2 }); a._tone({ type: 'sine', f0: 170, f1: 55, dur: 0.22, gain: 0.26, delay: 0.02 }) },
  zap:            (a) => { a._tone({ type: 'sawtooth', f0: 2200, f1: 380, dur: 0.06, gain: 0.07 }); a._noise({ dur: 0.05, gain: 0.06, hp: 4000 }) },
  clank:          (a) => { a._tone({ type: 'triangle', f0: 760, f1: 330, dur: 0.09, gain: 0.15 }); a._tone({ type: 'square', f0: 190, f1: 120, dur: 0.06, gain: 0.08 }) },
}

export const arenaAudio = new ArenaAudio()
