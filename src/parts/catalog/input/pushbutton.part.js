// 6 × 6 mm tactile pushbutton (Tinkercad "Pushbutton"). Four legs: the two on
// each side 6.5 mm apart (1a–1b, 2a–2b) are the same metal strip inside; pressing
// the button joins strip 1 to strip 2. Straddle a breadboard's centre gap.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { sw } from '../../../circuit/mna.js'
import { mat, box, cyl, at, TIN } from '../../model.js'

const LX = 0.325, LZ = 0.225       // leg spacing 6.5 × 4.5 mm

export default definePart({
  type: 'pushbutton',
  label: 'Pushbutton',
  shortName: 'BTN',
  tinkercad: 'Pushbutton',
  category: 'input',
  icon: '🔘',
  desc: '6 × 6 mm tactile · momentary',
  purpose: 'Connects its two sides while held down. Wire one leg to a pin and the opposite-side leg to GND, then use pinMode(pin, INPUT_PULLUP): the pin reads LOW while pressed. During the simulation, hold its button in the sim bar.',
  usage: 'user input · start buttons · menus',
  spec: { dims_mm: { w: 7.1, h: 5.0, d: 6.0 }, mass_kg: 0.0004, rating: '12 V 50 mA', summary: 'Legs 1a–1b and 2a–2b are always joined; pressing joins 1 to 2.' },
  pins: [
    { name: '1a', kind: 'passive', x: -LX, y: 0.02, z: -LZ, r: 0.07 },
    { name: '1b', kind: 'passive', x: LX, y: 0.02, z: -LZ, r: 0.07 },
    { name: '2a', kind: 'passive', x: -LX, y: 0.02, z: LZ, r: 0.07, ldy: 0.25 },
    { name: '2b', kind: 'passive', x: LX, y: 0.02, z: LZ, r: 0.07, ldy: 0.25 },
  ],
  internal: [['1a', '1b'], ['2a', '2b']],
  build() {
    const g = new Group()
    g.add(box(0.6, 0.35, 0.6, mat(0x1c1c1c, { rough: 0.8 }), 0, 0.075 + 0.175, 0))
    g.add(box(0.62, 0.02, 0.62, TIN(), 0, 0.43, 0))                       // steel cover
    const cap = cyl(0.175, 0.15, mat(0x2b2b2b, { rough: 0.6 }))
    cap.name = 'cap'
    g.add(at(cap, 0, 0.5, 0))
    for (const [x, z] of [[-LX, -LZ], [LX, -LZ], [-LX, LZ], [LX, LZ]]) {
      g.add(box(0.07, 0.12, 0.03, TIN(), x * 0.95, 0.06, z))               // leg foot to y = 0
      g.add(box(0.05, 0.02, 0.03, TIN(), x * 0.98, 0.12, z))
    }
    return g
  },
  sim: {
    controls: [{ key: 'pressed', kind: 'button', label: 'Hold to press', onLabel: 'Pressed' }],
    circuit(api) { return { s: api.add(sw(api.pin('1a'), api.pin('2a'), { Ron: 0.05 })) } },
    beforeStep(h, api) { h.s.closed = !!api.control('pressed') },
    solved(h, api) { return { pressed: h.s.closed } },
    visual(root, { solved }) {
      const cap = root.getObjectByName('cap')
      if (cap) cap.position.y = solved?.pressed ? 0.46 : 0.5
    },
  },
  blockly: {
    blocks: [{
      type: 'part_button_pressed',
      message0: 'button on pin %1 is pressed',
      args0: [{ type: 'field_number', name: 'PIN', value: 2, min: 0, max: 19, precision: 1 }],
      output: 'Boolean', colour: '#0891b2',
      tooltip: 'True while a pushbutton wired between this pin and GND is held (uses the internal pull-up).',
    }],
    generators: {
      part_button_pressed(block, gen, H) {
        const pin = block.getFieldValue('PIN')
        H.setup(gen, `btn_${pin}`, `pinMode(${pin}, INPUT_PULLUP);`)
        return [`(digitalRead(${pin}) == LOW)`, H.Order.EQUALITY]
      },
    },
  },
  tests: [
    {
      name: 'reads LOW on an INPUT_PULLUP pin only while pressed',
      run(kit) {
        const { B, U } = kit.scene({ U: 'arduino', B: 'pushbutton' }, [['B:1a', 'U:D2'], ['B:2b', 'U:GND1']])
        kit.pinMode(2, 'pullup')
        kit.step(0.02)
        kit.equal(kit.digitalRead(2), 1, 'released: the pull-up holds the pin HIGH')
        kit.control(B, 'pressed', 1); kit.step(0.02)
        kit.equal(kit.digitalRead(2), 0, 'pressed: the pin is pulled to GND')
        kit.near(kit.pinVoltage(2), 0, 0.05, 'pressed pin voltage')
        void U
      },
    },
    {
      name: 'a floating INPUT pin with the button released reads LOW (no pull-up)',
      run(kit) {
        kit.scene({ U: 'arduino', B: 'pushbutton' }, [['B:1a', 'U:D3'], ['B:2a', 'U:5V']])
        kit.pinMode(3, 'input'); kit.step(0.02)
        kit.equal(kit.digitalRead(3), 0)
        kit.control('B', 'pressed', 1); kit.step(0.02)
        kit.equal(kit.digitalRead(3), 1, 'pressed: 5 V reaches the pin')
      },
    },
    {
      name: 'end to end: a C++ sketch lights an LED (via 220 Ω) while the button is held',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', B: 'pushbutton', R: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['B:1a', 'U:D2'], ['B:2a', 'U:GND1'], ['U:D13', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2']])
        const s = runSketch(kit, `void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}
void loop() {
  if (digitalRead(2) == LOW) { digitalWrite(13, HIGH); } else { digitalWrite(13, LOW); }
  delay(5);
}`)
        await s.run(150)
        kit.ok(!(kit.led.L > 0), 'LED dark while the button is up')
        kit.control('B', 'pressed', 1)
        await s.run(200)
        // (5 V − ≈2 V LED) / (220 Ω + 25 Ω pin) ≈ 12 mA → ≈60 % of full 20 mA brightness.
        kit.between(kit.led.L, 120, 200, 'LED brightness while pressed')
        s.stop()
      },
    },
  ],
})
