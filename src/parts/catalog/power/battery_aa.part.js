// AA alkaline cell, IEC LR6 (Ø14.5 × 50.5 mm incl. the + nub) lying on its
// side (Tinkercad "1.5V Battery"). 1.5 V nominal, internal resistance
// ≈0.15 Ω fresh (Energizer E91 datasheet: 150–300 mΩ), so a short draws ≈10 A.
// Above ≈2 A the E91 discharge curves end; we warn there.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, cyl, at, textPlane, TIN } from '../../model.js'
import { batterySim, batteryReadout } from './battery.js'

const V = 1.5, R_INT = 0.15, I_MAX = 2.0
const R = 0.725, BODY_L = 4.9, NUB_L = 0.15, NUB_R = 0.275
const X0 = -(BODY_L + NUB_L) / 2           // − end
const XB = X0 + BODY_L                     // + shoulder

export default definePart({
  type: 'battery_aa',
  label: '1.5V Battery',
  shortName: 'AA',
  tinkercad: '1.5V Battery',
  category: 'power',
  icon: '🔋',
  desc: 'AA (LR6) alkaline · 1.5 V · ≈0.15 Ω',
  purpose: 'One 1.5 V AA cell. Wire the + nub and the flat − end. Very low internal resistance (≈0.15 Ω): it can deliver amps, so a short circuit is dangerous (≈10 A).',
  usage: 'low-voltage motors · bulbs · stack several for more voltage',
  spec: {
    dims_mm: { w: 50.5, h: 14.5, d: 14.5 }, mass_kg: 0.023,
    chemistry: 'alkaline Zn/MnO2', emf_V: V, rInt_ohm: R_INT, capacity_mAh: 2500,
    summary: '1.5 V EMF behind 0.15 Ω. Terminal voltage V = 1.5 − 0.15·I.',
  },
  groundPin: 'NEG',
  pins: [
    { name: 'POS', kind: 'power', label: '+', x: XB + NUB_L, y: R, z: 0, r: 0.12 },
    { name: 'NEG', kind: 'gnd', label: '−', x: X0, y: R, z: 0, r: 0.12 },
  ],
  build() {
    const g = new Group()
    // Printed steel can: black body, copper band at the + end.
    g.add(at(cyl(R, BODY_L * 0.7, mat(0x1b1b1b, { rough: 0.45, metal: 0.3 }), { axis: 'x', seg: 32 }), X0 + BODY_L * 0.35, R, 0))
    g.add(at(cyl(R, BODY_L * 0.3, mat(0xb8732e, { rough: 0.35, metal: 0.5 }), { axis: 'x', seg: 32 }), X0 + BODY_L * 0.85, R, 0))
    // + nub and − flat end (bare steel)
    g.add(at(cyl(NUB_R, NUB_L, TIN(), { axis: 'x', seg: 24 }), XB + NUB_L / 2, R, 0))
    g.add(at(cyl(R * 0.85, 0.02, TIN(), { axis: 'x', seg: 32 }), X0 - 0.005, R, 0))
    g.add(at(cyl(R * 0.97, 0.03, mat(0x9ca3af, { metal: 0.7, rough: 0.3 }), { axis: 'x', seg: 32 }), XB - 0.015, R, 0))
    const t = textPlane('AA 1.5V +', 2.6, 0.5, { fg: '#f5f5f5', bg: null })
    if (t) g.add(at(t, X0 + BODY_L * 0.42, R, R + 0.003))
    return g
  },
  sim: { ...batterySim({ V, rInt: R_INT, iMax: I_MAX, what: 'AA cell' }), readout: batteryReadout },
  tests: [
    {
      name: '10 Ω load: I = 1.5 / 10.15 = 147.8 mA',
      run(kit) {
        kit.scene({ B: 'battery_aa', R: { type: 'resistor', resistance: 10 } }, [['B:POS', 'R:1'], ['R:2', 'B:NEG']])
        kit.step(0.05)
        kit.near(kit.state('B').current, 1.5 / 10.15, 1e-5)
        kit.near(kit.state('B').voltage, 1.5 * 10 / 10.15, 1e-4)
      },
    },
    {
      name: 'a short draws 1.5 / 0.15 = 10 A and is flagged',
      run(kit) {
        kit.scene({ B: 'battery_aa' }, [['B:POS', 'B:NEG']])
        kit.step(0.05)
        kit.near(kit.state('B').current, 10, 0.01)
        kit.ok(kit.hasIssue('B:short'))
      },
    },
    {
      name: 'two cells in series (+ to −) drive 3.0 V into 100 Ω: I = 3 / 100.3 = 29.9 mA',
      run(kit) {
        kit.scene({ A: 'battery_aa', B: 'battery_aa', R: { type: 'resistor', resistance: 100 } },
          [['A:POS', 'B:NEG'], ['B:POS', 'R:1'], ['R:2', 'A:NEG']])
        kit.step(0.05)
        kit.near(kit.state('R').current, 3 / 100.3, 1e-5)
      },
    },
  ],
})
