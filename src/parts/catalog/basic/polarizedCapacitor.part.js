// Radial aluminium electrolytic capacitor (Tinkercad "Polarized Capacitor"),
// default 100 µF 25 V. Panasonic EEU-FC1E101 (FC series): case Ø6.3 × 11 mm,
// lead spacing 2.5 mm, Ø0.5 mm leads, ESR ≈ 0.3 Ω (100 kHz… impedance 0.30 Ω
// max at 20 °C), leakage ≤ 0.01·C·V or 3 µA (= 25 µA for 100 µF 25 V).
// The grey stripe with "−" marks the negative lead (also the shorter one).
// Circuit model: ESR in series with C, leakage resistance in parallel
// (R_leak = V_R / (0.01·C·V_R) = 1 / (0.01·C) Ω with C in µF → 1 MΩ at 100 µF).
import { Group, Mesh, CylinderGeometry } from 'three'
import { definePart } from '../../definePart.js'
import { capacitor, resistor } from '../../../circuit/mna.js'
import { mat, cyl, at, box, lead, fmtSI } from '../../model.js'

const HALF = 0.125, R = 0.315, H = 1.1, LIFT = 0.15
const RATINGS = [6.3, 10, 16, 25, 35, 50, 63, 100]

export default definePart({
  type: 'polarized_capacitor',
  label: 'Polarized Capacitor',
  shortName: 'C',
  tinkercad: 'Polarized Capacitor',
  category: 'basic',
  icon: '⊣(',
  desc: 'Electrolytic · 100 µF · 25 V · radial Ø6.3 × 11 mm',
  purpose: 'A large capacitor for smoothing supplies and slow RC timing. It is POLARISED: the stripe (−) lead goes to the lower voltage (GND). Reversed, or above its rated voltage, a real one heats up, bulges and can vent.',
  usage: 'supply smoothing · bulk decoupling for motors/servos · slow RC timers',
  spec: {
    dims_mm: { w: 6.3, h: 12.5, d: 6.3 }, mass_kg: 0.0006, esr_ohm: 0.3,
    summary: 'Electrolytic, polarised: + (long lead) to the higher voltage, stripe (−) to GND. τ = R·C.',
  },
  props: {
    capacitance: { type: 'number', label: 'Capacitance', unit: 'µF', default: 100, min: 0.1, max: 10000 },
    ratedVoltage: { type: 'select', label: 'Rated voltage', unit: 'V', default: 25, options: RATINGS.map(v => ({ value: v, label: `${v} V` })) },
  },
  pins: [
    { name: 'ANODE', kind: 'passive', x: HALF, y: 0.02, z: 0, r: 0.06, label: '+' },
    { name: 'CATHODE', kind: 'passive', x: -HALF, y: 0.02, z: 0, r: 0.06, label: '−', ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    g.add(at(cyl(R * 0.92, LIFT, mat(0x1a1a1a, { rough: 0.9 })), 0, LIFT / 2, 0))                  // rubber bung
    g.add(at(cyl(R, H, mat(0x1d3d8f, { rough: 0.45 }), { seg: 32 }), 0, LIFT + H / 2, 0))          // sleeve
    // Negative stripe: a grey band of the sleeve on the −X side.
    const stripe = new Mesh(new CylinderGeometry(R * 1.01, R * 1.01, H * 0.98, 16, 1, true, -Math.PI / 2 - 0.45, 0.9), mat(0xb9c0c8, { rough: 0.5 }))
    g.add(at(stripe, 0, LIFT + H / 2, 0))
    for (let i = 0; i < 3; i++) g.add(box(0.03, 0.08, 0.02, mat(0x1d3d8f), -R * 1.02, LIFT + 0.3 + i * 0.25, 0))  // "−" marks
    g.add(at(cyl(R * 0.94, 0.02, mat(0xc9cdd2, { metal: 0.8, rough: 0.3 })), 0, LIFT + H + 0.005, 0))  // aluminium top
    g.add(box(R * 1.4, 0.01, 0.025, mat(0x6b7280), 0, LIFT + H + 0.016, 0))                           // vent cross
    g.add(box(0.025, 0.01, R * 1.4, mat(0x6b7280), 0, LIFT + H + 0.016, 0))
    g.add(lead([HALF, LIFT, 0], [HALF, 0, 0], { r: 0.025 }))
    g.add(lead([-HALF, LIFT, 0], [-HALF, 0, 0], { r: 0.025 }))
    return g
  },
  sim: {
    transient: true,
    circuit(api) {
      const uF = api.prop('capacitance'), C = uF * 1e-6
      const A = api.pin('ANODE'), K = api.pin('CATHODE'), m = api.node()
      // ESR: FC series ≈ 0.3 Ω at 100 µF; scales roughly as 1/√C across the range.
      const esr = Math.min(10, Math.max(0.02, 0.3 * Math.sqrt(100 / uF)))
      api.add(resistor(A, m, esr))
      const c = api.add(capacitor(m, K, C, { polarized: true }))
      api.add(resistor(A, K, 1e6 * (100 / uF)))
      return { c, C, m, vPrev: 0, i: 0 }
    },
    afterStep(h, api, dt) {
      const v = api.v(h.m) - api.vpin('CATHODE')
      h.i = dt > 0 ? h.C * (v - h.vPrev) / dt : 0
      h.vPrev = v
    },
    solved(h, api) {
      const v = api.vpin('ANODE') - api.vpin('CATHODE')
      const vr = Number(api.prop('ratedVoltage'))
      const name = api.obj.name || 'Capacitor'
      if (v < -1) api.issue('reverse', 'error', `${name} is connected backwards (${v.toFixed(1)} V)`,
        'An electrolytic capacitor must have its + lead at the higher voltage. Reversed it conducts, heats up and can burst. Turn it round: stripe (−) to GND.')
      else api.clearIssue('reverse')
      if (v > vr) api.issue('overvoltage', 'error', `${name} has ${v.toFixed(1)} V across it`,
        `It is rated ${vr} V. Use one rated at least 25 % above the supply.`)
      else api.clearIssue('overvoltage')
      return { voltage: v, current: h.i, charge: h.C * v }
    },
    readout({ solved }) { return solved ? fmtSI(solved.voltage, 'V') : '' },
  },
  tests: [
    {
      name: 'RC charge: 1 kΩ + 100 µF from D13 — τ ≈ 0.1 s, 63 % after one τ',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 1000 }, C: 'polarized_capacitor' },
          [['U:D13', 'R:1'], ['R:2', 'C:ANODE'], ['C:CATHODE', 'U:GND1'], ['C:ANODE', 'U:A0']])
        kit.pinMode(13, 'output'); kit.write(13, 1)
        kit.step(0.1)
        // τ = (1000 + 25 + 0.3 Ω) · 100 µF = 0.1025 s; the 1 MΩ leakage changes V∞ by 0.1 %.
        // V(0.1 s) = 5 · (1 − e^(−0.1/0.1025)) = 3.12 V.
        kit.near(kit.state('C').voltage, 5 * (1 - Math.exp(-0.1 / 0.1025)), 0.05, 'voltage after 0.1 s')
        kit.near(kit.analogRead(14), Math.round(3.12 / 5 * 1023), 12, 'analogRead(A0)')
        kit.ok(!kit.hasIssue('C:reverse') && !kit.hasIssue('C:overvoltage'), 'no issues the right way round')
      },
    },
    {
      name: 'error when wired backwards (stripe to 5 V)',
      run(kit) {
        kit.scene({ U: 'arduino', C: 'polarized_capacitor' }, [['C:CATHODE', 'U:5V'], ['C:ANODE', 'U:GND1']])
        kit.step(0.02)
        kit.near(kit.state('C').voltage, -5, 0.01)
        kit.ok(kit.hasIssue('C:reverse'), 'reverse-polarity issue')
      },
    },
  ],
})
