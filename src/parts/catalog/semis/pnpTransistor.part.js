// 2N2907A PNP small-signal transistor in TO-92 (Tinkercad "PNP Transistor
// (BJT)"). TO-92 PN2907A / P2N2907A leg order: E-B-C left to right, looking at
// the flat marked face, legs down.
// Absolute maximum ratings: V_CEO −60 V, V_CBO −60 V, V_EBO −5 V, I_C −600 mA,
// P_D 625 mW (TO-92). h_FE 100–300 at 150 mA.
// Circuit model: Ebers-Moll with the Philips SPICE values IS = 650.6 aA,
// BF ≈ 200 (typ. h_FE at 10–150 mA), BR = 3.56, RB = 10 Ω.
import { definePart } from '../../definePart.js'
import { to92, to92Pins } from './packages.js'
import { stampBjt, bjtSolved } from './bjtModel.js'

const MODEL = { pnp: true, Is: 650.6e-18, bf: 200, br: 3.56, rb: 10 }
const LIM = { pn: '2N2907A', icMax: 0.6, pMax: 0.625, vceo: 60, vebo: 5 }

export default definePart({
  type: 'pnp_transistor',
  label: 'PNP Transistor (BJT)',
  shortName: 'Q',
  tinkercad: 'PNP Transistor (BJT)',
  category: 'semis',
  icon: 'Ⓟ',
  desc: '2N2907A · TO-92 · −60 V −600 mA',
  purpose: 'The mirror image of an NPN: a high-side switch. Flat face toward you the legs are E-B-C. Emitter to +5 V, load from the collector to GND, base to an Arduino pin through ≈1 kΩ. The load turns ON when the pin goes LOW and OFF when it is HIGH.',
  usage: 'high-side switching · current sources · push-pull stages with an NPN',
  spec: {
    dims_mm: { w: 5.2, h: 8.0, d: 4.2 }, mass_kg: 0.0002,
    vceo_V: -60, ic_A: -0.6, pd_W: 0.625, hfe: '100–300 @ 150 mA', vce_sat_V: '−0.4 V @ 150 mA / 15 mA',
    summary: '2N2907A PNP, legs E-B-C (flat face toward you). Emitter to +, pull the base LOW through ≈1 kΩ to turn it on.',
  },
  pins: to92Pins([['E', 'passive', 'E'], ['B', 'passive', 'B'], ['C', 'passive', 'C']]),
  build() { return to92({ marking: '2N2907A' }) },
  sim: {
    circuit(api) { return stampBjt(api, MODEL) },
    solved(h, api) { return bjtSolved(h, api, MODEL, LIM) },
  },
  tests: [
    {
      name: 'high-side switch: D8 LOW lights the LED, D8 HIGH turns it off',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'pnp_transistor', RB: { type: 'resistor', resistance: 1000 }, RL: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['U:D8', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:5V'], ['Q:C', 'RL:1'], ['RL:2', 'L:ANODE'], ['L:CATHODE', 'U:GND1']])
        kit.pinMode(8, 'output'); kit.write(8, 0); kit.step(0.02)
        const q = kit.state('Q')
        // Base current OUT of the base: (5 − 0.75 V_EB) / (1000 + 25 + 10 Ω) ≈ 4.1 mA.
        kit.near(-q.ib, (5 - 0.75) / 1035, 0.3e-3, 'base current (out of the base)')
        // Collector: (5 − ≈0.05 V_EC(sat) − 1.82 V LED) / 220 Ω ≈ 14.2 mA out of the collector.
        kit.near(-q.ic, (5 - 0.05 - 1.82) / 220, 0.8e-3, 'collector current')
        kit.equal(q.region, 'saturated')
        kit.between(kit.led.L, 165, 195, 'LED brightness ≈ 14 mA / 20 mA · 255')
        kit.write(8, 1); kit.step(0.02)
        // Base at 5 V = emitter: V_EB = 0, no current.
        kit.ok(Math.abs(kit.state('Q').ic) < 1e-6, 'off with the base HIGH')
        kit.ok(!(kit.led.L > 2), 'LED dark')
      },
    },
    {
      name: 'end to end: a sketch blinks the LED through the PNP (active-LOW)',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', Q: 'pnp_transistor', RB: { type: 'resistor', resistance: 1000 }, RL: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['U:D8', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:5V'], ['Q:C', 'RL:1'], ['RL:2', 'L:ANODE'], ['L:CATHODE', 'U:GND1']])
        const s = runSketch(kit, `void setup() {
  pinMode(8, OUTPUT);
  digitalWrite(8, HIGH);
  delay(300);
  digitalWrite(8, LOW);
}
void loop() {
  delay(10);
}`)
        await s.run(120)
        kit.ok(!(kit.led.L > 2), 'pin HIGH: LED off')
        await s.run(400)
        kit.between(kit.led.L, 165, 195, 'pin LOW: LED on')
        s.stop()
      },
    },
  ],
})
