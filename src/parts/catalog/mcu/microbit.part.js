// BBC micro:bit V2 (Tinkercad "micro:bit"), simulated as an Arduino-nRF5 board
// (docs/MICROBIT_RUNTIME.md, option A): the sketch is Arduino C++ with the
// Adafruit_Microbit library, exactly what the Arduino IDE flashes onto a real one.
//
//   board      51.6 × 42 mm, 3.3 V logic (src/circuit/boards.js MICROBIT)
//   edge       P0–P20 = Arduino pins 0–20; big rings P0 P1 P2 3V GND
//   buttons    A on P5, B on P11, each with the board's 10 kΩ pull-up to 3 V,
//              pressed = LOW — real switches in the circuit solver
//   display    5×5 red LED matrix via Adafruit_Microbit_Matrix
import { Group, CylinderGeometry, Mesh } from 'three'
import { definePart } from '../../definePart.js'
import { resistor, sw } from '../../../circuit/mna.js'
import { mat, box, cyl, at, GOLD, PCB_T, setGlow } from '../../model.js'
import { glyph5x5 } from './microbitFont.js'

const W = 5.16, D = 4.2
const EDGE_Z = D / 2 - 0.35
const BIG = [['P0', -1.9], ['P1', -0.95], ['P2', 0], ['3V', 0.95], ['GND', 1.9]]
// Fine pads (1.27 mm pitch) between the big rings, in edge-connector order.
const FINE = { P3: [-2.3, 0], P4: [-2.3, 1], P5: [-2.3, 2], P6: [-1.45, 0], P7: [-1.45, 1], P8: [-1.45, 2], P9: [-1.45, 3],
  P10: [-0.5, 0], P11: [-0.5, 1], P12: [-0.5, 2], P13: [0.45, 0], P14: [0.45, 1], P15: [0.45, 2], P16: [0.45, 3],
  P19: [1.4, 0], P20: [1.4, 1], P17: [2.3, 0], P18: [2.3, 1] }

const pins = [
  ...BIG.map(([name, x]) => ({ name, kind: name === 'GND' ? 'gnd' : name === '3V' ? 'power' : 'analog', x, y: PCB_T, z: EDGE_Z + 0.05, r: 0.12 })),
  ...Object.entries(FINE).map(([name, [x0, i]]) => ({ name, kind: 'digital', x: x0 + (i - 1) * 0.127, y: PCB_T, z: EDGE_Z + 0.12, r: 0.05, ldy: 0.22 + (i % 2) * 0.2 })),
]

