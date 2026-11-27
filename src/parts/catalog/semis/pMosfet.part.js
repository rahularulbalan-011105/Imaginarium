// IRF9540N P-channel power MOSFET, TO-220AB (Tinkercad "P-Channel MOSFET").
// Leg order G-D-S left to right looking at the marked face; tab = drain.
// Infineon/IR datasheet: V_DSS −100 V, I_D −23 A (T_C 25 °C), V_GS ±20 V,
// R_DS(on) 0.117 Ω at V_GS = −10 V, V_GS(th) −2 … −4 V, R_θJA 62 °C/W.
// NOT a logic-level part: from a 5 V Arduino it is only partly enhanced.
// Circuit model: level-1 with |V_th| = 3 V (typ.) and K so that
// 1 / (K·(10 − 3)) = 0.117 Ω → K = 1.22 A/V² (→ ≈0.41 Ω at V_GS = −5 V).
import { definePart } from '../../definePart.js'
import { to220, to220Pins } from './packages.js'
import { stampMosfet, mosfetSolved } from './mosfetModel.js'

const MODEL = { pmos: true, Vth: 3, K: 1.22, lambda: 0.01, bodyIs: 1e-11, bodyN: 1.1 }
const LIM = {
  pn: 'IRF9540N', idMax: 23, vdsMax: 100, vgsMax: 20, pFreeAir: 2,
  enhanceHint: 'The IRF9540N needs V_GS ≈ −10 V to reach 0.117 Ω; a 5 V pin gives only −5 V. Drive its gate through an NPN level shifter from a higher supply, or use a logic-level P-MOSFET.',
}

export default definePart({
  type: 'p_mosfet',
  label: 'P-Channel MOSFET',
  shortName: 'Q',
  tinkercad: 'P-Channel MOSFET',
  category: 'semis',
  icon: 'Ⓟ',
  desc: 'IRF9540N · TO-220 · −100 V −23 A',
  purpose: 'A high-side switch: source to +, load from the drain to GND. Pulling the gate BELOW the source turns it on (gate LOW = on, gate at the source voltage = off). Legs G-D-S with the writing toward you. Needs about −10 V on the gate for full current.',
  usage: 'high-side power switching · reverse-polarity protection',
  spec: {
    dims_mm: { w: 10.2, h: 20.5, d: 4.5 }, mass_kg: 0.002,
    vdss_V: -100, id_A: -23, rdson_ohm: '0.117 @ V_GS −10 V', vgsth_V: '−2 … −4',
    summary: 'IRF9540N: legs G-D-S, tab = drain. Source to +; gate LOW turns it on.',
  },
  pins: to220Pins([['G', 'passive', 'G'], ['D', 'passive', 'D'], ['S', 'passive', 'S']]),
  build() { return to220({ marking: 'IRF9540N' }) },
  sim: {
    circuit(api) { return stampMosfet(api, MODEL) },
    solved(h, api) { return mosfetSolved(h, api, MODEL, LIM) },
  },
  tests: [
    {
      name: 'high-side LED switch: gate LOW → on, gate HIGH → off',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'p_mosfet', R: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['Q:S', 'U:5V'], ['Q:D', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND1'], ['U:D9', 'Q:G']])
        kit.pinMode(9, 'output'); kit.write(9, 0); kit.step(0.02)
        const q = kit.state('Q')
        // V_GS = −5 V → R_DS = 1 / (1.22 · 2) ≈ 0.41 Ω; I = (5 − 1.82) / 220.4 ≈ 14.4 mA → V_SD ≈ 6 mV.
        kit.near(q.vgs, -5, 0.01, 'V_GS')
        kit.near(-q.id, (5 - 1.82) / 220.4, 0.8e-3, 'drain current (out of the drain)')
        kit.near(q.rds, 0.41, 0.03, 'R_DS at V_GS = −5 V')
        kit.between(kit.led.L, 170, 195, 'LED on')
        kit.write(9, 1); kit.step(0.02)
        kit.ok(Math.abs(kit.state('Q').id) < 1e-6, 'off with the gate at the source voltage')
        kit.ok(!(kit.led.L > 2), 'LED off')
      },
    },
    {
      name: 'not logic level: with −5 V gate drive a 2.2 Ω load leaves ≈1 V across it (warning)',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'p_mosfet', RL: { type: 'resistor', resistance: 2.2 } },
          [['Q:S', 'U:5V'], ['Q:D', 'RL:1'], ['RL:2', 'U:GND1'], ['U:D9', 'Q:G']])
        kit.pinMode(9, 'output'); kit.write(9, 0); kit.step(0.02)
        // The source sags to 5 − 0.05·I (rail resistance), so V_ov = 4.91 − 3 ≈ 1.91 V.
        // Triode: I = 1.22·(V_ov·V_SD − V_SD²/2)·(1 + 0.01·V_SD) and 5 = 2.25·I + V_SD
        // → V_SD ≈ 1.02 V, I ≈ 1.77 A (with −10 V gate drive it would be ≈0.2 V).
        const q = kit.state('Q')
        kit.near(-q.vds, 1.02, 0.04, 'V_SD')
        kit.near(-q.id, 1.77, 0.04, 'drain current')
        kit.ok(kit.hasIssue('Q:enhance'), 'not-fully-enhanced warning')
      },
    },
  ],
})
