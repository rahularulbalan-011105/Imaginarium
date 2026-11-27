// Bench function generator (Tinkercad "Function Generator"), compact DDS
// unit ≈ 230 W × 95 H × 260 D mm. Output: red (+) / black (−) 4 mm binding
// posts behind the standard 50 Ω output impedance.
//
// Circuit: a time-varying EMF e(t) = offset + amplitude·w(f·t) in series with
// 50 Ω (vsource with rInt = 50 Ω). e(t) is set before every solver sub-step
// (beforeStep at t + dt, matching the backward-Euler step). Amplitude is the
// open-circuit PEAK (into a 1 MΩ scope you see it; into 50 Ω you see half).
// The open-circuit output is limited to ±10 V like a real generator.
//
// Time resolution: sim.maxDt = 20 µs → ≥50 points per period at 1 kHz, which
// is why the frequency range here stops at 1 kHz (see report on MAX_SUBSTEPS).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { vsource, capacitor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, TIN, textPlane, fmtSI } from '../../model.js'
import { screenMesh, lcdText } from './screen.js'

const R_OUT = 50, V_LIM = 10, F_MIN = 0.1, F_MAX = 1000, MAX_DT = 2e-5
const W = 23.0, H = 9.5, BODY_D = 25.0, POST_L = 1.0
const FRONT = BODY_D / 2 - 0.5                     // body spans z ∈ [−13, 12]; posts to 13
const POST_Y = 2.6, POST_X = [7.4, 9.4]
const WAVES = ['sine', 'square', 'triangle']
const BUTTON_WAVE = { Sine: 'sine', Square: 'square', Triangle: 'triangle' }

/** Normalised waveform, −1…1, at phase p ∈ [0, 1). */
export function waveAt(wave, p) {
  if (wave === 'square') return p < 0.5 ? 1 : -1
  if (wave === 'triangle') return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4
  return Math.sin(2 * Math.PI * p)
}
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0))

