// Interlink FSR 402 force-sensing resistor (Tinkercad "Force Sensor"). Ø18.3 mm
// disc (12.7 mm active), 0.45 mm thick, standard tail ≈56 mm with two solder
// tabs on 2.54 mm. Stand-off (untouched) > 10 MΩ; turn-on ≈0.2 N; R falls
// roughly as 1/F. Points from Interlink's curve as tabulated by Adafruit:
// 0.2 N → 30 kΩ, 1 N → 6 kΩ, 10 N → 1 kΩ, 100 N → 250 Ω (log-log interpolated).
// It lies flat; the tabs are at the end of the tail.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, TIN, fmtSI } from '../../model.js'

const DISC_R = 0.914, T = 0.045, TAIL_W = 0.76, TAIL_END = 4.32, TAB_L = 0.4, HALF = 0.127
export const R_OPEN = 10e6
const CURVE = [[0.1, R_OPEN], [0.2, 30e3], [1, 6e3], [10, 1e3], [100, 250]]
export function fsrResistance(F) {
  if (!(F > CURVE[0][0])) return R_OPEN
  for (let i = 1; i < CURVE.length; i++) {
    const [f0, r0] = CURVE[i - 1], [f1, r1] = CURVE[i]
    if (F <= f1 || i === CURVE.length - 1) {
      const k = Math.log(r1 / r0) / Math.log(f1 / f0)
      return r0 * Math.pow(F / f0, k)
    }
  }
  return R_OPEN
}

export default definePart({
  type: 'force_sensor',
  label: 'Force Sensor (FSR 402)',
  shortName: 'FSR',
  tinkercad: 'Force Sensor',
  category: 'sensors',
  icon: '⬤',
  desc: 'FSR 402 · >10 MΩ untouched · ≈6 kΩ at 1 N',
  purpose: 'Its resistance drops as you press it: over 10 MΩ untouched, ≈30 kΩ at a light touch (0.2 N), ≈6 kΩ at 1 N, ≈1 kΩ at 10 N. Make a divider: FSR from 5 V to A0, 10 kΩ from A0 to GND. Press it with the force slider.',
  usage: 'touch / squeeze detection · weighing (rough) · pressure pads',
  spec: { dims_mm: { w: 18.3, h: 0.5, d: 56.4 }, mass_kg: 0.0003, R_open_ohm: R_OPEN, range_N: '0.2–20', maxCurrent_mA: 1.3,
    summary: 'R ≈ 6 kΩ / F(N) above the ≈0.2 N turn-on; >10 MΩ untouched. Non-polar.' },
  pins: [
    { name: '1', kind: 'passive', x: -HALF, y: 0.02, z: TAIL_END + TAB_L - 0.05, r: 0.06 },
    { name: '2', kind: 'passive', x: HALF, y: 0.02, z: TAIL_END + TAB_L - 0.05, r: 0.06, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    g.add(at(cyl(DISC_R, T, mat(0x8a6a2a, { rough: 0.5, opacity: 0.85 }), { seg: 40 }), 0, T / 2, 0))   // amber polyester
    const pad = cyl(0.635, 0.004, mat(0x2a2a2a, { rough: 0.7 }), { seg: 40 })
    pad.name = 'pad'
    g.add(at(pad, 0, T + 0.002, 0))                                                         // active area
    g.add(box(TAIL_W, T, TAIL_END - DISC_R + 0.1, mat(0x8a6a2a, { rough: 0.5 }), 0, T / 2, (TAIL_END + DISC_R - 0.1) / 2))
    for (const s of [-1, 1]) {
      g.add(box(0.03, 0.004, TAIL_END - 0.6, mat(0xc0c4c8, { metal: 0.7 }), s * HALF, T + 0.002, (TAIL_END + 0.6) / 2))  // silver traces
      g.add(box(0.08, 0.02, TAB_L, TIN(), s * HALF, 0.01, TAIL_END + TAB_L / 2))                // solder tabs
    }
    return g
  },
  sim: {
    controls: [{ key: 'force', kind: 'slider', label: 'Force', min: 0, max: 20, step: 0.1, unit: 'N', default: 0 }],
    circuit(api) { return { r: api.add(resistor(api.pin('1'), api.pin('2'), R_OPEN)) } },
    beforeStep(h, api) { h.r.R = fsrResistance(Number(api.control('force') ?? 0)) },
    solved(h, api) {
      const i = Math.abs(api.cur(h.r))
      if (i > 0.0013) api.issue('current', 'warning', `${api.obj.name} passes ${(i * 1000).toFixed(1)} mA`,
        'Interlink rates the FSR at about 1 mA per cm² of active area (≈1.3 mA for the 402). Higher current drifts and wears the ink — use a ≥10 kΩ divider.')
      else api.clearIssue('current')
      return { resistance: h.r.R, current: i }
    },
    visual(root, { solved }) {
      const p = root.getObjectByName('pad')
      if (p) p.scale.y = solved && solved.resistance < R_OPEN ? 0.5 : 1
    },
    readout({ solved }) { return solved ? fmtSI(solved.resistance, 'Ω') : null },
  },
  tests: [
    {
      name: 'divider with 10 kΩ: untouched ≈0 V, 1 N → 3.13 V (639), 10 N → 4.55 V (930)',
      run(kit) {
        kit.scene({ U: 'arduino', F: 'force_sensor', R: { type: 'resistor', resistance: 10000 } },
          [['F:1', 'U:5V'], ['F:2', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.step(0.02)
        // 10 MΩ → 5 × 10k / 10.01M = 5 mV.
        kit.near(kit.pinVoltage(14), 0.005, 0.002, 'untouched'); kit.ok(kit.analogRead(14) <= 2)
        kit.control('F', 'force', 1); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 5 * 10 / 16, 0.01, '1 N (6 kΩ)'); kit.near(kit.analogRead(14), 639, 2)
        kit.control('F', 'force', 10); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 5 * 10 / 11, 0.01, '10 N (1 kΩ)'); kit.near(kit.analogRead(14), 930, 2)
      },
    },
    {
      name: 'end to end: a sketch prints "pressed" once the reading passes a threshold',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', F: 'force_sensor', R: { type: 'resistor', resistance: 10000 } },
          [['F:1', 'U:5V'], ['F:2', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        const s = runSketch(kit, `void setup() { Serial.begin(9600); }
void loop() { if (analogRead(A0) > 500) { Serial.println("pressed"); } else { Serial.println("free"); } delay(10); }`)
        await s.run(120)
        kit.equal(s.out[s.out.length - 1], 'free\n')
        kit.control('F', 'force', 2)       // 2 N → 6k × 2^−0.778 = 3.5 kΩ → 3.7 V → 757
        await s.run(150)
        kit.equal(s.out[s.out.length - 1], 'pressed\n')
        s.stop()
      },
    },
    {
      name: 'warns when pressed hard straight across 5 V (over its ≈1.3 mA rating)',
      run(kit) {
        kit.scene({ U: 'arduino', F: 'force_sensor' }, [['F:1', 'U:5V'], ['F:2', 'U:GND1']])
        kit.control('F', 'force', 10); kit.step(0.02)
        kit.ok(kit.hasIssue('F:current'), '5 mA through 1 kΩ')
      },
    },
  ],
})
