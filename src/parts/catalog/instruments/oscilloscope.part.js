// Single-channel digital oscilloscope (Tinkercad "Oscilloscope"), bench DSO
// body ≈ 361 W × 170 H × 130 D mm (Rigol DS1000Z class) with a 7" screen,
// + probe and − probe (ground clip) posts beside the channel input.
//
// Input: 1 MΩ between + and − (standard scope input; the ≈15 pF input
// capacitance is negligible at the ≤1 kHz this simulator can resolve and is
// left out). After every solver sub-step (afterStep — the scope makes the
// circuit transient) the probe voltage is recorded into a ring buffer, with a
// sample spacing of (10 · time/div) / 1000. Each frame the part reports
// min / max / mean / Vpp and the period from interpolated rising crossings of
// the mid level, and draws a rising-edge-triggered trace on its screen.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, TIN, textPlane, fmtSI } from '../../model.js'
import { screenMesh, drawScreen, fmt4 } from './screen.js'

const R_IN = 1e6, CAP = 4096, DIVX = 10, DIVY = 8
const W = 36.1, H = 17.0, BODY_D = 12.0, POST_L = 1.0
const FRONT = BODY_D / 2 - 0.5                    // body z ∈ [−6.5, 5.5]; posts to 6.5
const POST_Y = 2.6, POST_X = [13.0, 15.4]
const TDIVS = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]
const VDIVS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]
const tLabel = (s) => fmtSI(s, 's') + '/div'

/** Ordered view of the ring buffer: i = 0 is the oldest sample. */
function at_(buf, i) { return (buf.head - buf.n + i + CAP) % CAP }

function analyse(buf, W_) {
  const n = buf.n
  if (n < 2) return { vmin: NaN, vmax: NaN, vavg: NaN, vpp: NaN, period: NaN, freq: NaN, tStart: 0 }
  let vmin = Infinity, vmax = -Infinity, sum = 0
  for (let i = 0; i < n; i++) { const v = buf.v[at_(buf, i)]; if (v < vmin) vmin = v; if (v > vmax) vmax = v; sum += v }
  const vpp = vmax - vmin, mid = (vmax + vmin) / 2, hyst = 0.05 * vpp
  const cross = []
  if (vpp > 1e-6) {
    let armed = false
    for (let i = 1; i < n; i++) {
      const a = at_(buf, i - 1), b = at_(buf, i)
      const v0 = buf.v[a], v1 = buf.v[b]
      if (v1 < mid - hyst) armed = true
      if (armed && v0 < mid && v1 >= mid) {
        const f = (mid - v0) / (v1 - v0)
        cross.push(buf.t[a] + f * (buf.t[b] - buf.t[a]))
        armed = false
      }
    }
  }
  const period = cross.length >= 2 ? (cross[cross.length - 1] - cross[0]) / (cross.length - 1) : NaN
  const tLast = buf.t[at_(buf, n - 1)]
  let tStart = tLast - W_
  for (let k = cross.length - 1; k >= 0; k--) if (cross[k] <= tLast - W_) { tStart = cross[k]; break }
  // Cycle mean (as a scope's "Mean (cycle)" measurement): with a whole period in
  // the buffer, average only between the first and last rising crossing, so a
  // partial period never shows up as a false DC offset. DC / aperiodic: plain mean.
  let vavg = sum / n
  if (cross.length >= 2) {
    let s = 0, k = 0
    for (let i = 0; i < n; i++) { const j = at_(buf, i), t = buf.t[j]; if (t >= cross[0] && t < cross[cross.length - 1]) { s += buf.v[j]; k++ } }
    if (k > 0) vavg = s / k
  }
  return { vmin, vmax, vavg, vpp, period, freq: period > 0 ? 1 / period : NaN, tStart }
}

