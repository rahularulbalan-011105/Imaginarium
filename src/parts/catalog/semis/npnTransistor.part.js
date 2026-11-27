// 2N2222A NPN small-signal transistor in TO-92 (Tinkercad "NPN Transistor
// (BJT)"). TO-92 parts PN2222A (Fairchild/ON) and P2N2222A (ON) both have the
// leg order E-B-C left to right, looking at the flat marked face, legs down.
// Absolute maximum ratings: V_CEO 40 V, V_CBO 75 V, V_EBO 6 V, I_C 600 mA,
// P_D 625 mW (TO-92, 25 °C). h_FE 100–300 at 150 mA.
// Circuit model: Ebers-Moll with the Philips/ON SPICE values IS = 14.34 fA,
// BF ≈ 200 (typ. h_FE at 10–150 mA), BR = 6.09, RB = 10 Ω.
import { definePart } from '../../definePart.js'
import { to92, to92Pins } from './packages.js'
import { stampBjt, bjtSolved } from './bjtModel.js'

const MODEL = { pnp: false, Is: 14.34e-15, bf: 200, br: 6.09, rb: 10 }
const LIM = { pn: '2N2222A', icMax: 0.6, pMax: 0.625, vceo: 40, vebo: 6 }

const LED_SKETCH = `void setup() {
  pinMode(8, OUTPUT);
}
void loop() {
  digitalWrite(8, HIGH);
  delay(10);
}`

export default definePart({
  type: 'npn_transistor',
  label: 'NPN Transistor (BJT)',
  shortName: 'Q',
  tinkercad: 'NPN Transistor (BJT)',
  category: 'semis',
  icon: 'Ⓝ',
  desc: '2N2222A · TO-92 · 40 V 600 mA',
  purpose: 'A current-controlled switch. With the flat face toward you the legs are E-B-C. As a low-side switch: emitter to GND, load between + and the collector, and the Arduino pin to the base through ≈1 kΩ. A HIGH pin then turns the load on (up to a few hundred mA).',
  usage: 'switching LEDs, relays, buzzers and small motors from a pin · amplifiers',
  spec: {
    dims_mm: { w: 5.2, h: 8.0, d: 4.2 }, mass_kg: 0.0002,
    vceo_V: 40, ic_A: 0.6, pd_W: 0.625, hfe: '100–300 @ 150 mA', vce_sat_V: '0.3 V @ 150 mA / 15 mA',
    summary: '2N2222A NPN, legs E-B-C (flat face toward you). Base needs a resistor (≈1 kΩ from a 5 V pin).',
  },
  pins: to92Pins([['E', 'passive', 'E'], ['B', 'passive', 'B'], ['C', 'passive', 'C']]),
  build() { return to92({ marking: '2N2222A' }) },
  sim: {
    circuit(api) { return stampBjt(api, MODEL) },
    solved(h, api) { return bjtSolved(h, api, MODEL, LIM) },
  },
  tests: [
    {
      name: 'end to end: a sketch switches an LED low-side through the transistor (D8 → 1 kΩ → base)',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', Q: 'npn_transistor', RB: { type: 'resistor', resistance: 1000 }, RL: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['U:D8', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'RL:1'], ['RL:2', 'L:ANODE'], ['L:CATHODE', 'Q:C']])
        kit.step(0.02)
        kit.ok(!(kit.led.L > 2), 'LED dark before the sketch runs (base at 0 V)')
        const s = runSketch(kit, LED_SKETCH)
        await s.run(150)
        const q = kit.state('Q')
        // Base: I_B = (5 − 0.75 V) / (1000 + 25 + 10 Ω) ≈ 4.1 mA.
        kit.near(q.ib, (5 - 0.75) / 1035, 0.25e-3, 'base current')
        // Collector: I_C = (5 − 1.82 V LED − ≈0.05 V V_CE(sat)) / 220 Ω ≈ 14.2 mA ≪ β·I_B (800 mA) → saturated.
        kit.near(q.ic, (5 - 1.82 - 0.05) / 220, 0.8e-3, 'collector current')
        kit.equal(q.region, 'saturated', 'switch is fully on')
        kit.ok(q.vce < 0.2, `V_CE(sat) small (got ${q.vce})`)
        // LED brightness = I / 20 mA · 255 ≈ 181.
        kit.between(kit.led.L, 165, 195, 'LED brightness')
        s.stop()
      },
    },
    {
      name: 'off with the base LOW; in the active region I_C = β·I_B',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'npn_transistor', RB: { type: 'resistor', resistance: 1e6 }, RL: { type: 'resistor', resistance: 100 } },
          [['U:D8', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'RL:1'], ['RL:2', 'Q:C']])
        kit.pinMode(8, 'output'); kit.write(8, 0); kit.step(0.02)
        kit.ok(Math.abs(kit.state('Q').ic) < 1e-6, 'no collector current with the base at 0 V')
        kit.equal(kit.state('Q').region, 'off')
        kit.write(8, 1); kit.step(0.02)
        // I_B = (5 − 0.6) / 1 MΩ ≈ 4.4 µA → I_C = 200 · 4.4 µA ≈ 0.88 mA, V_CE = 5 − 0.088 ≈ 4.9 V (active).
        const q = kit.state('Q')
        kit.equal(q.region, 'active')
        kit.near(q.ib, 4.4e-6, 0.1e-6, 'base current')
        kit.near(q.beta, 200, 5, 'current gain')
      },
    },
    {
      name: 'warns when the base is driven straight from a pin with no resistor',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'npn_transistor', RL: { type: 'resistor', resistance: 220 } },
          [['U:D8', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'RL:1'], ['RL:2', 'Q:C']])
        kit.pinMode(8, 'output'); kit.write(8, 1); kit.step(0.02)
        // Only the pin's ≈25 Ω and RB = 10 Ω limit it: I_B ≈ (5 − 0.9) / 35 Ω ≈ 0.1 A.
        kit.ok(kit.state('Q').ib > 0.05, 'large base current')
        kit.ok(kit.hasIssue('Q:ib'), 'base-resistor warning')
        kit.ok(kit.hasIssue('pin:8:overcurrent'), 'the board pin is overloaded too')
      },
    },
  ],
})
