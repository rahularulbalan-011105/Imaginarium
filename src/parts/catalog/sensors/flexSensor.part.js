// Spectra Symbol 2.2" flex sensor (SparkFun SEN-10264, Tinkercad "Flex Sensor").
// Datasheet: flat 25 kΩ ±30 %, bend range 45–125 kΩ, 0.5 W continuous / 1 W peak,
// 6.35 mm wide, 0.43 mm thick, 55.9 mm active length, two crimped pins on
// 2.54 mm pitch. Model: R(θ) = 25 kΩ + 75 kΩ × θ/90° (≈100 kΩ at 90°).
// It stands in the breadboard on its pins and bends toward +Z.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, TIN, fmtSI } from '../../model.js'

const HALF = 0.127, PIN_L = 0.5, CRIMP_H = 0.25, STRIP_L = 6.6, STRIP_W = 0.635, STRIP_T = 0.043, SEGS = 6
export const R_FLAT = 25e3, R_90 = 100e3
export const flexResistance = (deg) => R_FLAT + (R_90 - R_FLAT) * Math.max(0, Math.min(90, deg)) / 90

export default definePart({
  type: 'flex_sensor',
  label: 'Flex Sensor 2.2"',
  shortName: 'FLEX',
  tinkercad: 'Flex Sensor',
  category: 'sensors',
  icon: '⌒',
  desc: '2.2" · 25 kΩ flat → ≈100 kΩ at 90°',
  purpose: 'Its resistance rises as you bend it (printed side out). Make a divider: flex sensor from 5 V to A0 and 47 kΩ from A0 to GND; analogRead falls from ≈668 flat to ≈327 at 90°. Bend it with the slider in the sim bar.',
  usage: 'data gloves · bend / joint angle sensing',
  spec: { dims_mm: { w: 6.35, h: 73.5, d: 1.2 }, mass_kg: 0.0005, R_flat_ohm: R_FLAT, R_90_ohm: R_90, tolerance: 0.3, power_W: 0.5,
    summary: 'R ≈ 25 kΩ flat, rising ≈linearly to ≈100 kΩ at 90°. Non-polar.' },
  pins: [
    { name: '1', kind: 'passive', x: -HALF, y: 0.02, z: 0, r: 0.06 },
    { name: '2', kind: 'passive', x: HALF, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    for (const s of [-1, 1]) g.add(box(0.06, PIN_L, 0.03, TIN(), s * HALF, PIN_L / 2, 0))
    g.add(box(STRIP_W, CRIMP_H, 0.12, TIN(), 0, PIN_L + CRIMP_H / 2, 0))                    // Clincher crimps
    // The strip: a chain of segments, each hinged at the top of the one below,
    // so the visual can bend it by rotating every joint θ/SEGS.
    const segL = STRIP_L / SEGS
    let parent = g, y0 = PIN_L + CRIMP_H
    for (let i = 0; i < SEGS; i++) {
      const joint = new Group()
      joint.name = `flex_${i}`
      joint.position.y = i === 0 ? y0 : segL
      joint.add(box(STRIP_W, segL, STRIP_T, mat(0x262626, { rough: 0.6 }), 0, segL / 2, 0))
      if (i > 0) joint.add(box(STRIP_W * 0.7, segL * 0.8, 0.004, mat(0x9aa0a6, { metal: 0.6 }), 0, segL / 2, STRIP_T / 2 + 0.002))   // printed ink
      parent.add(joint)
      parent = joint
    }
    return g
  },
  sim: {
    controls: [{ key: 'bend', kind: 'slider', label: 'Bend', min: 0, max: 90, step: 1, unit: '°', default: 0 }],
    circuit(api) { return { r: api.add(resistor(api.pin('1'), api.pin('2'), R_FLAT)) } },
    beforeStep(h, api) { h.r.R = flexResistance(Number(api.control('bend') ?? 0)) },
    solved(h, api) {
      const v = api.vpin('1') - api.vpin('2'), i = api.cur(h.r), p = Math.abs(v * i)
      if (p > 0.5) api.issue('power', 'error', `${api.obj.name} dissipates ${fmtSI(p, 'W')}`, 'The flex sensor is rated 0.5 W continuous. Use it in a voltage divider.')
      else api.clearIssue('power')
      return { resistance: h.r.R, bend: (h.r.R - R_FLAT) / (R_90 - R_FLAT) * 90 }
    },
    visual(root, { solved }) {
      const step = ((solved?.bend ?? 0) * Math.PI / 180) / SEGS
      for (let i = 1; i < SEGS; i++) { const j = root.getObjectByName(`flex_${i}`); if (j) j.rotation.x = step * SEGS / (SEGS - 1) }
    },
    readout({ solved }) { return solved ? fmtSI(solved.resistance, 'Ω') : null },
  },
  tests: [
    {
      name: 'divider with 47 kΩ into A0: flat 3.26 V (668), 45° 2.15 V (439), 90° 1.60 V (327)',
      run(kit) {
        kit.scene({ U: 'arduino', F: 'flex_sensor', R: { type: 'resistor', resistance: 47000 } },
          [['F:1', 'U:5V'], ['F:2', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.step(0.02)
        kit.near(kit.pinVoltage(14), 5 * 47 / 72, 0.01, 'flat (25 kΩ)'); kit.near(kit.analogRead(14), 668, 2)
        kit.control('F', 'bend', 45); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 5 * 47 / 109.5, 0.01, '45° (62.5 kΩ)'); kit.near(kit.analogRead(14), 439, 2)
        kit.control('F', 'bend', 90); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 5 * 47 / 147, 0.01, '90° (100 kΩ)'); kit.near(kit.analogRead(14), 327, 2)
        kit.near(kit.state('F').bend, 90, 0.01)
      },
    },
    {
      name: 'end to end: a sketch maps the reading to a bend angle',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', F: 'flex_sensor', R: { type: 'resistor', resistance: 47000 } },
          [['F:1', 'U:5V'], ['F:2', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.control('F', 'bend', 60)
        const s = runSketch(kit, `void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(A0);
  int angle = map(raw, 668, 327, 0, 90);
  Serial.println(angle);
  delay(20);
}`)
        await s.run(150)
        s.stop()
        // 60° → 75 kΩ → 5 × 47/122 = 1.926 V → 394 → map → (394−668)·90/(327−668) = 72.3.
        // (The divider is not linear in R, so the naive map over-reads mid-range — as on real hardware.)
        kit.near(Number(s.out[s.out.length - 1]), 72.3, 1.5, 'mapped angle')
      },
    },
  ],
})
