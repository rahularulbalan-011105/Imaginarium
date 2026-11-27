// 9 V alkaline battery, IEC 6LR61 / ANSI 1604A (Tinkercad "9V Battery").
// Body 48.5 × 26.5 × 17.5 mm (IEC 60086 max) including the snap terminals on
// top: the smaller round stud is + , the larger hexagonal socket is − ,
// 12.7 mm (0.5") apart. Six 1.5 V alkaline cells in series inside.
// Internal resistance ≈ 1.7 Ω fresh (Energizer 522 datasheet: 1.5–2 Ω at 25 °C),
// so a dead short draws ≈ 9 / 1.7 ≈ 5.3 A. Continuous drains above ≈ 0.5 A are
// outside the datasheet's discharge curves.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, box, cyl, at, textPlane, TIN } from '../../model.js'
import { batterySim, batteryReadout } from './battery.js'

const V = 9.0, R_INT = 1.7, I_MAX = 0.5
const W = 2.65, D = 1.75, BODY_H = 4.6, TERM_H = 0.25, SNAP_X = 0.635

export default definePart({
  type: 'battery_9v',
  label: '9V Battery',
  shortName: '9V',
  tinkercad: '9V Battery',
  category: 'power',
  icon: '🔋',
  desc: '6LR61 alkaline · 9 V · ≈1.7 Ω',
  purpose: 'A 9 V source for circuits with no Arduino, or to power one through VIN. Wire + (round stud) and − (hexagonal socket). It has ≈1.7 Ω inside, so its voltage sags under heavy load and a short circuit draws ≈5 A — the simulator flags that.',
  usage: 'stand-alone LED / motor circuits · Arduino VIN · 555 timers',
  spec: {
    dims_mm: { w: 26.5, h: 48.5, d: 17.5 }, mass_kg: 0.045,
    chemistry: 'alkaline Zn/MnO2, 6 cells', emf_V: V, rInt_ohm: R_INT, capacity_mAh: 550,
    summary: '9 V EMF behind 1.7 Ω internal resistance (fresh alkaline). Terminal voltage V = 9 − 1.7·I.',
  },
  groundPin: 'NEG',
  pins: [
    { name: 'POS', kind: 'power', label: '+', x: SNAP_X, y: BODY_H + TERM_H, z: 0, r: 0.12 },
    { name: 'NEG', kind: 'gnd', label: '−', x: -SNAP_X, y: BODY_H + TERM_H, z: 0, r: 0.12, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    // Steel can with a printed wrap (black lower, copper upper like most alkalines).
    g.add(box(W, BODY_H * 0.62, D, mat(0x1b1b1b, { rough: 0.5, metal: 0.2 }), 0, BODY_H * 0.31, 0))
    g.add(box(W, BODY_H * 0.38, D, mat(0xb8732e, { rough: 0.4, metal: 0.4 }), 0, BODY_H * 0.62 + BODY_H * 0.19, 0))
    g.add(box(W * 0.96, 0.08, D * 0.94, mat(0x2a2a2a, { rough: 0.7 }), 0, BODY_H - 0.04, 0))     // top cap plastic
    // + : small round male stud
    const pos = cyl(0.29, TERM_H, TIN(), { seg: 20 })
    g.add(at(pos, SNAP_X, BODY_H + TERM_H / 2, 0))
    g.add(at(cyl(0.21, 0.04, mat(0x9aa0a6, { metal: 0.9, rough: 0.3 })), SNAP_X, BODY_H + TERM_H + 0.01, 0))
    // − : larger hexagonal female socket with a dark hole
    const neg = cyl(0.42, TERM_H, TIN(), { seg: 6 })
    g.add(at(neg, -SNAP_X, BODY_H + TERM_H / 2, 0))
    g.add(at(cyl(0.27, 0.02, mat(0x111111)), -SNAP_X, BODY_H + TERM_H + 0.005, 0))
    const t = textPlane('9V', W * 0.7, 0.7, { fg: '#f5f5f5', bg: null })
    if (t) g.add(at(t, 0, BODY_H * 0.35, D / 2 + 0.002))
    const s = textPlane('+   −', W * 0.8, 0.4, { fg: '#ffffff', bg: null })
    if (s) { s.rotation.y = 0; g.add(at(s, 0, BODY_H * 0.8, D / 2 + 0.002)) }
    return g
  },
  sim: { ...batterySim({ V, rInt: R_INT, iMax: I_MAX, what: '9 V battery' }), readout: batteryReadout },
  tests: [
    {
      name: '1 kΩ load with no Arduino: I = 9 / (1000 + 1.7) = 8.985 mA',
      run(kit) {
        kit.scene({ B: 'battery_9v', R: { type: 'resistor', resistance: 1000 } }, [['B:POS', 'R:1'], ['R:2', 'B:NEG']])
        kit.step(0.05)
        kit.near(kit.state('B').current, 9 / 1001.7, 1e-6, 'battery current')
        kit.near(kit.state('R').voltage, 9 * 1000 / 1001.7, 1e-3, 'voltage across R')
        kit.near(kit.vpin('B', 'NEG'), 0, 1e-9, 'the − terminal is the 0 V reference')
        kit.ok(!kit.hasIssue('B:short') && !kit.hasIssue('B:overload'), 'no issue on a normal load')
      },
    },
    {
      name: 'sags under a heavy load: 8 Ω motor gets 9·8/9.7 = 7.42 V at 0.93 A (overload warning)',
      run(kit) {
        kit.scene({ B: 'battery_9v', M: 'motor_dc' }, [['B:POS', 'M:TERM_A'], ['M:TERM_B', 'B:NEG']])
        kit.step(0.05)
        kit.near(kit.state('B').voltage, 9 * 8 / 9.7, 0.01, 'terminal voltage')
        kit.near(kit.state('B').current, 9 / 9.7, 0.005, 'current')
        kit.ok(kit.hasIssue('B:overload'), '0.93 A is above a 9 V battery\'s ≈0.5 A continuous rating')
      },
    },
    {
      name: 'a wire across the terminals is a short circuit: 9 / 1.7 = 5.3 A, flagged as an error',
      run(kit) {
        kit.scene({ B: 'battery_9v' }, [['B:POS', 'B:NEG']])
        kit.step(0.05)
        kit.near(kit.state('B').current, 9 / 1.7, 0.01, 'short-circuit current')
        kit.ok(kit.hasIssue('B:short'), 'short-circuit issue')
      },
    },
    {
      name: 'powers an Arduino-referenced LED: + to an LED via 470 Ω, − to GND',
      run(kit) {
        kit.scene({ U: 'arduino', B: 'battery_9v', R: { type: 'resistor', resistance: 470 }, L: 'led' },
          [['B:POS', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND1'], ['B:NEG', 'U:GND2']])
        kit.step(0.05)
        // (9 − ≈1.95 V red LED) / (470 + 1.7) ≈ 15 mA
        kit.between(kit.state('L').current, 0.0140, 0.0155, 'LED current')
      },
    },
  ],
})
