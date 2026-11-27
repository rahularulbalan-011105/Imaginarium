// 10 kΩ rotary potentiometer (Tinkercad "Potentiometer"). 9 mm PCB-mount
// type in the style of the Alps RK09K / Bourns PTV09: body 9.8 × 10 mm, three
// legs at 2.5 mm pitch on the front edge (T1, wiper W, T2), Ø6 mm shaft,
// ≈300° electrical travel, linear (B) taper, rated 0.05 W (RK09K: 0.05 W).
// Circuit model: two resistors T1–W = R·p and W–T2 = R·(1−p), p = position
// 0…1, each with the ≈20 Ω minimum end resistance of a carbon track.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, fmtSI, TIN } from '../../model.js'

const LZ = 0.42, PITCH = 0.25, BASE = 0.3, BODY_H = 0.6, TRAVEL = 300 * Math.PI / 180
const R_END = 20, P_RATED = 0.05

const posOf = (api) => {
  const c = api.control('position')
  const v = c == null ? api.prop('knobStart') : c
  return Math.max(0, Math.min(100, Number(v) || 0)) / 100
}
const knobAngle = (p) => (0.5 - p) * TRAVEL        // 0 % fully anticlockwise, 100 % fully clockwise (seen from above)

export default definePart({
  type: 'potentiometer',
  label: 'Potentiometer',
  shortName: 'POT',
  tinkercad: 'Potentiometer',
  category: 'basic',
  icon: '⟳',
  desc: '10 kΩ rotary · linear · 300° travel',
  purpose: 'A knob that is an adjustable voltage divider. Outer legs T1 to GND and T2 to 5 V, middle leg (wiper) to an analog pin: analogRead() then gives 0…1023 as you turn it. Drag its slider in the sim bar to turn it.',
  usage: 'volume / speed / brightness knobs · setting thresholds · analogRead practice',
  spec: {
    dims_mm: { w: 9.8, h: 21, d: 10.5 }, mass_kg: 0.003, power_W: P_RATED, travel_deg: 300,
    summary: 'Linear 10 kΩ. T1–T2 is always the full value; the wiper W taps a fraction of it.',
  },
  props: {
    resistance: { type: 'number', label: 'Resistance', unit: 'Ω', default: 10000, min: 100, max: 1e6 },
    knobStart: { type: 'number', label: 'Start position', unit: '%', default: 50, min: 0, max: 100 },
  },
  rebuildOn: ['knobStart'],
  pins: [
    { name: 'T1', kind: 'passive', x: -PITCH, y: 0.02, z: LZ, r: 0.06, label: '1' },
    { name: 'W', kind: 'analog', x: 0, y: 0.02, z: LZ, r: 0.06, label: 'W', ldy: 0.25 },
    { name: 'T2', kind: 'passive', x: PITCH, y: 0.02, z: LZ, r: 0.06, label: '3' },
  ],
  build(obj) {
    const g = new Group()
    g.add(box(0.98, BODY_H * 0.55, 1.0, mat(0x1f4fa0, { rough: 0.6 }), 0, BASE + BODY_H * 0.275, 0))             // resin base
    g.add(box(0.98, BODY_H * 0.45, 1.0, TIN(), 0, BASE + BODY_H * 0.775, 0))                                     // steel cover
    g.add(box(0.2, 0.06, 0.05, mat(0x1f4fa0), 0, BASE + 0.03, -0.525))                                           // anti-rotation lug
    g.add(at(cyl(0.35, 0.45, TIN(), { seg: 28 }), 0, BASE + BODY_H + 0.225, 0))                                  // threaded bushing
    const knob = new Group(); knob.name = 'knob'
    knob.add(at(cyl(0.3, 0.75, mat(0x2a2a2a, { rough: 0.5 }), { seg: 18 }), 0, 0.375, 0))                       // knurled shaft
    knob.add(box(0.05, 0.02, 0.26, mat(0xf5f5f5), 0, 0.755, 0.13))                                               // pointer line
    knob.rotation.y = knobAngle((obj.knobStart ?? 50) / 100)
    g.add(at(knob, 0, BASE + BODY_H + 0.45, 0))
    for (const x of [-PITCH, 0, PITCH]) {
      g.add(box(0.08, BASE + 0.02, 0.03, TIN(), x, (BASE + 0.02) / 2, LZ))
      g.add(box(0.08, 0.03, 0.08, TIN(), x, BASE + 0.01, LZ - 0.04))
    }
    return g
  },
  sim: {
    controls: [{ key: 'position', kind: 'slider', label: 'Knob', min: 0, max: 100, step: 1, unit: '%', default: 50 }],
    circuit(api) {
      const w = api.pin('W')
      return { a: api.add(resistor(api.pin('T1'), w, 5000)), b: api.add(resistor(w, api.pin('T2'), 5000)) }
    },
    beforeStep(h, api) {
      const R = api.prop('resistance'), p = posOf(api)
      h.p = p
      h.a.R = Math.max(R_END, R * p)
      h.b.R = Math.max(R_END, R * (1 - p))
    },
    solved(h, api) {
      const ia = api.cur(h.a), ib = api.cur(h.b)
      const pw = Math.abs(ia * ia * h.a.R) + Math.abs(ib * ib * h.b.R)
      if (pw > P_RATED) api.issue('power', 'error', `${api.obj.name || 'Potentiometer'} dissipates ${fmtSI(pw, 'W')}`,
        'A small carbon pot is rated about 0.05 W. Probably the wiper is wired straight to 5 V or GND and turned to the end — the track burns there. Wire the wiper to an input only.')
      else api.clearIssue('power')
      return { position: h.p * 100, wiper: api.vpin('W'), power: pw }
    },
    visual(root, { solved, off }, obj) {
      const knob = root.getObjectByName('knob')
      if (!knob) return
      const p = off || !solved ? (obj?.knobStart ?? 50) / 100 : solved.position / 100
      knob.rotation.y = knobAngle(p)
    },
    readout({ solved }) { return solved ? `${Math.round(solved.position)} % · ${fmtSI(solved.wiper, 'V')}` : '' },
  },
  blockly: {
    blocks: [{
      type: 'part_potentiometer_percent',
      message0: 'potentiometer on %1 position (0–100 %%)',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: [['A0', 'A0'], ['A1', 'A1'], ['A2', 'A2'], ['A3', 'A3'], ['A4', 'A4'], ['A5', 'A5']] }],
      output: 'Number', colour: '#a16207',
      tooltip: 'Reads the wiper of a potentiometer wired T1→GND, T2→5V, W→this pin, as 0…100 %.',
    }],
    generators: {
      part_potentiometer_percent(block, gen, H) {
        const pin = block.getFieldValue('PIN')
        return [`map(analogRead(${pin}), 0, 1023, 0, 100)`, H.Order.ATOMIC]
      },
    },
  },
  tests: [
    {
      name: 'wiper divides 5 V: 25 % → 1.25 V → analogRead ≈ 256, 100 % → 1023',
      run(kit) {
        const { P } = kit.scene({ U: 'arduino', P: 'potentiometer' }, [['P:T1', 'U:GND1'], ['P:T2', 'U:5V'], ['P:W', 'U:A0']])
        kit.control(P, 'position', 25); kit.step(0.02)
        // V_W = 5 V · R(T1–W) / R = 5 · 2.5 kΩ / 10 kΩ = 1.25 V (A0's 10 MΩ input load: −0.02 %).
        kit.near(kit.pinVoltage(14), 1.25, 0.01, 'wiper voltage')
        kit.near(kit.analogRead(14), 256, 2, 'analogRead at 25 %')
        kit.control(P, 'position', 100); kit.step(0.02)
        // T1–W = 10 kΩ, W–T2 = 20 Ω end resistance → 5 · 10000/10020 = 4.99 V.
        kit.near(kit.analogRead(14), 1021, 2, 'analogRead at 100 %')
        kit.control(P, 'position', 0); kit.step(0.02)
        kit.near(kit.analogRead(14), 2, 2, 'analogRead at 0 %')
      },
    },
    {
      name: 'end to end: a sketch reads the knob with analogRead and lights the LED above half way',
      async run(kit, { runSketch }) {
        const { P } = kit.scene({ U: 'arduino', P: 'potentiometer', R: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['P:T1', 'U:GND1'], ['P:T2', 'U:5V'], ['P:W', 'U:A0'], ['U:D9', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2']])
        kit.control(P, 'position', 20)
        const s = runSketch(kit, `void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
}
void loop() {
  int v = analogRead(A0);
  Serial.println(v);
  if (v > 512) { digitalWrite(9, HIGH); } else { digitalWrite(9, LOW); }
  delay(20);
}`)
        await s.run(150)
        // 20 % → 1.0 V → 205 counts.
        const lastNumber = () => Number(s.out.join(' ').split(/\s+/).filter(t => /^[0-9]+$/.test(t)).pop())
        const first = lastNumber()
        kit.near(first, 205, 3, 'sketch reads ≈205 at 20 %')
        kit.ok(!(kit.led.L > 2), 'LED off below half')
        kit.control(P, 'position', 80)
        await s.run(150)
        const second = lastNumber()
        kit.near(second, 818, 3, 'sketch reads ≈818 at 80 %')
        kit.ok(kit.state('P').wiper > 3.9, 'wiper ≈ 4 V')
        // LED: (5 − 1.82 V) / (220 + 25 Ω) ≈ 13 mA → 13/20 · 255 ≈ 165.
        kit.between(kit.led.L, 150, 185, 'LED on above half way')
        s.stop()
      },
    },
    {
      name: 'knob model turns with the slider (≈300° travel)',
      run(kit) {
        const { P } = kit.scene({ U: 'arduino', P: 'potentiometer' }, [['P:T1', 'U:GND1'], ['P:T2', 'U:5V']])
        kit.control(P, 'position', 0); kit.step(0.02)
        const a0 = kit.mesh('P').getObjectByName('knob').rotation.y
        kit.control(P, 'position', 100); kit.step(0.02)
        const a1 = kit.mesh('P').getObjectByName('knob').rotation.y
        kit.near(Math.abs(a1 - a0) * 180 / Math.PI, 300, 0.5, 'travel in degrees')
      },
    },
    {
      name: 'power error when the wiper shorts 5 V to GND at the track end',
      run(kit) {
        const { P } = kit.scene({ U: 'arduino', P: 'potentiometer' }, [['P:T1', 'U:5V'], ['P:W', 'U:GND1']])
        kit.control(P, 'position', 1); kit.step(0.02)
        // T1–W = 100 Ω at 1 %: P = 5² / 100 Ω = 0.25 W > 0.05 W.
        kit.near(kit.state('P').power, 0.25, 0.01, 'track power')
        kit.ok(kit.hasIssue('P:power'), 'power issue')
      },
    },
  ],
})
