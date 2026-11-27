// 1N4007 rectifier diode (Tinkercad "Diode"). DO-41 black epoxy body Ø2.7 ×
// 5.2 mm, silver band = cathode, Ø0.86 mm leads bent at 0.4" for a breadboard.
// Ratings (Vishay / ON Semi 1N4001–1N4007 datasheet): V_RRM 1000 V, I_F(AV)
// 1 A, I_FSM 30 A (8.3 ms), V_F ≤ 1.1 V at 1 A.
// Circuit model: the widely used 1N4007 SPICE model IS = 7.03 nA, N = 1.81,
// RS = 0.034 Ω — gives ≈0.66 V at 10 mA and ≈0.93 V at 1 A, matching the
// datasheet's typical forward-characteristic curve.
import { definePart } from '../../definePart.js'
import { addDiode } from '../../../circuit/mna.js'
import { fmtSI } from '../../model.js'
import { do41, DO41_PINS } from './packages.js'

const MODEL = { Is: 7.03e-9, n: 1.81, Rs: 0.034 }
const IF_AV = 1.0, VRRM = 1000

export default definePart({
  type: 'diode',
  label: 'Diode',
  shortName: 'D',
  tinkercad: 'Diode',
  category: 'semis',
  icon: '⊳|',
  desc: '1N4007 rectifier · 1 A 1000 V · DO-41',
  purpose: 'Lets current flow only from anode to cathode (the end with the silver band), dropping ≈0.7 V. Use it for reverse-polarity protection, rectifying, or as a flyback diode across a relay or motor coil (band toward +).',
  usage: 'flyback protection · reverse-polarity protection · rectifiers',
  spec: {
    dims_mm: { w: 11.0, h: 4.35, d: 2.7 }, mass_kg: 0.00035,
    vrrm_V: VRRM, if_A: IF_AV, ifsm_A: 30, vf_V: '1.1 V max at 1 A',
    summary: '1N4007: 1 A, 1000 V. Current flows anode → cathode (band); forward drop ≈0.65–1 V.',
  },
  pins: DO41_PINS,
  build() { return do41() },
  sim: {
    circuit(api) { return { d: addDiode(api, api.pin('ANODE'), api.pin('CATHODE'), MODEL) } },
    solved(h, api) {
      const v = api.vpin('ANODE') - api.vpin('CATHODE')
      const i = api.cur(h.d)
      const name = api.obj.name || 'Diode'
      if (i > IF_AV) api.issue('overcurrent', 'error', `${name} carries ${fmtSI(i, 'A')}`,
        'A 1N4007 is rated 1 A average forward current. It would overheat — add a resistor or use a larger diode.')
      else api.clearIssue('overcurrent')
      if (-v > VRRM) api.issue('reverse', 'error', `${name} is reverse-biased by ${v.toFixed(0)} V`,
        'Above its 1000 V repetitive peak reverse voltage the 1N4007 breaks down and is destroyed.')
      else api.clearIssue('reverse')
      return { vf: v, current: i, power: Math.max(0, v * i), conducting: i > 1e-4 }
    },
  },
  tests: [
    {
      name: 'forward drop ≈0.66 V at ≈9 mA (5 V through 470 Ω)',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 470 }, D: 'diode' },
          [['R:1', 'U:5V'], ['R:2', 'D:ANODE'], ['D:CATHODE', 'U:GND1']])
        kit.step(0.02)
        // I ≈ (5 − 0.66) / 470 = 9.2 mA;  V_F = N·Vt·ln(I/IS) = 1.81 · 25.85 mV · ln(9.2 mA / 7.03 nA) ≈ 0.66 V.
        // Datasheet typical curve: ≈0.65–0.7 V at 10 mA.
        kit.between(kit.state('D').vf, 0.62, 0.70, 'forward voltage')
        kit.near(kit.state('D').current, (5 - 0.66) / 470, 3e-4, 'forward current')
      },
    },
    {
      name: 'blocks when reversed (band toward 5 V)',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 470 }, D: 'diode' },
          [['R:1', 'U:5V'], ['R:2', 'D:CATHODE'], ['D:ANODE', 'U:GND1']])
        kit.step(0.02)
        // Reverse leakage ≤5 µA at V_RRM, so essentially all 5 V appears across the diode.
        kit.ok(Math.abs(kit.state('D').current) < 5e-6, 'no reverse current')
        kit.near(kit.state('D').vf, -5, 0.01, 'full supply across the diode')
      },
    },
    {
      name: 'raises an over-current error when placed straight across 5 V',
      run(kit) {
        kit.scene({ U: 'arduino', D: 'diode' }, [['D:ANODE', 'U:5V'], ['D:CATHODE', 'U:GND1']])
        kit.step(0.02)
        kit.ok(kit.state('D').current > 1, 'many amps flow with nothing to limit them')
        kit.ok(kit.hasIssue('D:overcurrent'), 'over-current issue')
      },
    },
  ],
})