export default definePart({
  type: 'function_generator',
  label: 'Function Generator',
  shortName: 'FG',
  tinkercad: 'Function Generator',
  category: 'instruments',
  icon: '〰️',
  desc: 'sine / square / triangle · 0.1 Hz–1 kHz · ±10 V · 50 Ω',
  purpose: 'Makes a repeating test signal between its + and − posts: choose the waveform, frequency, amplitude (peak) and DC offset. It has a 50 Ω output resistance like a real generator, so a heavy load sees less than the set amplitude. Watch the signal with the Oscilloscope.',
  usage: 'testing filters · driving a speaker or LED · clock signals',
  spec: {
    dims_mm: { w: 230, h: 95, d: 260 }, mass_kg: 1.6,
    output_ohm: R_OUT, f_range_Hz: [F_MIN, F_MAX], v_open_max_V: V_LIM,
    summary: 'e(t) = offset + A·wave(f·t) behind 50 Ω. Amplitude is open-circuit peak, limited to ±10 V.',
  },
  props: {
    waveform: { type: 'select', label: 'Waveform', default: 'sine', options: WAVES.map(w => ({ value: w, label: w[0].toUpperCase() + w.slice(1) })) },
    frequency: { type: 'number', label: 'Frequency', unit: 'Hz', default: 100, min: F_MIN, max: F_MAX },
    amplitude: { type: 'number', label: 'Amplitude (peak)', unit: 'V', default: 2, min: 0, max: V_LIM, step: 0.01 },
    offset: { type: 'number', label: 'DC offset', unit: 'V', default: 0, min: -5, max: 5, step: 0.01 },
  },
  groundPin: 'NEG',
  pins: [
    { name: 'POS', kind: 'power', label: '+', x: POST_X[1], y: POST_Y, z: FRONT + POST_L, r: 0.22 },
    { name: 'NEG', kind: 'gnd', label: '−', x: POST_X[0], y: POST_Y, z: FRONT + POST_L, r: 0.22, ldy: 0.3 },
  ],
  build() {
    const g = new Group()
    g.add(box(W, H, BODY_D, mat(0xd1d5db, { metal: 0.3, rough: 0.5 }), 0, H / 2, -0.5))              // case
    g.add(box(W - 0.3, H - 0.3, 0.2, mat(0x374151, { rough: 0.6 }), 0, H / 2, FRONT - 0.1))          // front panel
    g.add(box(9.4, 4.4, 0.1, mat(0x050505), -5.6, 5.6, FRONT + 0.05))                                // display bezel
    const scr = screenMesh('display', 9.0, 4.0, { pxW: 256, pxH: 114, bg: '#0b2545' })
    g.add(at(scr, -5.6, 5.6, FRONT + 0.11))
    // Waveform keys
    for (let i = 0; i < 3; i++) g.add(box(1.4, 0.9, 0.4, mat(0x6b7280, { rough: 0.5 }), -8.6 + i * 3.0, 2.0, FRONT + 0.2))
    // Big frequency knob + amplitude/offset knobs
    g.add(at(cyl(1.6, 1.0, mat(0x111827, { rough: 0.4 }), { axis: 'z', seg: 32 }), 2.6, 5.6, FRONT + 0.5))
    for (const x of [6.2, 9.0]) g.add(at(cyl(0.8, 0.8, mat(0x111827, { rough: 0.4 }), { axis: 'z', seg: 24 }), x, 6.4, FRONT + 0.4))
    // Output posts: black −, red +
    for (const [x, color] of [[POST_X[0], 0x111111], [POST_X[1], 0xd32f2f]]) {
      g.add(at(cyl(0.5, 0.6, mat(color, { rough: 0.4 }), { axis: 'z', seg: 20 }), x, POST_Y, FRONT + 0.3))
      g.add(at(cyl(0.18, POST_L, TIN(), { axis: 'z', seg: 12 }), x, POST_Y, FRONT + POST_L / 2 + 0.25))
    }
    const t = textPlane('OUTPUT 50Ω', 3.2, 0.5, { fg: '#e5e7eb', bg: null })
    if (t) g.add(at(t, 8.4, 4.0, FRONT + 0.01))
    return g
  },
  sim: {
    transient: true,
    maxDt: MAX_DT,
    controls: [
      { key: 'wave', kind: 'buttons', label: 'Waveform', rows: [['Sine', 'Square', 'Triangle']] },
      { key: 'frequency', kind: 'slider', label: 'Freq', min: 1, max: F_MAX, step: 1, unit: 'Hz', default: 100 },
      { key: 'amplitude', kind: 'slider', label: 'Ampl', min: 0, max: V_LIM, step: 0.1, unit: 'V', default: 2 },
      { key: 'offset', kind: 'slider', label: 'Offset', min: -5, max: 5, step: 0.1, unit: 'V', default: 0 },
    ],
    circuit(api) {
      const src = api.add(vsource(api.pin('POS'), api.pin('NEG'), 0, R_OUT))
      const w = api.prop('waveform')
      return { src, wave: WAVES.includes(w) ? w : 'sine', iPeak: 0, ePeak: 0, lastDt: 0, e: 0 }
    },
    beforeStep(h, api, dt) {
      const b = BUTTON_WAVE[api.control('wave')]
      if (b) h.wave = b
      h.f = num(api.control('frequency') ?? api.prop('frequency'), F_MIN, F_MAX)
      h.amp = num(api.control('amplitude') ?? api.prop('amplitude'), 0, V_LIM)
      h.off = num(api.control('offset') ?? api.prop('offset'), -5, 5)
      const t = api.t + dt
      const p = (h.f * t) % 1
      h.e = Math.max(-V_LIM, Math.min(V_LIM, h.off + h.amp * waveAt(h.wave, p)))
      h.src.V = h.e
      if (dt > 0) h.lastDt = dt
    },
    afterStep(h, api) {
      h.iPeak = Math.max(h.iPeak, Math.abs(api.cur(h.src)))
      h.ePeak = Math.max(h.ePeak, Math.abs(h.e))
    },
    solved(h, api) {
      const name = api.obj.name || 'Function generator'
      const v = api.vpin('POS') - api.vpin('NEG'), i = api.cur(h.src)
      const iPk = h.iPeak, ePk = h.ePeak
      h.iPeak = 0; h.ePeak = 0
      if (ePk > 0.2 && iPk > 0.8 * ePk / R_OUT) api.issue('short', 'warning', `${name} output is shorted (${fmtSI(iPk, 'A')} peak)`,
        `Almost all of the signal is lost across the generator's own ${R_OUT} Ω output resistance — the load between + and − is close to 0 Ω. Check for a wire across the outputs; use at least ≈1 kΩ of load for a clean signal.`)
      else api.clearIssue('short')
      const ppp = h.lastDt > 0 ? 1 / (h.f * h.lastDt) : Infinity
      if (ppp < 20) api.issue('aliasing', 'warning', `${name}: ${fmtSI(h.f, 'Hz')} is too fast for the simulation step`,
        `The solver samples only ${ppp.toFixed(0)} points per period, so the waveform and anything it drives are coarse. Lower the frequency.`)
      else api.clearIssue('aliasing')
      return { voltage: v, current: i, emf: h.e, wave: h.wave, frequency: h.f, amplitude: h.amp, offset: h.off }
    },
    readout: ({ solved }) => (solved ? `${solved.wave} ${fmtSI(solved.frequency, 'Hz')} · ${solved.amplitude.toFixed(2)} Vp · ${solved.offset >= 0 ? '+' : ''}${solved.offset.toFixed(2)} V` : null),
    visual(root, { solved, off }) {
      const scr = root.getObjectByName('display')
      if (off || !solved) { lcdText(scr, '', { fg: '#7dd3fc' }); return }
      lcdText(scr, fmtSI(solved.frequency, 'Hz'), { fg: '#7dd3fc', sub: `${solved.wave}  ${solved.amplitude.toFixed(2)} Vp  ${solved.offset.toFixed(2)} V off` })
    },
  },
  tests: [
    {
      name: 'RC low-pass at its corner frequency attenuates by 1/√2 (1 kΩ + 50 Ω, 1 µF, f = 151.6 Hz)',
      run(kit) {
        // fc = 1 / (2π·(1000 + 50)·1 µF) = 151.58 Hz. With the scope's 1 MΩ input:
        // |H| = (1e6/(1e6+1050)) / √(1 + (ω·C·(1050∥1e6))²) = 0.70674.
        // Backward Euler at the frame-limited step (≈41.7 µs) reads ≈1 % low.
        const fc = 1 / (2 * Math.PI * 1050 * 1e-6)
        kit.scene({ G: { type: 'function_generator', waveform: 'sine', frequency: fc, amplitude: 2 }, R: { type: 'resistor', resistance: 1000 },
          S: { type: 'oscilloscope', tdiv: 0.002, vdiv: 0.5 } },
          [['G:POS', 'R:1'], ['R:2', 'S:POS'], ['S:NEG', 'G:NEG']])
        // No capacitor part in this folder: stamp a real 1 µF MNA capacitor on the same nodes.
        const sim = kit.bridge.sim
        sim.circuit.add(capacitor(sim.nodeOf('R:2'), sim.nodeOf('G:NEG'), 1e-6))
        kit.step(0.4)
        const s = kit.state('S')
        kit.near(s.vpp / 2 / 2, 0.70674, 0.015, 'gain at fc')
        kit.near(s.period, 1 / fc, 1e-4, 'period')
      },
    },
    {
      name: 'triangle 1 V peak on a +2 V offset swings 1 V … 3 V on a 1 MΩ scope',
      run(kit) {
        kit.scene({ G: { type: 'function_generator', waveform: 'triangle', frequency: 50, amplitude: 1, offset: 2 }, S: { type: 'oscilloscope', tdiv: 0.005, vdiv: 1 } },
          [['G:POS', 'S:POS'], ['G:NEG', 'S:NEG']])
        kit.step(0.2)
        const k = 1e6 / (1e6 + 50)
        kit.near(kit.state('S').vmax, 3 * k, 0.01)
        kit.near(kit.state('S').vmin, 1 * k, 0.01)
        kit.near(kit.state('S').vavg, 2 * k, 0.01)
      },
    },
    {
      name: '50 Ω output: a 50 Ω load halves the amplitude; a wire across the posts is flagged',
      run(kit) {
        kit.scene({ G: { type: 'function_generator', waveform: 'square', frequency: 50, amplitude: 4 }, R: { type: 'resistor', resistance: 50 },
          S: { type: 'oscilloscope', tdiv: 0.005, vdiv: 1 } },
          [['G:POS', 'R:1'], ['R:2', 'G:NEG'], ['S:POS', 'R:1'], ['S:NEG', 'G:NEG']])
        kit.step(0.1)
        // 4 V · (50 ∥ 1 MΩ) / (50 + 50 ∥ 1 MΩ) = 1.99995 V
        kit.near(kit.state('S').vmax, 2.0, 0.005)
        kit.ok(!kit.hasIssue('G:short'))
        kit.scene({ G: { type: 'function_generator', waveform: 'square', frequency: 50, amplitude: 4 } }, [['G:POS', 'G:NEG']])
        kit.step(0.1)
        kit.ok(kit.hasIssue('G:short'), 'short warning (4 V / 50 Ω = 80 mA)')
      },
    },
  ],
})
