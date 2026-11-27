// Small epoxy-laminated polycrystalline PV panel, "5 V / 100 mA" class
// (0.5 W, 70 × 55 × 3 mm, 10 cells in series) — Tinkercad "Solar Cell".
//
// Datasheet values used (typical for this class of mini panel, STC 1000 W/m²):
//   Voc = 6.0 V   Isc = 110 mA   Vmp ≈ 5.0 V   Imp ≈ 100 mA   Pmax ≈ 0.5 W
//
// Circuit: the standard single-diode model
//        J ──Rs 2 Ω── POS
//   Iph ↑  ▽ D   ⏚ Rsh 5 kΩ
//      NEG ────────── NEG
// Iph = Isc·(light / 100 %) is a light-controlled current source in parallel
// with the junction diode of the 10 series cells (emission n = 1.3 per cell →
// n_total = 13, n·Vt = 0.336 V). Is is chosen so Voc = 6.0 V at full sun:
//   Is = (Iph − Voc/Rsh) / (exp(Voc / nVt) − 1) = (0.110 − 0.0012) / e^17.853 ≈ 1.92 nA
// Hand checks (tests below):
//   Voc(100 %) = 6.00 V;  Voc(50 %) = nVt·ln((0.055 − 5.76/5000)/Is) ≈ 5.76 V
//   Isc(100 %) ≈ Iph − (Iph·Rs)/Rsh ≈ 109.96 mA
//   50 Ω load: I ≈ 99.6 mA, V ≈ 4.98 V (the rated 5 V / 100 mA point)
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { isource, diode, resistor } from '../../../circuit/mna.js'
import { mat, box, at, textPlane, TIN, fmtSI } from '../../model.js'

const ISC = 0.110, VOC = 6.0, RS = 2.0, RSH = 5000, N_TOTAL = 13
const NVT = N_TOTAL * 0.025852
const IS = (ISC - VOC / RSH) / (Math.exp(VOC / NVT) - 1)
const W = 7.0, D = 5.5, T = 0.3

