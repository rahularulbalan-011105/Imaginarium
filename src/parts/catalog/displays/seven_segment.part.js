// 0.56" single-digit 7-segment LED display (Tinkercad "7 Segment Display"),
// Kingbright SC56-11 (common cathode) / SA56-11 (common anode) package:
// 12.6 × 19.0 × 8.0 mm, 10 pins in two rows of five, 2.54 mm pitch, rows
// 15.24 mm (0.6") apart. Pinout (viewed from the front, decimal point bottom
// right): bottom row 1–5 = e d COM c DP, top row 10–6 = g f COM a b. Each
// segment is a red LED junction (Vf ≈ 2.0 V @ 20 mA, 30 mA max).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, box, cyl, at, setGlow, TIN, PITCH } from '../../model.js'
import { addLed, ledLevel, checkLedCurrent } from '../lights/ledKit.js'

const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'DP']
const LIFT = 0.1, BODY_H = 0.8, ROW = 0.762
const VF = 2.0, IMAX = 0.03
const RED = 0xff2a1a
// pin number → [name, x, z]; bottom row z = +ROW (pins 1…5 left→right), top row z = −ROW (6…10 right→left).
const PINS = [
  ['e', 1], ['d', 2], ['COM1', 3], ['c', 4], ['DP', 5],
  ['b', 6], ['a', 7], ['COM2', 8], ['f', 9], ['g', 10],
].map(([name, n]) => n <= 5
  ? { name, n, x: (n - 3) * PITCH, z: ROW }
  : { name, n, x: (8 - n) * PITCH, z: -ROW })
// Segment bars on the face: [x, z, w(x), d(z)] in cm (digit 7.6 × 14.2 mm).
const L = 0.33, T = 0.1
const GEOM = {
  a: [0.03, -0.66, L * 2 - 0.1, T], g: [0, 0, L * 2 - 0.1, T], d: [-0.03, 0.66, L * 2 - 0.1, T],
  f: [-0.34, -0.33, T, 0.55], b: [0.36, -0.33, T, 0.55],
  e: [-0.36, 0.33, T, 0.55], c: [0.34, 0.33, T, 0.55],
}