export default definePart({
  type: 'oscilloscope',
  label: 'Oscilloscope',
  shortName: 'Scope',
  tinkercad: 'Oscilloscope',
  category: 'instruments',
  icon: '📈',
  desc: '1 channel · 1 MΩ input · 0.1 ms–1 s/div · 10 mV–10 V/div',
  purpose: 'Draws a voltage against time. Clip the − probe to the circuit\'s reference (usually GND) and touch the + probe to the point you want to see. Set time/div and volts/div in Properties so a few cycles fill the screen. The sim bar shows Vpp and frequency.',
  usage: 'watching PWM · checking a 555 or a filter · seeing a function generator\'s signal',
  spec: {
    dims_mm: { w: 361, h: 170, d: 130 }, mass_kg: 3.2,
    input_ohm: R_IN, divisions: [DIVX, DIVY], buffer_samples: CAP,
    summary: '1 MΩ input between + and − probes; records the probe voltage every solver step and triggers on the rising edge.',
  },
  props: {
    tdiv: { type: 'select', label: 'Time / div', default: 0.002, options: TDIVS.map(t => ({ value: t, label: tLabel(t) })) },
    vdiv: { type: 'select', label: 'Volts / div', default: 1, options: VDIVS.map(v => ({ value: v, label: fmtSI(v, 'V') + '/div' })) },
  },
  pins: [
    { name: 'POS', kind: 'passive', label: '+ probe', x: POST_X[1], y: POST_Y, z: FRONT + POST_L, r: 0.3 },
    { name: 'NEG', kind: 'gnd', label: '− probe', x: POST_X[0], y: POST_Y, z: FRONT + POST_L, r: 0.3, ldy: 0.35 },
  ],
  build() {
    const g = new Group()
    g.add(box(W, H, BODY_D, mat(0xe5e7eb, { rough: 0.6 }), 0, H / 2, -0.5))                        // case
    g.add(box(W - 0.4, H - 0.4, 0.2, mat(0x2d3748, { rough: 0.6 }), 0, H / 2, FRONT - 0.1))          // front panel
    g.add(box(16.6, 9.8, 0.1, mat(0x050505), -7.8, 10.0, FRONT + 0.05))                             // screen bezel
    const scr = screenMesh('screen', 15.6, 8.8, { pxW: 400, pxH: 226, bg: '#06120c' })
    g.add(at(scr, -7.8, 10.0, FRONT + 0.11))
    // Control knobs (V/div, time/div, trigger) and soft keys
    for (const [x, y, r] of [[5.0, 12.0, 1.0], [9.0, 12.0, 1.0], [13.0, 12.0, 0.8], [5.0, 7.5, 0.7], [9.0, 7.5, 0.7]]) {
      g.add(at(cyl(r, 0.9, mat(0x111827, { rough: 0.4 }), { axis: 'z', seg: 28 }), x, y, FRONT + 0.45))
    }
    for (let i = 0; i < 5; i++) g.add(box(1.4, 0.7, 0.3, mat(0x9ca3af), -14.0 + i * 3.1, 3.4, FRONT + 0.15))
    // CH1 BNC + probe posts (black −, yellow +)
    g.add(at(cyl(0.6, 0.9, TIN(), { axis: 'z', seg: 20 }), 10.6, POST_Y, FRONT + 0.45))
    for (const [x, color] of [[POST_X[0], 0x111111], [POST_X[1], 0xeab308]]) {
      g.add(at(cyl(0.55, 0.6, mat(color, { rough: 0.4 }), { axis: 'z', seg: 20 }), x, POST_Y, FRONT + 0.3))
      g.add(at(cyl(0.18, POST_L, TIN(), { axis: 'z', seg: 12 }), x, POST_Y, FRONT + POST_L / 2 + 0.25))
    }
    const t = textPlane('CH1  1MΩ', 3.4, 0.6, { fg: '#facc15', bg: null })
    if (t) g.add(at(t, 13.0, 4.2, FRONT + 0.01))
    return g
  },
  sim: {
    transient: true,          // afterStep (the sampler) only runs in transient mode
    circuit(api) {
      const rin = api.add(resistor(api.pin('POS'), api.pin('NEG'), R_IN))
      const tdiv = Number(api.prop('tdiv')) || 0.002
      return { rin, tdiv, vdiv: Number(api.prop('vdiv')) || 1, spacing: (DIVX * tdiv) / 1000, lastT: -Infinity,
        buf: { t: new Float64Array(CAP), v: new Float64Array(CAP), n: 0, head: 0 } }
    },
    afterStep(h, api) {
      const t = api.t
      if (t - h.lastT < h.spacing * 0.999) return
      h.lastT = t
      const b = h.buf
      b.t[b.head] = t; b.v[b.head] = api.vpin('POS') - api.vpin('NEG')
      b.head = (b.head + 1) % CAP
      if (b.n < CAP) b.n++
    },
    solved(h, api) {
      const v = api.vpin('POS') - api.vpin('NEG')
      const st = analyse(h.buf, DIVX * h.tdiv)
      if (api.connected('POS') && !api.connected('NEG')) api.issue('ground', 'warning', `${api.obj.name || 'Oscilloscope'}: the − probe is not connected`,
        'A scope measures between its + probe and its − probe (ground clip). Clip the − probe to the circuit\'s 0 V / GND, or the trace means nothing.')
      else api.clearIssue('ground')
      return { v, ...st, tdiv: h.tdiv, vdiv: h.vdiv, buf: h.buf, n: h.buf.n }
    },
    readout: ({ solved }) => (solved && solved.n > 1
      ? `${fmt4(solved.vpp, 'V')}pp · ${Number.isFinite(solved.freq) ? fmt4(solved.freq, 'Hz') : 'DC ' + fmt4(solved.vavg, 'V')}`
      : null),
    visual(root, { solved, off }) {
      const scr = root.getObjectByName('screen')
      drawScreen(scr, (ctx, w, hgt) => {
        ctx.fillStyle = '#06120c'; ctx.fillRect(0, 0, w, hgt)
        ctx.strokeStyle = '#1f3d2c'; ctx.lineWidth = 1
        for (let i = 0; i <= DIVX; i++) { const x = (i / DIVX) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hgt); ctx.stroke() }
        for (let j = 0; j <= DIVY; j++) { const y = (j / DIVY) * hgt; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
        if (off || !solved || solved.n < 2) return
        const b = solved.buf, Wt = DIVX * solved.tdiv
        ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2; ctx.beginPath()
        let started = false
        for (let i = 0; i < b.n; i++) {
          const k = at_(b, i), t = b.t[k]
          if (t < solved.tStart || t > solved.tStart + Wt) continue
          const x = ((t - solved.tStart) / Wt) * w
          const y = hgt / 2 - (b.v[k] / solved.vdiv) * (hgt / DIVY)
          if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.fillStyle = '#facc15'; ctx.font = `${Math.floor(hgt * 0.07)}px monospace`
        ctx.fillText(`CH1 ${fmtSI(solved.vdiv, 'V')}/div  ${tLabel(solved.tdiv)}`, 6, hgt * 0.08)
        ctx.fillText(`Vpp ${fmt4(solved.vpp, 'V')}  f ${Number.isFinite(solved.freq) ? fmt4(solved.freq, 'Hz') : '--'}`, 6, hgt * 0.96)
      })
    },
  },
  tests: [
    {
      name: 'probing a 100 Hz, 2 V sine: period 10.00 ms, Vpp = 4·1e6/(1e6 + 50) = 3.9998 V',
      run(kit) {
        kit.scene({ G: { type: 'function_generator', waveform: 'sine', frequency: 100, amplitude: 2 }, S: { type: 'oscilloscope', tdiv: 0.002, vdiv: 1 } },
          [['G:POS', 'S:POS'], ['G:NEG', 'S:NEG']])
        kit.step(0.1)
        const s = kit.state('S')
        kit.ok(s.n > 1000, `samples recorded (${s.n})`)
        kit.near(s.period, 0.010, 2e-5, 'period')
        kit.near(s.freq, 100, 0.2, 'frequency')
        kit.near(s.vpp, 4 * 1e6 / (1e6 + 50), 0.005, 'Vpp')
        kit.near(s.vavg, 0, 0.02, 'no DC')
      },
    },
    {
      name: '50 Hz square, 5 V peak, +1 V offset: +6 V / −4 V levels, 20 ms period',
      run(kit) {
        kit.scene({ G: { type: 'function_generator', waveform: 'square', frequency: 50, amplitude: 5, offset: 1 }, S: { type: 'oscilloscope', tdiv: 0.005, vdiv: 2 } },
          [['G:POS', 'S:POS'], ['G:NEG', 'S:NEG']])
        kit.step(0.15)
        const s = kit.state('S'), k = 1e6 / (1e6 + 50)
        kit.near(s.vmax, 6 * k, 0.001)
        kit.near(s.vmin, -4 * k, 0.001)
        kit.near(s.period, 0.020, 1e-4)
      },
    },
    {
      name: 'a 9 V battery is a flat DC line at 9·1e6/(1e6 + 1.7) V (no period)',
      run(kit) {
        kit.scene({ B: 'battery_9v', S: { type: 'oscilloscope', tdiv: 0.001, vdiv: 2 } }, [['B:POS', 'S:POS'], ['B:NEG', 'S:NEG']])
        kit.step(0.05)
        const s = kit.state('S')
        kit.near(s.vavg, 9 * 1e6 / (1e6 + 1.7), 1e-5)
        kit.ok(s.vpp < 1e-6 && !Number.isFinite(s.period), 'no waveform')
      },
    },
    {
      name: 'warns when the − probe (ground clip) is left unconnected',
      run(kit) {
        kit.scene({ B: 'battery_9v', S: 'oscilloscope' }, [['B:POS', 'S:POS']])
        kit.step(0.05)
        kit.ok(kit.hasIssue('S:ground'))
      },
    },
  ],
})
