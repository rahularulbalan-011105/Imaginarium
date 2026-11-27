// Ceramic disc capacitor (Tinkercad "Capacitor"), default 100 nF "104", 50 V.
// Typical 100 nF / 50 V Y5V/X7R disc (e.g. Vishay K104 / TDK FG series
// radial): disc Ø5.0 mm max, 2.5 mm thick, leads Ø0.5 mm at 5.08 mm (0.2")
// spacing. Non-polarised.
// Circuit model: ideal capacitor (backward-Euler companion in the solver).
// Ceramic ESR (≈ tens of mΩ) and leakage (> 10 GΩ) are negligible here.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { capacitor } from '../../../circuit/mna.js'
import { mat, cyl, at, lead, textPlane, fmtSI } from '../../model.js'

const HALF = 0.254, DISC_R = 0.25, DISC_T = 0.25, DISC_Y = 0.55

/** EIA 3-digit code: 100 nF → "104". */
function capCode(nF) {
  const pF = nF * 1000
  if (!(pF >= 10)) return `${+pF.toPrecision(2)}p`
  const exp = Math.floor(Math.log10(pF)) - 1
  return `${Math.round(pF / 10 ** exp)}${exp}`
}

export default definePart({
  type: 'capacitor',
  label: 'Capacitor',
  shortName: 'C',
  tinkercad: 'Capacitor',
  category: 'basic',
  icon: '⊣⊢',
  desc: 'Ceramic disc · 100 nF (104) · 50 V',
  purpose: 'Stores a little charge. Either way round. A 100 nF ("104") next to a chip\'s power pins smooths out fast glitches; with a resistor it makes an RC delay (τ = R·C). Do not exceed its rated voltage.',
  usage: 'decoupling · debouncing · RC timing and filters',
  spec: {
    dims_mm: { w: 5.1, h: 8.0, d: 2.5 }, mass_kg: 0.0003,
    summary: 'Ceramic disc, non-polarised. Charges through a resistor with time constant τ = R·C.',
  },
  props: {
    capacitance: { type: 'number', label: 'Capacitance', unit: 'nF', default: 100, min: 0.001, max: 2200 },
    ratedVoltage: { type: 'number', label: 'Rated voltage', unit: 'V', default: 50, min: 4, max: 3000 },
  },
  rebuildOn: ['capacitance'],
  pins: [
    { name: '1', kind: 'passive', x: -HALF, y: 0.02, z: 0, r: 0.06, label: '1' },
    { name: '2', kind: 'passive', x: HALF, y: 0.02, z: 0, r: 0.06, label: '2', ldy: 0.25 },
  ],
  build(obj) {
    const g = new Group()
    const glaze = mat(0xc8742a, { rough: 0.45 })
    g.add(at(cyl(DISC_R, DISC_T, glaze, { axis: 'z', seg: 32 }), 0, DISC_Y, 0))
    // Dipped coating runs down the leads a little (the "drip").
    for (const s of [-1, 1]) g.add(at(cyl(0.045, 0.12, glaze, { seg: 10 }), s * 0.16, DISC_Y - DISC_R + 0.02, 0))
    const t = textPlane(capCode(obj.capacitance ?? 100), 0.3, 0.14, { fg: '#2a1a0a', bg: null })
    if (t) g.add(at(t, 0, DISC_Y, DISC_T / 2 + 0.002))
    for (const s of [-1, 1]) {
      g.add(lead([s * 0.16, DISC_Y - 0.1, 0], [s * 0.16, 0.3, 0], { r: 0.025 }))
      g.add(lead([s * 0.16, 0.3, 0], [s * HALF, 0.2, 0], { r: 0.025 }))   // kinked leads
      g.add(lead([s * HALF, 0.2, 0], [s * HALF, 0, 0], { r: 0.025 }))
    }
    return g
  },
  sim: {
    transient: true,
    circuit(api) {
      const C = api.prop('capacitance') * 1e-9
      return { c: api.add(capacitor(api.pin('1'), api.pin('2'), C)), C, vPrev: 0, i: 0 }
    },
    // The solver commits the capacitor's state at the end of each step, so the
    // current is taken from the voltage change over that step: i = C·dv/dt.
    afterStep(h, api, dt) {
      const v = api.vpin('1') - api.vpin('2')
      h.i = dt > 0 ? h.C * (v - h.vPrev) / dt : 0
      h.vPrev = v
    },
    solved(h, api) {
      const v = api.vpin('1') - api.vpin('2')
      const vr = api.prop('ratedVoltage')
      if (Math.abs(v) > vr) api.issue('overvoltage', 'error', `${api.obj.name || 'Capacitor'} has ${Math.abs(v).toFixed(1)} V across it`,
        `It is rated ${vr} V. Above that the ceramic dielectric can crack or short. Use a capacitor with a higher voltage rating.`)
      else api.clearIssue('overvoltage')
      return { voltage: v, current: h.i, charge: h.C * v, energy: 0.5 * h.C * v * v }
    },
    readout({ solved }) { return solved ? fmtSI(solved.voltage, 'V') : '' },
  },
  tests: [
    {
      name: 'RC charge: 100 kΩ + 100 nF from D13 reaches 63 % in one τ (≈10 ms)',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 100000 }, C: 'capacitor' },
          [['U:D13', 'R:1'], ['R:2', 'C:1'], ['C:2', 'U:GND1'], ['C:1', 'U:A0']])
        kit.pinMode(13, 'output'); kit.pinMode(14, 'input'); kit.write(13, 1)
        kit.step(0.01)
        // Thevenin of pin (5 V, 25 Ω) + 100 kΩ against A0's 10 MΩ input leakage:
        // V∞ = 5·10M/10.1M = 4.950 V, R = 99.0 kΩ → τ = 99.0 kΩ · 100 nF = 9.90 ms.
        // V(10 ms) = 4.950 · (1 − e^(−10/9.90)) = 3.150 V.
        kit.near(kit.state('C').voltage, 3.150, 0.05, 'voltage after 10 ms')
        // i = (V∞ − V)/R = (4.950 − 3.150) / 99.0 kΩ ≈ 18 µA, still flowing in.
        kit.near(kit.state('C').current, 18.2e-6, 1.5e-6, 'charging current')
        kit.step(0.1)
        kit.near(kit.state('C').voltage, 4.950, 0.01, 'fully charged after ≫ 5 τ')
        kit.near(kit.analogRead(14), Math.round(4.95 / 5 * 1023), 2, 'analogRead(A0)')
      },
    },
    {
      name: 'discharges with the same τ when the pin goes LOW',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 100000 }, C: 'capacitor' },
          [['U:D13', 'R:1'], ['R:2', 'C:1'], ['C:2', 'U:GND1']])
        kit.pinMode(13, 'output'); kit.write(13, 1); kit.step(0.2)
        kit.near(kit.state('C').voltage, 5, 0.01, 'charged to 5 V')
        kit.write(13, 0); kit.step(0.01)
        // V(t) = 5 · e^(−10 ms / 10.0 ms) = 1.84 V.
        kit.near(kit.state('C').voltage, 5 * Math.exp(-0.01 / (100025 * 100e-9)), 0.05, 'voltage after one τ')
      },
    },
    {
      name: 'raises an over-voltage error above its rating (a 4 V part on 5 V)',
      run(kit) {
        kit.scene({ U: 'arduino', C: { type: 'capacitor', ratedVoltage: 4 } }, [['C:1', 'U:5V'], ['C:2', 'U:GND1']])
        kit.step(0.02)
        kit.near(kit.state('C').voltage, 5, 0.01)
        kit.ok(kit.hasIssue('C:overvoltage'), 'over-voltage issue')
      },
    },
  ],
})
