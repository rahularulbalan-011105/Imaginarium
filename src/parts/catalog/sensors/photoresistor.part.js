// GL5528 5 mm CdS photoresistor / LDR (Tinkercad "Photoresistor"). Datasheet:
// R10 (10 lux) = 10–20 kΩ (10 kΩ used), γ = log(R10/R100) ≈ 0.6, dark ≥ 1 MΩ,
// Pmax 100 mW, Vmax 150 V DC. R(L) = R10 · (L/10)^−γ, capped at the dark value.
// Ø5.1 × 2 mm ceramic disc on 3.4 mm leads, formed to 2.54 mm at the feet.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, lead, fmtSI } from '../../model.js'

const HALF = 0.127, LEG = 0.5, DISC_R = 0.255, DISC_T = 0.2
export const R10 = 10e3, GAMMA = 0.6, R_DARK = 1e6
export function ldrResistance(lux) {
  if (!(lux > 0)) return R_DARK
  return Math.min(R_DARK, R10 * Math.pow(lux / 10, -GAMMA))
}

export default definePart({
  type: 'photoresistor',
  label: 'Photoresistor (LDR)',
  shortName: 'LDR',
  tinkercad: 'Photoresistor',
  category: 'sensors',
  icon: '☀',
  desc: 'GL5528 · 10 kΩ @ 10 lux · ≥1 MΩ dark',
  purpose: 'A resistor whose value falls as light rises (≈10 kΩ in a dim room, ≈2.5 kΩ at 100 lux, over 1 MΩ in darkness). Make a divider: LDR from 5 V to A0 and 10 kΩ from A0 to GND, then analogRead(A0) rises with light. Set the light level in the sim bar.',
  usage: 'night lights · light-following robots · daylight detection',
  spec: { dims_mm: { w: 5.1, h: 7.0, d: 5.1 }, mass_kg: 0.0003, R10_ohm: R10, gamma: GAMMA, Rdark_ohm: R_DARK, power_W: 0.1, Vmax: 150,
    summary: 'R = 10 kΩ × (lux/10)^−0.6; ≥1 MΩ in the dark. Non-polar.' },
  pins: [
    { name: '1', kind: 'passive', x: -HALF, y: 0.02, z: 0, r: 0.06 },
    { name: '2', kind: 'passive', x: HALF, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    for (const s of [-1, 1]) {
      g.add(lead([s * HALF, 0, 0], [s * HALF, 0.3, 0], { r: 0.025 }))
      g.add(lead([s * HALF, 0.3, 0], [s * 0.17, LEG, 0], { r: 0.025 }))
    }
    g.add(at(cyl(DISC_R, DISC_T, mat(0xe8d9b5, { rough: 0.7 }), { seg: 28 }), 0, LEG + DISC_T / 2, 0))    // ceramic disc
    // CdS serpentine track between the two comb electrodes.
    for (let i = -3; i <= 3; i++) g.add(box(0.30 - Math.abs(i) * 0.03, 0.004, 0.025, mat(0xb8462a, { rough: 0.6 }), 0, LEG + DISC_T + 0.002, i * 0.055))
    for (const s of [-1, 1]) g.add(box(0.05, 0.004, 0.36, mat(0xc9cdd2, { metal: 0.8 }), s * 0.19, LEG + DISC_T + 0.002, 0))
    return g
  },
  sim: {
    controls: [{ key: 'lux', kind: 'slider', label: 'Light', min: 0, max: 10000, step: 1, unit: 'lux', default: 100 }],
    circuit(api) { return { r: api.add(resistor(api.pin('1'), api.pin('2'), ldrResistance(100))) } },
    beforeStep(h, api) { const l = api.control('lux'); h.r.R = ldrResistance(l == null ? 100 : Number(l)) },
    solved(h, api) {
      const v = api.vpin('1') - api.vpin('2'), i = api.cur(h.r), p = Math.abs(v * i)
      if (p > 0.1) api.issue('power', 'error', `${api.obj.name} dissipates ${fmtSI(p, 'W')}`, 'The GL5528 is rated 100 mW. Put a fixed resistor (e.g. 10 kΩ) in series to make a voltage divider.')
      else api.clearIssue('power')
      return { resistance: h.r.R, voltage: v, current: i }
    },
    readout({ solved }) { return solved ? fmtSI(solved.resistance, 'Ω') : null },
  },
  tests: [
    {
      name: 'divider with 10 kΩ into A0: 10 lux → 2.5 V, 100 lux → 4.0 V, dark → 0.05 V',
      run(kit) {
        kit.scene({ U: 'arduino', P: 'photoresistor', R: { type: 'resistor', resistance: 10000 } },
          [['P:1', 'U:5V'], ['P:2', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.control('P', 'lux', 10); kit.step(0.02)
        // R = 10 kΩ → 5 × 10k / 20k = 2.5 V → 1023 × 0.5 = 512.
        kit.near(kit.pinVoltage(14), 2.5, 0.01, '10 lux'); kit.near(kit.analogRead(14), 512, 2)
        kit.control('P', 'lux', 100); kit.step(0.02)
        // R = 10k × 10^−0.6 = 2512 Ω → 5 × 10k / 12.512k = 3.996 V → 818.
        kit.near(kit.pinVoltage(14), 3.996, 0.01, '100 lux'); kit.near(kit.analogRead(14), 818, 2)
        kit.control('P', 'lux', 0); kit.step(0.02)
        // 1 MΩ → 5 × 10k / 1.01M = 0.0495 V → 10.
        kit.near(kit.pinVoltage(14), 0.0495, 0.002, 'dark'); kit.near(kit.analogRead(14), 10, 1)
      },
    },
    {
      name: 'end to end: a night-light sketch turns the LED on only in the dark',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', P: 'photoresistor', R: { type: 'resistor', resistance: 10000 }, R2: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['P:1', 'U:5V'], ['P:2', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1'], ['U:D9', 'R2:1'], ['R2:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2']])
        kit.control('P', 'lux', 300)
        const s = runSketch(kit, `void setup() { pinMode(9, OUTPUT); Serial.begin(9600); }
void loop() {
  int light = analogRead(A0);
  Serial.println(light);
  if (light < 300) { digitalWrite(9, HIGH); } else { digitalWrite(9, LOW); }
  delay(10);
}`)
        await s.run(150)
        kit.ok(!(kit.led.L > 0), '300 lux: LED off')
        kit.control('P', 'lux', 1)
        await s.run(200)
        // 1 lux → 10k × 0.1^−0.6 = 39.8 kΩ → A0 = 5 × 10/49.8 = 1.004 V → 205 (< 300).
        kit.near(Number(s.out[s.out.length - 1]), 205, 3, 'analogRead at 1 lux')
        kit.ok(kit.led.L > 100, 'dark: LED on')
        s.stop()
      },
    },
    {
      name: 'flags over-power when wired straight across 5 V in bright light',
      run(kit) {
        kit.scene({ U: 'arduino', P: 'photoresistor' }, [['P:1', 'U:5V'], ['P:2', 'U:GND1']])
        kit.control('P', 'lux', 10000); kit.step(0.02)
        // 10 klux → 10k × 1000^−0.6 = 158 Ω → 25 / 158 = 0.158 W > 0.1 W.
        kit.ok(kit.hasIssue('P:power'), 'over-power issue')
      },
    },
  ],
})
