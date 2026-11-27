// ATtiny85 (Tinkercad "ATtiny"): 8-bit AVR in a DIP-8, programmed with the
// Arduino API (ATTinyCore / damellis core numbering — pins 0–5 = PB0–PB5).
// Pinout (datasheet, top view, notch left): 1 PB5/RESET · 2 PB3 · 3 PB4 · 4 GND ·
// 5 PB0 · 6 PB1 · 7 PB2 · 8 VCC.
//
// It is a BOARD for the simulator (src/circuit/boards.js ATTINY85): its pins are
// driven by the sketch, and — having no USB or regulator — its logic level is the
// voltage on its own VCC pin, which must come from a battery or supply.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { dip, dipPins } from '../../model.js'

const NAMES = ['PB5', 'PB3', 'PB4', 'GND', 'PB0', 'PB1', 'PB2', 'VCC']
const LABELS = { PB5: '5', PB3: '3', PB4: '4', GND: 'GND', PB0: '~0', PB1: '~1', PB2: '2', VCC: 'VCC' }

export default definePart({
  type: 'attiny85',
  label: 'ATtiny85',
  shortName: 'ATtiny85',
  tinkercad: 'ATtiny85',
  category: 'mcu',
  icon: '⬛',
  desc: '8-pin AVR · 6 I/O · 2.7–5.5 V',
  purpose: 'A tiny programmable chip: six I/O pins (0–5), PWM on 0, 1 and 4, analog inputs A1–A3. It has no USB power: wire VCC (pin 8) to a 2.7–5.5 V battery or supply and GND (pin 4) to its negative, then program it with the Arduino API. Push it into a breadboard across the centre channel.',
  usage: 'small gadgets · LED throwies · wearables',
  spec: { dims_mm: { w: 10.2, h: 7.0, d: 8.8 }, mass_kg: 0.0005, vcc: 5,   // PDIP-8, lead tip to package top ≈ 7 mm
    flash_kB: 8, ram_B: 512, summary: '8 kB flash · 512 B RAM · 2.7–5.5 V · 40 mA per pin max.' },
  pins: dipPins(NAMES).map(p => ({ ...p, label: LABELS[p.name], kind: p.name === 'GND' ? 'gnd' : p.name === 'VCC' ? 'power' : ['PB0', 'PB1', 'PB4'].includes(p.name) ? 'pwm' : 'digital' })),
  build() {
    const g = new Group()
    g.add(dip(8, { label: 'ATTINY85' }))
    return g
  },
  code: {
    consts: ['PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5'],
  },
  tests: [
    {
      name: 'blinks an LED on PB0 from a sketch, powered by a 3 V coin cell',
      board: 'attiny85',
      async run(kit, { runSketch }) {
        kit.scene({ T: 'attiny85', C: 'battery_coin_cr2032', R: { type: 'resistor', resistance: 100 }, L: 'led' },
          [['C:POS', 'T:VCC'], ['C:NEG', 'T:GND'], ['T:PB0', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'T:GND']])
        const s = runSketch(kit, `void setup() { pinMode(PB0, OUTPUT); }
void loop() { digitalWrite(PB0, HIGH); delay(80); digitalWrite(PB0, LOW); delay(80); }`)
        const seen = new Set()
        for (let i = 0; i < 12; i++) { await s.run(30); seen.add((kit.led.L ?? 0) > 20 ? 'on' : 'off') }
        s.stop()
        kit.ok(seen.has('on') && seen.has('off'), `the LED blinks (saw ${[...seen]})`)
        // With the LED lit the output follows the cell, not a fixed 5 V:
        // ≈(3 V − 40 Ω·I) at VCC, minus the LED's ≈1.85 V, over 100 + 25 Ω.
        kit.ok(!kit.hasIssue('vcc'), 'a 3 V cell is inside 2.7–5.5 V')
      },
    },
    {
      name: 'reads a pushbutton on PB2 with INPUT_PULLUP (pull-up to its own VCC)',
      board: 'attiny85',
      run(kit) {
        kit.scene({ T: 'attiny85', C: 'battery_coin_cr2032', B: 'pushbutton' },
          [['C:POS', 'T:VCC'], ['C:NEG', 'T:GND'], ['B:1a', 'T:PB2'], ['B:2a', 'T:GND']])
        kit.pinMode(2, 'pullup'); kit.step(0.02)
        kit.equal(kit.digitalRead(2), 1, 'released: HIGH')
        kit.between(kit.pinVoltage(2), 2.9, 3.0, 'the pull-up reaches the 3 V rail, not 5 V')
        kit.control('B', 'pressed', 1); kit.step(0.02)
        kit.equal(kit.digitalRead(2), 0, 'pressed: LOW')
      },
    },
    {
      name: 'unpowered (no VCC) it raises an issue and its outputs stay at 0 V',
      board: 'attiny85',
      run(kit) {
        kit.scene({ T: 'attiny85', R: { type: 'resistor', resistance: 1000 } }, [['T:PB1', 'R:1'], ['R:2', 'T:GND']])
        kit.pinMode(1, 'output'); kit.write(1, 1); kit.step(0.02)
        kit.near(kit.pinVoltage(1), 0, 1e-3, 'no supply, no output')
        kit.ok([...kit.issues.keys()].some(k => k.includes('vcc')), 'a not-powered issue is raised')
      },
    },
  ],
})