export default definePart({
  type: 'microbit',
  label: 'micro:bit',
  shortName: 'micro:bit',
  tinkercad: 'micro:bit',
  category: 'mcu',
  icon: '🟩',
  desc: 'BBC micro:bit V2 · 5×5 LEDs · buttons A/B',
  purpose: 'The BBC micro:bit, programmed here with the Arduino API (Arduino-nRF5 core + Adafruit_Microbit library), the same code the Arduino IDE flashes onto a real board. Buttons A and B read LOW on PIN_BUTTON_A / PIN_BUTTON_B when pressed; the 5×5 display shows text and pictures. Wire parts to the big rings P0 P1 P2 (3.3 V logic), 3V and GND. MakeCode / MicroPython are not supported yet (see docs/MICROBIT_RUNTIME.md).',
  usage: 'classroom projects · games · sensing',
  spec: { dims_mm: { w: 51.6, h: 7.3, d: 42 }, mass_kg: 0.009,   // h: underside chip + 1.6 mm PCB + tactile buttons
    vcc: 3.3, summary: 'nRF52833 · 3.3 V logic · 5×5 LED matrix · buttons on P5/P11.' },
  pins,
  build() {
    const g = new Group()
    g.add(box(W, PCB_T, D, mat(0x111111, { rough: 0.5 }), 0, PCB_T / 2, 0))
    // Edge connector: gold rings + fine pads.
    for (const [, x] of BIG) {
      const ring = new Mesh(new CylinderGeometry(0.3, 0.3, 0.02, 24), GOLD())
      g.add(at(ring, x, PCB_T + 0.01, EDGE_Z))
    }
    for (const [x0, i] of Object.values(FINE)) g.add(box(0.07, 0.02, 0.4, GOLD(), x0 + (i - 1) * 0.127, PCB_T + 0.01, D / 2 - 0.2))
    // 5×5 LED matrix (named so the simulation can light each one).
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const led = box(0.12, 0.06, 0.2, mat(0x5a1010, { emissive: 0x000000, rough: 0.4 }), (c - 2) * 0.45, PCB_T + 0.03, (r - 2) * 0.45 - 0.25)
      led.name = `led_${r}_${c}`
      g.add(led)
    }
    // Buttons A (left) and B (right), the logo and the processor.
    for (const [name, x] of [['btnA', -1.9], ['btnB', 1.9]]) {
      g.add(box(0.6, 0.35, 0.6, mat(0x3a3a3a), x, PCB_T + 0.175, -0.25))
      const cap = cyl(0.2, 0.1, mat(0x1a1a1a)); cap.name = name
      g.add(at(cap, x, PCB_T + 0.4, -0.25))
    }
    g.add(box(0.7, 0.12, 0.7, mat(0x202020), 0, -0.06, -0.3))            // nRF52833 on the back
    g.add(box(0.6, 0.02, 0.35, mat(0xd4a937, { metal: 0.9, rough: 0.3 }), 0, PCB_T + 0.01, -1.7))   // touch logo
    return g
  },
  sim: {
    controls: [
      { key: 'A', kind: 'button', label: 'Button A', onLabel: 'A pressed' },
      { key: 'B', kind: 'button', label: 'Button B', onLabel: 'B pressed' },
    ],
    initState: () => ({ pixels: Array(25).fill(0), text: '', t0: 0, begun: false }),
    circuit(api) {
      // Each button: the board's 10 kΩ pull-up to 3 V and a switch to GND.
      const h = {}
      for (const [key, pin] of [['A', 'P5'], ['B', 'P11']]) {
        api.add(resistor(api.pin('3V'), api.pin(pin), 10000))
        h[key] = api.add(sw(api.pin(pin), api.pin('GND'), { Ron: 1 }))
      }
      return h
    },
    beforeStep(h, api) { h.A.closed = !!api.control('A'); h.B.closed = !!api.control('B') },
    solved(h) { return { A: h.A.closed, B: h.B.closed } },
    calls: {
      begin(args, api) { api.state.begun = true },
      clear(args, api) { api.state.pixels = Array(25).fill(0); api.state.text = '' },
      fill(args, api) { api.state.pixels = Array(25).fill(args[0] ? 1 : 0); api.state.text = '' },
      pixel([x, y, on], api) {
        if (x < 0 || x > 4 || y < 0 || y > 4) return
        api.state.pixels[y * 5 + x] = on ? 1 : 0; api.state.text = ''
      },
      // Text: one character shows as its 5×5 glyph; longer text cycles one
      // character at a time (the real library scrolls it).
      print([text], api) {
        const s = String(text)
        api.state.text = s; api.state.t0 = Date.now()
        api.state.pixels = glyph5x5(s[0] ?? ' ')
      },
      show([rows], api) {
        if (!Array.isArray(rows)) return
        const px = []
        for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) px.push(((Number(rows[r]) || 0) >> (4 - c)) & 1)
        api.state.pixels = px; api.state.text = ''
      },
    },
    visual(root, { state, off }) {
      let px = state?.pixels ?? []
      if (state?.text && state.text.length > 1) {
        const i = Math.floor((Date.now() - state.t0) / 450) % state.text.length
        px = glyph5x5(state.text[i])
      }
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
        const led = root.getObjectByName(`led_${r}_${c}`)
        setGlow(led, 0xff2a1a, off ? 0 : px[r * 5 + c] ? 1 : 0)
      }
    },
  },
  code: {
    includes: ['Adafruit_Microbit'],
    classes: ['Adafruit_Microbit_Matrix', 'Adafruit_Microbit'],
    consts: ['PIN_BUTTON_A', 'PIN_BUTTON_B', 'LED_ON', 'LED_OFF'],
    sandbox: `
function Adafruit_Microbit_Matrix() {}
Adafruit_Microbit_Matrix.prototype = {
  begin: function () { __part('microbit', 'begin', []); return true; },
  clear: function () { __part('microbit', 'clear', []); },
  fillScreen: function (c) { __part('microbit', 'fill', [Number(c) ? 1 : 0]); },
  drawPixel: function (x, y, c) { __part('microbit', 'pixel', [Number(x), Number(y), Number(c) ? 1 : 0]); },
  print: function (v) { __part('microbit', 'print', [String(v)]); },
  scrollText: function (v) { __part('microbit', 'print', [String(v)]); },
  show: function (rows) { var a = []; for (var i = 0; i < 5; i++) a.push(Number(rows && rows[i]) || 0); __part('microbit', 'show', [a]); }
};
function Adafruit_Microbit() { this.matrix = new Adafruit_Microbit_Matrix(); }
Adafruit_Microbit.prototype = { begin: function () { this.matrix.begin(); return true; } };
`,
    example: `#include <Adafruit_Microbit.h>
Adafruit_Microbit_Matrix microbit;
void setup() {
  microbit.begin();
  pinMode(PIN_BUTTON_A, INPUT);
}
void loop() {
  if (digitalRead(PIN_BUTTON_A) == LOW) { microbit.print("A"); } else { microbit.clear(); }
  delay(20);
}`,
  },
  blockly: {
    blocks: [
      { type: 'part_microbit_show_text', message0: 'micro:bit show %1', args0: [{ type: 'input_value', name: 'TEXT' }],
        previousStatement: null, nextStatement: null, colour: '#16a34a', tooltip: 'Show text or a number on the 5×5 display.' },
      { type: 'part_microbit_clear', message0: 'micro:bit clear display', previousStatement: null, nextStatement: null, colour: '#16a34a' },
      { type: 'part_microbit_button', message0: 'micro:bit button %1 is pressed',
        args0: [{ type: 'field_dropdown', name: 'BTN', options: [['A', 'PIN_BUTTON_A'], ['B', 'PIN_BUTTON_B']] }],
        output: 'Boolean', colour: '#16a34a' },
    ],
    generators: {
      part_microbit_show_text(block, gen, H) {
        H.include(gen, '<Adafruit_Microbit.h>'); H.define(gen, 'microbit', 'Adafruit_Microbit_Matrix microbit;')
        H.setup(gen, 'microbit_begin', 'microbit.begin();')
        return `microbit.print(${gen.valueToCode(block, 'TEXT', H.Order.NONE) || '""'});\n`
      },
      part_microbit_clear(block, gen, H) {
        H.include(gen, '<Adafruit_Microbit.h>'); H.define(gen, 'microbit', 'Adafruit_Microbit_Matrix microbit;')
        H.setup(gen, 'microbit_begin', 'microbit.begin();')
        return 'microbit.clear();\n'
      },
      part_microbit_button(block, gen, H) {
        const pin = block.getFieldValue('BTN')
        H.setup(gen, `mb_${pin}`, `pinMode(${pin}, INPUT);`)
        return [`(digitalRead(${pin}) == LOW)`, H.Order.EQUALITY]
      },
    },
  },
  tests: [
    {
      name: 'button A reads LOW only while pressed (on-board 10 kΩ pull-up to 3.3 V)',
      board: 'microbit',
      run(kit) {
        kit.scene({ M: 'microbit' })
        kit.pinMode(5, 'input'); kit.step(0.02)
        kit.equal(kit.digitalRead(5), 1, 'released')
        kit.near(kit.pinVoltage(5), 3.3, 0.01, 'pulled up to the 3.3 V rail')
        kit.control('M', 'A', 1); kit.step(0.02)
        kit.equal(kit.digitalRead(5), 0, 'pressed')
        kit.equal(kit.digitalRead(11), 1, 'button B untouched')
      },
    },
    {
      name: 'end to end: a sketch shows "A" on the display while button A is held',
      board: 'microbit',
      async run(kit, { runSketch }) {
        kit.scene({ M: 'microbit' })
        const s = runSketch(kit, `#include <Adafruit_Microbit.h>
Adafruit_Microbit_Matrix microbit;
void setup() { microbit.begin(); pinMode(PIN_BUTTON_A, INPUT); }
void loop() { if (digitalRead(PIN_BUTTON_A) == LOW) { microbit.print("A"); } else { microbit.clear(); } delay(10); }`)
        await s.run(120)
        kit.equal(kit.partState('M').pixels.reduce((a, b) => a + b, 0), 0, 'blank while released')
        kit.control('M', 'A', 1)
        await s.run(150)
        kit.equal(kit.partState('M').pixels.join(''), glyph5x5('A').join(''), 'the letter A is on the matrix')
        s.stop()
      },
    },
    {
      name: 'P0 drives an LED through 100 Ω at 3.3 V logic',
      board: 'microbit',
      run(kit) {
        kit.scene({ M: 'microbit', R: { type: 'resistor', resistance: 100 }, L: 'led' }, [['M:P0', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'M:GND']])
        kit.pinMode(0, 'output'); kit.write(0, 1); kit.step(0.02)
        // (3.3 V − ≈1.8 V red LED) / (100 Ω + 25 Ω pin) ≈ 12 mA → ≈60 % brightness.
        kit.between(kit.state('R').current, 0.009, 0.014, 'LED current from a 3.3 V pin')
        kit.ok(kit.led.L > 100, `LED lit (${kit.led.L})`)
      },
    },
  ],
})