export default definePart({
  type: 'solar_cell',
  label: 'Solar Cell',
  shortName: 'PV',
  tinkercad: 'Solar Cell',
  category: 'power',
  icon: '☀️',
  desc: '0.5 W mini panel · Voc 6 V · Isc 110 mA',
  purpose: 'Turns light into electricity. In full sun it gives about 6 V with nothing connected and up to ≈110 mA into a short; its best point is ≈5 V at 100 mA. Move the light slider while the simulation runs. Use a blocking diode if it charges a battery, or the battery drains back into it in the dark.',
  usage: 'solar chargers · light-powered LEDs · measuring sunlight',
  spec: {
    dims_mm: { w: 70, h: 3, d: 55 }, mass_kg: 0.02,
    cells: 10, voc_V: VOC, isc_A: ISC, vmp_V: 5.0, imp_A: 0.1, pmax_W: 0.5, rs_ohm: RS, rsh_ohm: RSH,
    summary: 'Single-diode PV model: light → current source ∥ junction diode, 2 Ω series, 5 kΩ shunt. Voc 6 V, Isc 110 mA at 100 % light.',
  },
  props: {
    light: { type: 'number', label: 'Light at start', unit: '%', default: 100, min: 0, max: 100 },
  },
  groundPin: 'NEG',
  pins: [
    { name: 'POS', kind: 'power', label: '+', x: 0.6, y: T + 0.05, z: -D / 2 + 0.35, r: 0.1 },
    { name: 'NEG', kind: 'gnd', label: '−', x: -0.6, y: T + 0.05, z: -D / 2 + 0.35, r: 0.1, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    g.add(box(W, T * 0.6, D, mat(0x1f2937, { rough: 0.6 }), 0, T * 0.3, 0))                    // backing board
    // 10 cells: 2 rows × 5 strips, with silver bus bars between them.
    const cw = (W - 0.6) / 5, cd = (D - 1.2) / 2
    let i = 0
    for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
      const cell = box(cw - 0.08, 0.04, cd - 0.08, mat(0x1e3a8a, { rough: 0.25, metal: 0.4, emissive: 0x000000 }), -W / 2 + 0.3 + cw * (c + 0.5), T * 0.6 + 0.02, -D / 2 + 0.9 + cd * (r + 0.5))
      cell.name = `cell_${i++}`
      g.add(cell)
      g.add(box(0.03, 0.045, cd - 0.1, TIN(), -W / 2 + 0.3 + cw * (c + 0.5), T * 0.6 + 0.025, -D / 2 + 0.9 + cd * (r + 0.5)))
    }
    g.add(box(W, 0.06, D, mat(0xffffff, { rough: 0.05, opacity: 0.15 }), 0, T - 0.03, 0))     // epoxy laminate
    // Solder tabs on the top edge strip.
    for (const x of [0.6, -0.6]) g.add(box(0.4, 0.05, 0.4, TIN(), x, T + 0.025, -D / 2 + 0.35))
    const t = textPlane('+    −', 1.6, 0.3, { fg: '#e5e7eb', bg: null })
    if (t) { t.rotation.x = -Math.PI / 2; g.add(at(t, 0, T + 0.01, -D / 2 + 0.7)) }
    return g
  },
  sim: {
    controls: [{ key: 'light', kind: 'slider', label: 'Light', min: 0, max: 100, step: 1, unit: '%', default: 100 }],
    circuit(api) {
      const pos = api.pin('POS'), neg = api.pin('NEG'), j = api.node()
      const iph = api.add(isource(neg, j, ISC))
      const d = api.add(diode(j, neg, { Is: IS, n: N_TOTAL }))
      api.add(resistor(j, neg, RSH))
      const rs = api.add(resistor(j, pos, RS))
      return { iph, d, rs }
    },
    beforeStep(h, api) {
      const c = api.control('light')
      const light = Math.max(0, Math.min(100, Number(c ?? api.prop('light')) || 0))
      h.light = light
      h.iph.I = ISC * light / 100
    },
    solved(h, api) {
      const v = api.vpin('POS') - api.vpin('NEG')
      const iOut = api.cur(h.rs)                  // (vJ − vPOS)/Rs: A out of + into the circuit
      const name = api.obj.name || 'Solar cell'
      if (iOut < -0.005) api.issue('reverse', 'warning', `${fmtSI(-iOut, 'A')} is flowing back INTO ${name}`,
        'Another source is higher than the panel\'s voltage (e.g. a battery at night) and discharges through the cells. Put a blocking diode (1N5819 Schottky) in series with the + lead.')
      else api.clearIssue('reverse')
      if (v < -0.5) api.issue('polarity', 'warning', `${name} is reverse-biased (${v.toFixed(2)} V)`,
        'Something drives its − terminal above +. Check the polarity of the panel and the other sources.')
      else api.clearIssue('polarity')
      return { voltage: v, current: iOut, power: v * iOut, light: h.light }
    },
    readout: ({ solved }) => (solved ? `${solved.light}% · ${solved.voltage.toFixed(2)} V · ${fmtSI(solved.current, 'A')}` : null),
    visual(root, { solved, off }) {
      const k = off || !solved ? 0 : solved.light / 100
      for (let i = 0; i < 10; i++) {
        const c = root.getObjectByName(`cell_${i}`)
        if (c?.material?.color) c.material.color.setHSL(0.62, 0.65, 0.18 + 0.12 * k)
      }
    },
  },
  tests: [
    {
      name: 'open circuit at full sun: Voc = 6.00 V (datasheet)',
      run(kit) {
        kit.scene({ P: 'solar_cell' })
        kit.step(0.05)
        kit.near(kit.state('P').voltage, 6.0, 0.02, 'Voc')
        kit.near(kit.state('P').current, 0, 1e-6)
      },
    },
    {
      name: 'short circuit at full sun: Isc ≈ 110 mA (datasheet); half light halves it',
      run(kit) {
        kit.scene({ P: 'solar_cell' }, [['P:POS', 'P:NEG']])
        kit.step(0.05)
        kit.near(kit.state('P').current, 0.10996, 2e-4, 'Isc at 100 %')
        kit.control('P', 'light', 50); kit.step(0.05)
        kit.near(kit.state('P').current, 0.05498, 2e-4, 'Isc at 50 %')
      },
    },
    {
      name: 'Voc falls only logarithmically with light: 50 % → ≈5.76 V; dark → 0 V',
      run(kit) {
        kit.scene({ P: { type: 'solar_cell', light: 50 } })
        kit.step(0.05)
        kit.near(kit.state('P').voltage, 5.764, 0.02, 'Voc at 50 %')
        kit.control('P', 'light', 0); kit.step(0.05)
        kit.near(kit.state('P').voltage, 0, 1e-3, 'Voc in the dark')
      },
    },
    {
      name: 'rated point: a 50 Ω load at full sun gets ≈4.98 V at ≈99.6 mA (≈0.5 W)',
      run(kit) {
        kit.scene({ P: 'solar_cell', R: { type: 'resistor', resistance: 50 } }, [['P:POS', 'R:1'], ['R:2', 'P:NEG']])
        kit.step(0.05)
        kit.near(kit.state('P').current, 0.0996, 0.0015, 'I at the rated point')
        kit.near(kit.state('P').voltage, 4.98, 0.08, 'V at the rated point')
        kit.between(kit.state('P').power, 0.48, 0.51, 'power')
      },
    },
    {
      name: 'in the dark a 6 V pack wired straight across discharges into it (reverse-current warning)',
      run(kit) {
        kit.scene({ P: { type: 'solar_cell', light: 0 }, B: 'battery_pack_4aa' }, [['P:POS', 'B:POS'], ['P:NEG', 'B:NEG']])
        kit.step(0.05)
        kit.ok(kit.state('P').current < -0.005, `current flows into the panel (${kit.state('P').current} A)`)
        kit.ok(kit.hasIssue('P:reverse'), 'reverse-current warning')
      },
    },
  ],
})
