// 10-segment LED bar graph (Tinkercad "LED Bar Graph"), Kingbright DC-10 style:
// 25.4 × 10.16 × 8.0 mm body in a DIP-20 footprint (0.3" rows). Pins 1–10 are
// the anodes of segments 1–10 on one side; pins 11–20 the cathodes on the
// other (pin 20 = cathode of segment 1, opposite its anode). Each bar is a
// real LED junction: red Vf ≈ 2.0 V @ 20 mA, 30 mA max per segment.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, box, at, setGlow, TIN, dipPinXZ } from '../../model.js'
import { addLed, ledLevel, checkLedCurrent } from './ledKit.js'

const N = 10, LIFT = 0.1, BODY_H = 0.8
const COLORS = {
  red:    { vf: 2.0, hex: 0xff2a1a, off: 0x5a2020 },
  yellow: { vf: 2.1, hex: 0xffd21a, off: 0x5a5020 },
  green:  { vf: 2.2, hex: 0x3cff3c, off: 0x245a24 },
  blue:   { vf: 3.2, hex: 0x3a6bff, off: 0x24305a },
}
const IMAX = 0.03
// Pin n (1…20) → name: 1–10 anodes A1–A10, 11–20 cathodes K10…K1.
const pinName = (n) => (n <= N ? `A${n}` : `K${2 * N + 1 - n}`)

