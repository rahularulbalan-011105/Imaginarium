// IRLZ44N logic-level N-channel power MOSFET, TO-220AB (Tinkercad "N-Channel
// MOSFET"). Leg order G-D-S left to right looking at the marked face; the tab
// is the drain. Infineon/IR datasheet: V_DSS 55 V, I_D 47 A (T_C 25 °C),
// V_GS ±16 V, R_DS(on) 0.022 Ω at V_GS = 5 V / 0.025 Ω at 4 V, V_GS(th) 1–2 V,
// body diode V_SD ≤ 1.3 V at 25 A, R_θJA 62 °C/W (≈2 W in free air).
// Circuit model: level-1 with V_th = 1.5 V and K chosen so that in triode
// R_DS = 1 / (K·(V_GS − V_th)) = 0.022 Ω at V_GS = 5 V → K = 13 A/V².
import { definePart } from '../../definePart.js'
import { to220, to220Pins } from './packages.js'
import { stampMosfet, mosfetSolved } from './mosfetModel.js'

const MODEL = { pmos: false, Vth: 1.5, K: 13, lambda: 0.01, bodyIs: 1e-11, bodyN: 1.1 }
const LIM = {
  pn: 'IRLZ44N', idMax: 47, vdsMax: 55, vgsMax: 16, pFreeAir: 2,
  enhanceHint: 'Give the gate the full 5 V (no large series resistor). Below ≈3 V an IRLZ44N only partly turns on and heats up.',
}

export default definePart({
  type: 'n_mosfet',
  label: 'N-Channel MOSFET',
  shortName: 'Q',
  tinkercad: 'N-Channel MOSFET',
  category: 'semis',
  icon: 'Ⓝ',
  desc: 'IRLZ44N logic-level · TO-220 · 55 V 47 A',
  purpose: 'A voltage-controlled low-side switch for big loads (motors, LED strips, solenoids). Legs G-D-S with the writing toward you. Source to GND, load between + and the drain, gate to an Arduino pin (optionally through ≈100 Ω, plus a 10 kΩ gate-to-GND pull-down). Logic-level: 5 V on the gate turns it fully on.',
  usage: 'motor / LED-strip / solenoid switching · PWM power control',
  spec: {
    dims_mm: { w: 10.2, h: 20.5, d: 4.5 }, mass_kg: 0.002,
    vdss_V: 55, id_A: 47, rdson_ohm: '0.022 @ V_GS 5 V', vgsth_V: '1–2',
    summary: 'IRLZ44N: legs G-D-S (text toward you), tab = drain. 5 V on the gate → R_DS ≈ 0.022 Ω.',
  },
  pins: to220Pins([['G', 'passive', 'G'], ['D', 'passive', 'D'], ['S', 'passive', 'S']]),
  build() { return to220({ marking: 'IRLZ44N' }) },
  sim: {
    circuit(api) { return stampMosfet(api, MODEL) },
    solved(h, api) { return mosfetSolved(h, api, MODEL, LIM) },
  },
  tests: [
    {
      name: 'end to end: a sketch switches a 10 Ω load (0.5 A) from D9',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', Q: 'n_mosfet', RL: { type: 'resistor', resistance: 10 }, RG: { type: 'resistor', resistance: 10000 } },
          [['U:5V', 'RL:1'], ['RL:2', 'Q:D'], ['Q:S', 'U:GND1'], ['U:D9', 'Q:G'], ['RG:1', 'Q:G'], ['RG:2', 'U:GND2']])
        kit.step(0.02)
        kit.ok(Math.abs(kit.state('Q').id) < 1e-6, 'off while the 10 kΩ pull-down holds the gate at 0 V')
        const s = runSketch(kit, `void setup() {
  pinMode(9, OUTPUT);
  digitalWrite(9, HIGH);
}
void loop() {
  delay(10);
}`)
        await s.run(120)
        const q = kit.state('Q')
        // V_GS = 5 · 10k / (10k + 25) ≈ 4.99 V → R_DS = 1 / (13 · 3.49) ≈ 0.022 Ω.
        // I = 5 V / (10 + 0.022 + 0.05 Ω rail) = 0.496 A; V_DS = 0.496 · 0.022 ≈ 11 mV.
        kit.near(q.id, 5 / 10.072, 0.003, 'load current')
        kit.near(q.vds, 0.011, 0.003, 'V_DS when on')
        kit.near(q.rds, 0.022, 0.002, 'R_DS(on) at V_GS = 5 V')
        kit.ok(!kit.hasIssue('pin:9:overcurrent'), 'the gate draws no DC current from the pin')
        s.stop()
      },
    },
    {
      name: 'switches an LED low-side: pin HIGH → on, LOW → off',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'n_mosfet', R: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['U:5V', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'Q:D'], ['Q:S', 'U:GND1'], ['U:D9', 'Q:G']])
        kit.pinMode(9, 'output'); kit.write(9, 1); kit.step(0.02)
        // (5 − 1.82 V LED) / 220 Ω ≈ 14.4 mA → brightness 14.4/20 · 255 ≈ 184.
        kit.between(kit.led.L, 170, 195, 'LED on')
        kit.write(9, 0); kit.step(0.02)
        kit.ok(!(kit.led.L > 2), 'LED off with V_GS = 0')
      },
    },
    {
      name: 'below threshold (V_GS = 1 V from a divider) it stays off; body diode conducts when reversed',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'n_mosfet', R1: { type: 'resistor', resistance: 40000 }, R2: { type: 'resistor', resistance: 10000 }, RL: { type: 'resistor', resistance: 100 } },
          [['U:5V', 'R1:1'], ['R1:2', 'Q:G'], ['R2:1', 'Q:G'], ['R2:2', 'U:GND1'], ['U:5V', 'RL:1'], ['RL:2', 'Q:D'], ['Q:S', 'U:GND2']])
        kit.step(0.02)
        // V_GS = 5 · 10k / 50k = 1.0 V < V_th (1.5 V typ, 1 V min).
        kit.near(kit.state('Q').vgs, 1.0, 0.01)
        kit.ok(Math.abs(kit.state('Q').id) < 1e-6, 'no drain current')
        kit.scene({ U: 'arduino', Q: 'n_mosfet', RL: { type: 'resistor', resistance: 470 } },
          [['U:5V', 'RL:1'], ['RL:2', 'Q:S'], ['Q:D', 'U:GND1'], ['Q:G', 'U:GND2']])
        kit.step(0.02)
        // Source above drain: the body diode conducts, ≈9 mA at ≈0.6 V (datasheet V_SD ≤ 1.3 V at 25 A).
        kit.between(-kit.state('Q').vds, 0.5, 0.8, 'body-diode drop')
      },
    },
  ],
})
