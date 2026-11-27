// 5 mm 4-leg RGB LED (Tinkercad "RGB LED"). Diffused dome Ø5 mm, flange Ø5.8 mm,
// 8.6 mm tall; legs on 2.54 mm pitch in the order R · COM · G · B (COM is the
// longest leg — SparkFun COM-09264 / Adafruit #159 pinout). Three junctions:
// red AlGaInP Vf ≈ 2.0 V, green and blue InGaN Vf ≈ 3.2 V (typ. @ 20 mA),
// each rated 20 mA continuous / 30 mA max. Common cathode or common anode.
import { Group, Mesh, SphereGeometry } from 'three'
import { definePart } from '../../definePart.js'
import { mat, cyl, at, lead, setGlow } from '../../model.js'
import { addLed, ledLevel, checkLedCurrent, mixColor } from './ledKit.js'

const LEG_X = { R: -0.381, COM: -0.127, G: 0.127, B: 0.381 }
const BODY_Y = 0.4                  // flange underside (legs below it)
const VF = { R: 2.0, G: 3.2, B: 3.2 }
const IMAX = 0.03

export default definePart({
  type: 'rgb_led',
  label: 'RGB LED',
  shortName: 'RGB',
  tinkercad: 'RGB LED',
  category: 'lights',
  icon: '🌈',
  desc: '5 mm · common cathode / anode · R 2.0 V, G/B 3.2 V',
  purpose: 'Three LEDs (red, green, blue) in one dome. Give each colour leg its own 220 Ω resistor to a PWM pin and wire COM to GND (common cathode) or to 5 V (common anode). analogWrite() on the three pins mixes any colour; on a common-anode LED, 0 is full on and 255 is off.',
  usage: 'status colours · mood lights · colour mixing',
  spec: {
    dims_mm: { w: 8.1, h: 12.6, d: 5.8 }, mass_kg: 0.00035,
    vf_V: VF, if_mA: 20, ifMax_mA: 30,
    summary: 'Legs R · COM · G · B. Vf red 2.0 V, green 3.2 V, blue 3.2 V at 20 mA; 30 mA absolute max per colour.',
  },
  props: {
    common: { type: 'select', label: 'Common leg', default: 'cathode', options: [
      { value: 'cathode', label: 'Common cathode (COM → GND)' }, { value: 'anode', label: 'Common anode (COM → 5 V)' }] },
  },
  pins: ['R', 'COM', 'G', 'B'].map((name, i) => ({
    name, kind: 'passive', x: LEG_X[name], y: 0.02, z: 0, r: 0.06,
    label: name === 'COM' ? 'COM' : name, ldy: i % 2 ? 0.28 : 0,
  })),
  build() {
    const g = new Group()
    const dome = mat(0xf2f2f2, { rough: 0.35, emissive: 0x000000, opacity: 0.92 })
    const flange = cyl(0.29, 0.1, dome, { seg: 28 }); flange.name = 'flange'
    g.add(at(flange, 0, BODY_Y + 0.05, 0))
    const body = cyl(0.25, 0.51, dome, { seg: 28 }); body.name = 'glow'
    g.add(at(body, 0, BODY_Y + 0.1 + 0.255, 0))
    const cap = new Mesh(new SphereGeometry(0.25, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), dome)
    cap.name = 'dome'
    g.add(at(cap, 0, BODY_Y + 0.61, 0))
    // Flat on the flange marks the cathode side on most RGB LEDs (by the R leg).
    // Legs: straight down from the dome, spreading to the 2.54 mm pitch.
    for (const [name, x] of Object.entries(LEG_X)) {
      const top = name === 'COM' ? BODY_Y + 0.06 : BODY_Y + 0.02
      const inner = x * 0.45
      g.add(lead([inner, BODY_Y + 0.3, 0], [inner, top, 0], { r: 0.022 }))
      g.add(lead([inner, top, 0], [x, BODY_Y - 0.12, 0], { r: 0.022 }))
      g.add(lead([x, BODY_Y - 0.12, 0], [x, 0, 0], { r: 0.022 }))
    }
    return g
  },
  sim: {
    circuit(api) {
      const anode = api.prop('common') === 'anode'
      const com = api.pin('COM'), h = {}
      for (const ch of ['R', 'G', 'B']) {
        h[ch] = anode ? addLed(api, com, api.pin(ch), VF[ch]) : addLed(api, api.pin(ch), com, VF[ch])
      }
      return h
    },
    solved(h, api) {
      const cur = {}, lvl = {}
      for (const ch of ['R', 'G', 'B']) {
        cur[ch] = Math.max(0, api.cur(h[ch]))
        lvl[ch] = ledLevel(cur[ch])
        checkLedCurrent(api, `overcurrent_${ch}`, cur[ch], IMAX, { R: 'the red LED', G: 'the green LED', B: 'the blue LED' }[ch])
      }
      const m = mixColor(lvl.R, lvl.G, lvl.B)
      return { current: cur, level: lvl, color: { r: Math.round(lvl.R * 255), g: Math.round(lvl.G * 255), b: Math.round(lvl.B * 255) }, glowHex: m.hex, brightness: m.level }
    },
    visual(root, { solved, off }) {
      const on = !off && solved && solved.brightness > 0
      for (const n of ['dome', 'glow', 'flange']) {
        const mesh = root.getObjectByName(n)
        if (mesh) setGlow(mesh, on ? solved.glowHex : 0x000000, on ? solved.brightness : 0)
      }
    },
    readout({ solved }) {
      if (!solved) return ''
      const c = solved.current
      return `R ${(c.R * 1000).toFixed(1)} · G ${(c.G * 1000).toFixed(1)} · B ${(c.B * 1000).toFixed(1)} mA`
    },
  },
  blockly: {
    blocks: [{
      type: 'part_rgb_led_color',
      message0: 'RGB LED (%1) on pins R %2 G %3 B %4 colour red %5 green %6 blue %7',
      args0: [
        { type: 'field_dropdown', name: 'COMMON', options: [['common cathode', 'CC'], ['common anode', 'CA']] },
        { type: 'field_number', name: 'PR', value: 9, min: 0, max: 13, precision: 1 },
        { type: 'field_number', name: 'PG', value: 10, min: 0, max: 13, precision: 1 },
        { type: 'field_number', name: 'PB', value: 11, min: 0, max: 13, precision: 1 },
        { type: 'field_number', name: 'R', value: 255, min: 0, max: 255, precision: 1 },
        { type: 'field_number', name: 'G', value: 0, min: 0, max: 255, precision: 1 },
        { type: 'field_number', name: 'B', value: 128, min: 0, max: 255, precision: 1 },
      ],
      previousStatement: null, nextStatement: null, colour: '#eab308',
      tooltip: 'Mixes a colour with analogWrite() on three PWM pins (3, 5, 6, 9, 10, 11 on an Uno). Common anode inverts the values.',
    }],
    generators: {
      part_rgb_led_color(block, gen, H) {
        const inv = block.getFieldValue('COMMON') === 'CA'
        const out = []
        for (const ch of ['R', 'G', 'B']) {
          const pin = block.getFieldValue('P' + ch)
          const v = Math.max(0, Math.min(255, Math.round(Number(block.getFieldValue(ch)) || 0)))
          H.setup(gen, `rgb_pin_${pin}`, `pinMode(${pin}, OUTPUT);`)
          out.push(`analogWrite(${pin}, ${inv ? 255 - v : v});`)
        }
        return out.join('\n') + '\n'
      },
    },
  },
  tests: [
    {
      name: 'common cathode, each colour from its own pin through 220 Ω: real per-colour currents',
      run(kit) {
        kit.scene({ U: 'arduino', L: 'rgb_led',
          RR: { type: 'resistor', resistance: 220 }, RG: { type: 'resistor', resistance: 220 }, RB: { type: 'resistor', resistance: 220 } },
        [['U:D9', 'RR:1'], ['RR:2', 'L:R'], ['U:D10', 'RG:1'], ['RG:2', 'L:G'], ['U:D11', 'RB:1'], ['RB:2', 'L:B'], ['L:COM', 'U:GND1']])
        for (const p of [9, 10, 11]) kit.pinMode(p, 'output')
        kit.write(9, 1); kit.step(0.05)
        // Red: Vj(20 mA) = 2.0 − 20 mA·8 Ω = 1.84 V; at ≈12.6 mA Vj ≈ 1.84 + 2·Vt·ln(12.6/20) ≈ 1.816 V.
        // I = (5 − 1.816) / (25 pin + 220 + 8 Rs) ≈ 12.6 mA.
        kit.near(kit.state('L').current.R, 0.0126, 0.0006, 'red current')
        kit.equal(kit.state('L').color.g, 0, 'green off')
        kit.write(9, 0); kit.write(11, 1); kit.step(0.05)
        // Blue (InGaN, n = 3.5 → n·Vt = 90.5 mV): Vj(20 mA) = 3.04 V; at ≈8.07 mA
        // Vj ≈ 3.04 + 0.0905·ln(8.07/20) ≈ 2.958 V → I = (5 − 2.958)/253 ≈ 8.07 mA.
        kit.near(kit.state('L').current.B, 0.0081, 0.0005, 'blue current')
        kit.near(kit.state('L').current.R, 0, 1e-5, 'red off')
      },
    },
    {
      name: 'PWM mixing: red 255 + blue 200 glows magenta-red, and half duty is dimmer than full',
      run(kit) {
        kit.scene({ U: 'arduino', L: 'rgb_led',
          RR: { type: 'resistor', resistance: 220 }, RG: { type: 'resistor', resistance: 220 }, RB: { type: 'resistor', resistance: 220 } },
        [['U:D9', 'RR:1'], ['RR:2', 'L:R'], ['U:D10', 'RG:1'], ['RG:2', 'L:G'], ['U:D11', 'RB:1'], ['RB:2', 'L:B'], ['L:COM', 'U:GND1']])
        kit.analogWrite(9, 255); kit.analogWrite(10, 0); kit.analogWrite(11, 200); kit.step(0.05)
        const s = kit.state('L')
        kit.ok(s.current.R > s.current.B && s.current.B > 0, 'red brighter than blue, blue on')
        kit.equal(s.current.G < 1e-5, true, 'green off')
        const glow = kit.mesh('L').getObjectByName('dome').material.emissive
        kit.ok(glow.r > glow.b && glow.b > 0 && glow.g === 0, 'dome glows red + some blue')
        const full = s.current.R
        kit.analogWrite(9, 128); kit.step(0.05)
        kit.between(kit.state('L').current.R, 1e-4, full * 0.75, 'half-duty red is dimmer')
      },
    },
    {
      name: 'common-anode wiring: COM to 5 V, a LOW pin lights its colour; wrong common lights nothing',
      run(kit) {
        kit.scene({ U: 'arduino', L: { type: 'rgb_led', common: 'anode' }, RG: { type: 'resistor', resistance: 220 } },
          [['L:COM', 'U:5V'], ['L:G', 'RG:1'], ['RG:2', 'U:D10']])
        kit.pinMode(10, 'output'); kit.write(10, 0); kit.step(0.05)
        // Same as blue: (5 − 2.958 V) / (0.05 + 220 + 25 + 8 Ω) ≈ 8.07 mA through green.
        kit.near(kit.state('L').current.G, 0.0081, 0.0005, 'green sinks into a LOW pin')
        kit.write(10, 1); kit.step(0.05)
        kit.near(kit.state('L').current.G, 0, 1e-5, 'HIGH pin = off on common anode')
        // Same wiring with a common-CATHODE LED: every junction is reversed.
        kit.scene({ U: 'arduino', L: { type: 'rgb_led', common: 'cathode' }, RG: { type: 'resistor', resistance: 220 } },
          [['L:COM', 'U:5V'], ['L:G', 'RG:1'], ['RG:2', 'U:D10']])
        kit.pinMode(10, 'output'); kit.write(10, 0); kit.step(0.05)
        kit.near(kit.state('L').current.G, 0, 1e-6, 'reversed junction carries nothing')
      },
    },
    {
      name: 'no resistor: red straight between a HIGH pin and GND is over-current',
      run(kit) {
        kit.scene({ U: 'arduino', L: 'rgb_led' }, [['U:D9', 'L:R'], ['L:COM', 'U:GND1']])
        kit.pinMode(9, 'output'); kit.write(9, 1); kit.step(0.05)
        // Only the 25 Ω pin + 8 Ω Rs limit it: ≈ (5 − 1.9) / 33 ≈ 90 mA.
        kit.ok(kit.state('L').current.R > 0.06, 'tens of mA')
        kit.ok(kit.hasIssue('L:overcurrent_R'), 'red over-current issue raised')
      },
    },
    {
      name: 'end to end: a sketch fades blue with analogWrite while red stays on',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', L: 'rgb_led',
          RR: { type: 'resistor', resistance: 220 }, RB: { type: 'resistor', resistance: 220 } },
        [['U:D9', 'RR:1'], ['RR:2', 'L:R'], ['U:D11', 'RB:1'], ['RB:2', 'L:B'], ['L:COM', 'U:GND1']])
        const s = runSketch(kit, `void setup() {
  pinMode(9, OUTPUT);
  pinMode(11, OUTPUT);
}
void loop() {
  analogWrite(9, 255);
  analogWrite(11, 200);
  delay(10);
}`)
        await s.run(150)
        const st = kit.state('L')
        kit.near(st.current.R, 0.0126, 0.0006, 'red full on')
        kit.ok(st.current.B > 0.001, 'blue on')
        kit.ok(st.color.r > 0 && st.color.b > 0, 'mixed colour reported')
        s.stop()
      },
    },
  ],
})