export default definePart({
  type: 'led_bar_graph',
  label: 'LED Bar Graph',
  shortName: 'BAR',
  tinkercad: 'LED Bar Graph',
  category: 'lights',
  icon: '📶',
  desc: '10 segments · DIP-20 · anodes one side, cathodes the other',
  purpose: 'Ten separate LEDs in one package. Plug it across a breadboard\'s centre gap. Each segment n has its anode An on one side and its cathode Kn straight across; wire each anode through its own 220 Ω resistor to a pin and every cathode to GND. Light more bars for a bigger reading (a level meter).',
  usage: 'level meters · battery gauges · progress bars',
  spec: {
    dims_mm: { w: 25.4, h: 9.0, d: 10.16 }, mass_kg: 0.0016,
    vf_V: 2.0, if_mA: 20, ifMax_mA: 30, pitch_mm: 2.54, rows_mm: 7.62,
    summary: 'DIP-20: pins 1–10 anodes of segments 1–10, pins 11–20 cathodes of segments 10–1. Vf ≈ 2.0 V (red) per segment.',
  },
  props: {
    ledColor: { type: 'select', label: 'Colour', default: 'red', options: [
      { value: 'red', label: 'Red (2.0 V)' }, { value: 'yellow', label: 'Yellow (2.1 V)' },
      { value: 'green', label: 'Green (2.2 V)' }, { value: 'blue', label: 'Blue (3.2 V)' }] },
  },
  rebuildOn: ['ledColor'],
  pins: Array.from({ length: 2 * N }, (_, i) => {
    const n = i + 1, { x, z } = dipPinXZ(2 * N, n)
    return { name: pinName(n), kind: 'passive', x, y: 0.02, z: z + (z > 0 ? 0.04 : -0.04), r: 0.055, label: pinName(n), ldy: 0.25 + (i % 2) * 0.22 }
  }),
  build(obj) {
    const g = new Group()
    const c = COLORS[obj.ledColor] ?? COLORS.red
    g.add(box(2.54, BODY_H, 1.016, mat(0x2a2a2a, { rough: 0.8 }), 0, LIFT + BODY_H / 2, 0))
    // Pin-1 marker: a chamfer dot at the anode-1 corner.
    g.add(box(0.12, 0.01, 0.12, mat(0x9ca3af), -1.15, LIFT + BODY_H + 0.005, 0.38))
    for (let s = 1; s <= N; s++) {
      const { x } = dipPinXZ(2 * N, s)
      const seg = box(0.14, 0.02, 0.5, mat(c.off, { rough: 0.4, emissive: 0x000000 }), x, LIFT + BODY_H + 0.01, 0)
      seg.name = `seg_${s}`
      g.add(seg)
    }
    for (let n = 1; n <= 2 * N; n++) {
      const { x, z } = dipPinXZ(2 * N, n)
      g.add(box(0.05, LIFT + 0.05, 0.025, TIN(), x, (LIFT + 0.05) / 2, z))
    }
    return g
  },
  sim: {
    circuit(api) {
      const vf = (COLORS[api.prop('ledColor')] ?? COLORS.red).vf
      const d = []
      for (let s = 1; s <= N; s++) d.push(addLed(api, api.pin(`A${s}`), api.pin(`K${s}`), vf))
      return { d }
    },
    solved(h, api) {
      const current = h.d.map(e => Math.max(0, api.cur(e)))
      current.forEach((i, k) => checkLedCurrent(api, `overcurrent_${k + 1}`, i, IMAX, `segment ${k + 1}`))
      const level = current.map(i => ledLevel(i))
      return { current, level, lit: level.filter(l => l > 0.05).length }
    },
    visual(root, { solved, off }, obj) {
      const c = COLORS[obj?.ledColor] ?? COLORS.red
      for (let s = 1; s <= N; s++) {
        const L = off || !solved ? 0 : solved.level[s - 1]
        setGlow(root.getObjectByName(`seg_${s}`), c.hex, L)
      }
    },
    readout({ solved }) { return solved ? `${solved.lit} / ${N} lit` : '' },
  },
  tests: [
    {
      name: 'one segment via 220 Ω from a HIGH pin: ≈12.6 mA, neighbours dark',
      run(kit) {
        kit.scene({ U: 'arduino', G: 'led_bar_graph', R: { type: 'resistor', resistance: 220 } },
          [['U:D2', 'R:1'], ['R:2', 'G:A1'], ['G:K1', 'U:GND1'], ['G:K2', 'U:GND1'], ['G:A2', 'U:GND2']])
        kit.pinMode(2, 'output'); kit.write(2, 1); kit.step(0.05)
        // (5 − Vj) / (25 + 220 + 8 Ω), Vj(12.6 mA) ≈ 1.84 + 2·Vt·ln(12.6/20) = 1.816 V → 12.6 mA.
        kit.near(kit.state('G').current[0], 0.0126, 0.0006, 'segment 1 current')
        kit.near(kit.state('G').current[1], 0, 1e-6, 'segment 2 dark')
        kit.equal(kit.state('G').lit, 1, 'one bar lit')
        kit.ok(kit.mesh('G').getObjectByName('seg_1').material.emissiveIntensity > 0.5, 'bar 1 glows')
      },
    },
    {
      name: 'plugged in backwards (anode to GND, cathode to 5 V) nothing lights; no resistor = over-current',
      run(kit) {
        kit.scene({ U: 'arduino', G: 'led_bar_graph', R: { type: 'resistor', resistance: 220 } },
          [['U:5V', 'R:1'], ['R:2', 'G:K3'], ['G:A3', 'U:GND1'], ['U:5V', 'G:A5'], ['G:K5', 'U:GND2']])
        kit.step(0.05)
        kit.near(kit.state('G').current[2], 0, 1e-6, 'reverse-biased segment 3 dark')
        // Segment 5 straight across the 5 V supply: only its 8 Ω Rs limits it → far over 30 mA.
        kit.ok(kit.state('G').current[4] > 0.1, 'segment 5 over-driven')
        kit.ok(kit.hasIssue('G:overcurrent_5'), 'over-current issue for segment 5')
      },
    },
    {
      name: 'end to end: a sketch lights the first 4 bars from pins 2–5',
      async run(kit, { runSketch }) {
        const spec = { U: 'arduino', G: 'led_bar_graph' }, wires = []
        for (let s = 1; s <= 6; s++) {
          spec['R' + s] = { type: 'resistor', resistance: 220 }
          wires.push([`U:D${s + 1}`, `R${s}:1`], [`R${s}:2`, `G:A${s}`], [`G:K${s}`, 'U:GND1'])
        }
        kit.scene(spec, wires)
        const s = runSketch(kit, `int level = 4;
void setup() {
  for (int p = 2; p <= 7; p++) pinMode(p, OUTPUT);
}
void loop() {
  for (int i = 0; i < 6; i++) {
    digitalWrite(i + 2, i < level ? HIGH : LOW);
  }
  delay(10);
}`)
        await s.run(150)
        const st = kit.state('G')
        kit.equal(st.lit, 4, 'four bars lit')
        kit.near(st.current[3], 0.0126, 0.0006, 'bar 4 current')
        kit.near(st.current[4], 0, 1e-6, 'bar 5 off')
        s.stop()
      },
    },
  ],
})