export default definePart({
  type: 'seven_segment',
  label: '7 Segment Display',
  shortName: '7SEG',
  tinkercad: '7 Segment Display',
  category: 'displays',
  icon: '8️⃣',
  desc: '0.56" single digit · red · common cathode / anode',
  purpose: 'Seven LED bars (a–g) plus a decimal point draw one digit. Straddle the breadboard gap. Common cathode: COM to GND and drive each segment HIGH through its own 220 Ω resistor. Common anode: COM to 5 V and drive a segment LOW to light it. Both COM pins are joined inside.',
  usage: 'counters · clocks · dice · scoreboards',
  spec: {
    dims_mm: { w: 12.6, h: 9.0, d: 19.0 }, mass_kg: 0.002,
    digitHeight_mm: 14.2, vf_V: VF, if_mA: 20, ifMax_mA: 30, rowSpacing_mm: 15.24,
    summary: 'Pins 1–5: e d COM c DP; pins 6–10: b a COM f g. Segment a is the top bar, g the middle, going clockwise a→f.',
  },
  props: {
    common: { type: 'select', label: 'Common', default: 'cathode', options: [
      { value: 'cathode', label: 'Common cathode (COM → GND)' }, { value: 'anode', label: 'Common anode (COM → 5 V)' }] },
  },
  pins: PINS.map((p, i) => ({ name: p.name, kind: 'passive', x: p.x, y: 0.02, z: p.z + (p.z > 0 ? 0.04 : -0.04), r: 0.06, label: p.name, ldy: 0.25 + (i % 2) * 0.2 })),
  internal: [['COM1', 'COM2']],
  build() {
    const g = new Group()
    g.add(box(1.26, BODY_H, 1.9, mat(0x1b1b1b, { rough: 0.85 }), 0, LIFT + BODY_H / 2, 0))
    g.add(box(1.2, 0.01, 1.84, mat(0x303030, { rough: 0.5 }), 0, LIFT + BODY_H + 0.004, 0))
    const off = 0x4a3030
    for (const [s, [x, z, w, d]] of Object.entries(GEOM)) {
      const m = box(w, 0.02, d, mat(off, { rough: 0.4, emissive: 0x000000 }), x, LIFT + BODY_H + 0.012, z)
      m.name = `seg_${s}`
      g.add(m)
    }
    const dp = cyl(0.06, 0.02, mat(off, { rough: 0.4, emissive: 0x000000 }), { seg: 16 })
    dp.name = 'seg_DP'
    g.add(at(dp, 0.5, LIFT + BODY_H + 0.012, 0.7))
    for (const p of PINS) g.add(box(0.05, LIFT + 0.05, 0.025, TIN(), p.x, (LIFT + 0.05) / 2, p.z))
    return g
  },
  sim: {
    circuit(api) {
      const anode = api.prop('common') === 'anode', com = api.pin('COM1'), d = {}
      for (const s of SEGS) d[s] = anode ? addLed(api, com, api.pin(s), VF) : addLed(api, api.pin(s), com, VF)
      return { d }
    },
    solved(h, api) {
      const current = {}, level = {}
      let lit = ''
      for (const s of SEGS) {
        current[s] = Math.max(0, api.cur(h.d[s]))
        level[s] = ledLevel(current[s])
        checkLedCurrent(api, `overcurrent_${s}`, current[s], IMAX, `segment ${s}`)
        if (level[s] > 0.05) lit += s
      }
      return { current, level, lit }
    },
    visual(root, { solved, off }) {
      for (const s of SEGS) setGlow(root.getObjectByName(`seg_${s}`), RED, off || !solved ? 0 : solved.level[s])
    },
    readout({ solved }) { return solved ? `lit: ${solved.lit || '—'}` : '' },
  },
  tests: [
    {
      name: 'common cathode: one segment via 220 Ω from a HIGH pin draws ≈12.6 mA',
      run(kit) {
        kit.scene({ U: 'arduino', D: 'seven_segment', R: { type: 'resistor', resistance: 220 } },
          [['U:D2', 'R:1'], ['R:2', 'D:a'], ['D:COM2', 'U:GND1']])
        kit.pinMode(2, 'output'); kit.write(2, 1); kit.step(0.05)
        // COM2 is joined to COM1 inside. (5 − 1.816 V) / (25 + 220 + 8 Ω) ≈ 12.6 mA.
        kit.near(kit.state('D').current.a, 0.0126, 0.0006, 'segment a current')
        kit.equal(kit.state('D').lit, 'a')
        kit.ok(kit.mesh('D').getObjectByName('seg_a').material.emissiveIntensity > 0.5, 'segment a glows')
      },
    },
    {
      name: 'wrong common: a common-cathode display wired as common anode stays dark; no resistor = over-current',
      run(kit) {
        kit.scene({ U: 'arduino', D: 'seven_segment', R: { type: 'resistor', resistance: 220 } },
          [['U:5V', 'D:COM1'], ['D:b', 'R:1'], ['R:2', 'U:D3']])
        kit.pinMode(3, 'output'); kit.write(3, 0); kit.step(0.05)
        kit.equal(kit.state('D').lit, '', 'every junction reverse-biased')
        kit.scene({ U: 'arduino', D: { type: 'seven_segment', common: 'anode' } }, [['U:5V', 'D:COM1'], ['D:c', 'U:D3']])
        kit.pinMode(3, 'output'); kit.write(3, 0); kit.step(0.05)
        // Only the 25 Ω pin + 8 Ω Rs: ≈ (5 − 1.9) / 33 ≈ 90 mA.
        kit.ok(kit.state('D').current.c > 0.06, 'segment c over-driven')
        kit.ok(kit.hasIssue('D:overcurrent_c'), 'over-current issue')
      },
    },
    {
      name: 'end to end: a sketch draws the digit 2 (a b g e d) on a common-cathode display',
      async run(kit, { runSketch }) {
        const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
        const spec = { U: 'arduino', D: 'seven_segment' }, wires = [['D:COM1', 'U:GND1']]
        order.forEach((s, i) => {
          spec['R' + s] = { type: 'resistor', resistance: 220 }
          wires.push([`U:D${i + 2}`, `R${s}:1`], [`R${s}:2`, `D:${s}`])
        })
        kit.scene(spec, wires)
        const s = runSketch(kit, `// segments a..g on pins 2..8
byte digits[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
void show(int n) {
  for (int i = 0; i < 7; i++) {
    digitalWrite(i + 2, bitRead(digits[n], i));
  }
}
void setup() {
  for (int p = 2; p <= 8; p++) pinMode(p, OUTPUT);
}
void loop() {
  show(2);
  delay(10);
}`)
        await s.run(150)
        kit.equal(kit.state('D').lit, 'abdeg', 'digit 2 = segments a b d e g')
        kit.near(kit.state('D').current.g, 0.0126, 0.0006, 'segment g current')
        s.stop()
      },
    },
  ],
})
