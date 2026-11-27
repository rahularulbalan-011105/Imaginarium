// 16 × 2 character LCD (Tinkercad "LCD 16 x 2"): standard 1602A module with an
// HD44780-compatible controller, 80 × 36 mm, 16-pin header
// (1 VSS · 2 VDD · 3 V0 · 4 RS · 5 RW · 6 E · 7–14 D0–D7 · 15 A · 16 K),
// blue STN panel with a white LED backlight. Here the header pins point down
// into a breadboard.
//
// Electrical model: logic ≈1.5 mA (VDD–VSS 3.3 kΩ); RW has the controller's
// pull-up (≈50 kΩ to VDD), so RW must be tied to GND for writes; V0 is the
// bottom of the bias ladder (≈10 kΩ to VDD): contrast follows VDD − V0 (≈4.2 V+
// for full contrast, so V0 near 0 V — a floating V0 shows nothing); backlight
// A → on-board resistor (prop, 100 Ω on most modules) → white LED (Vf ≈ 3.1 V) → K.
// The LiquidCrystal library (sandbox) sends the real nibble/byte transfers; the
// HD44780 emulation (hd44780.js) only receives them when RS, E and the data
// lines are wired to the pins the sketch passed and VDD/VSS are powered.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, setGlow, GOLD } from '../../model.js'
import { addLed } from '../lights/ledKit.js'
import { hdReset, hdResetInto, hdApply, lcdVisual, lcdTextApiSource } from './hd44780.js'
import { lcdBody, hdrX, HDR_Z, LCD_PIN_NAMES, makeLcdTexture } from './lcdModel.js'

const PCB_Y = 0.6
const KINDS = { VSS: 'gnd', VDD: 'power', V0: 'analog', A: 'power', K: 'gnd' }

const SANDBOX = `
function LiquidCrystal() {
  var A = [], i;
  for (i = 0; i < arguments.length; i++) A.push(Number(arguments[i]));
  if (!(this instanceof LiquidCrystal)) { var o = Object.create(LiquidCrystal.prototype); LiquidCrystal.apply(o, A); return o; }
  var n = A.length, s;
  if (n >= 11) s = { rs: A[0], rw: A[1], en: A[2], d: A.slice(3, 11), bits: 8 };
  else if (n === 10) s = { rs: A[0], rw: 255, en: A[1], d: A.slice(2, 10), bits: 8 };
  else if (n === 7) s = { rs: A[0], rw: A[1], en: A[2], d: A.slice(3, 7), bits: 4 };
  else s = { rs: A[0], rw: 255, en: A[1], d: A.slice(2, 6), bits: 4 };
  this._sig = s; this._q = []; this._cols = 16; this._lines = 1; this._dc = 0x04; this._dm = 0x02;
  this.begin(16, 1);
}
LiquidCrystal.prototype = {
  _x: function (rs, b) {
    if (this._sig.bits === 4) this._q.push(4, rs, (b >> 4) & 15, 4, rs, b & 15);
    else this._q.push(8, rs, b & 255);
  },
  _cmd: function (b) { this._x(0, b); },
  _data: function (b) { this._x(1, b); },
  _flush: function () {
    if (!this._q.length) return;
    var s = this._sig;
    __part('lcd_16x2', 'bus', [s.rs, s.rw, s.en, s.d, s.bits, this._q]);
    this._q = [];
  },
  begin: function (cols, lines, dotsize) {
    var s = this._sig, i;
    this._cols = Number(cols) || 16; this._lines = Number(lines) || 1;
    var fn = (s.bits === 8 ? 0x10 : 0) | (this._lines > 1 ? 0x08 : 0) | (dotsize && this._lines === 1 ? 0x04 : 0);
    pinMode(s.rs, OUTPUT); if (s.rw !== 255) { pinMode(s.rw, OUTPUT); digitalWrite(s.rw, LOW); } pinMode(s.en, OUTPUT);
    for (i = 0; i < s.d.length; i++) pinMode(s.d[i], OUTPUT);
    if (s.bits === 4) { this._q.push(4, 0, 3, 4, 0, 3, 4, 0, 3, 4, 0, 2); }
    else { this._q.push(8, 0, 0x20 | fn, 8, 0, 0x20 | fn, 8, 0, 0x20 | fn); }
    this._cmd(0x20 | fn);
    this._dc = 0x04; this._cmd(0x08 | this._dc);
    this._cmd(0x01);
    this._dm = 0x02; this._cmd(0x04 | this._dm);
    this._flush();
  },
${lcdTextApiSource()}};
`

export default definePart({
  type: 'lcd_16x2',
  label: 'LCD 16 x 2',
  shortName: 'LCD',
  tinkercad: 'LCD 16 x 2',
  category: 'displays',
  icon: '📟',
  desc: 'HD44780 · 16 × 2 characters · parallel 4/8-bit',
  purpose: 'Shows two lines of 16 characters. Classic wiring: VSS→GND, VDD→5V, V0→GND (or a 10 kΩ pot wiper for contrast), RS→12, RW→GND, E→11, D4–D7→5,4,3,2, A→5V, K→GND. In code: #include <LiquidCrystal.h>, LiquidCrystal lcd(12, 11, 5, 4, 3, 2); then lcd.begin(16, 2); lcd.print("Hello");',
  usage: 'menus · sensor readouts · clocks',
  spec: {
    dims_mm: { w: 80, h: 14.6, d: 36 }, mass_kg: 0.035,
    controller: 'HD44780 (or compatible)', vdd_V: [4.5, 5.5], logic_mA: 1.5, backlight: 'white LED, Vf ≈ 3.1 V, ≈19 mA via 100 Ω',
    viewArea_mm: [64.5, 16], pinPitch_mm: 2.54,
    summary: 'Pins 1–16: VSS VDD V0 RS RW E D0–D7 A K. RW must be at GND; contrast needs V0 near 0–0.8 V.',
  },
  props: {
    backlightR: { type: 'number', label: 'On-board backlight resistor', unit: 'Ω', default: 100, min: 0, max: 10000 },
  },
  pins: LCD_PIN_NAMES.map((name, i) => ({ name, kind: KINDS[name] ?? 'digital', x: hdrX(i), y: 0.02, z: HDR_Z, r: 0.06, label: name, ldy: i % 2 ? 0.28 : 0 })),
  build() {
    const g = new Group()
    lcdBody(g, PCB_Y)
    g.add(box(16 * 0.254, 0.25, 0.254, mat(0x111111, { rough: 0.7 }), hdrX(7.5), PCB_Y - 0.125, HDR_Z))   // header plastic under the PCB
    for (let i = 0; i < 16; i++) {
      g.add(box(0.064, PCB_Y + 0.26, 0.064, GOLD(), hdrX(i), (PCB_Y + 0.26) / 2, HDR_Z))
      g.add(box(0.16, 0.01, 0.16, GOLD(), hdrX(i), PCB_Y + 0.165, HDR_Z))
    }
    return g
  },
  sim: {
    initState: () => hdReset(16, 2),
    circuit(api) {
      const vdd = api.pin('VDD'), vss = api.pin('VSS'), mid = api.node()
      return {
        logic: api.add(resistor(vdd, vss, 3300)),
        rwPull: api.add(resistor(api.pin('RW'), vdd, 50000)),
        bias: api.add(resistor(vdd, api.pin('V0'), 10000)),
        blR: api.add(resistor(api.pin('A'), mid, Math.max(0.01, api.prop('backlightR')))),
        bl: addLed(api, mid, api.pin('K'), 3.1),
      }
    },
    solved(h, api) {
      const v = api.vpin('VDD') - api.vpin('VSS')
      const vlcd = api.vpin('VDD') - api.vpin('V0')
      const ibl = Math.max(0, api.cur(h.bl))
      const name = api.obj.name || 'LCD'
      if (v > 5.5 + 0.2) api.issue('overvoltage', 'error', `${name} has ${v.toFixed(1)} V on VDD`, 'The HD44780 is rated 4.5–5.5 V (7 V absolute max).')
      else api.clearIssue('overvoltage')
      if (ibl > 0.04) api.issue('backlight', 'error', `${name} backlight draws ${(ibl * 1000).toFixed(0)} mA`, 'Add a series resistor (≈100 Ω from 5 V) to pin A.')
      else api.clearIssue('backlight')
      const powered = v >= 4.5
      return { voltage: v, powered, contrast: powered ? Math.max(0, Math.min(1, (vlcd - 3.0) / 1.2)) : 0, backlightCurrent: ibl, backlight: Math.min(1, ibl / 0.02) }
    },
    calls: {
      bus([rs, rw, en, d, bits, q], api) {
        const st = api.state
        const v = api.vpin('VDD') - api.vpin('VSS')
        if (!(v >= 4.5)) { st.powered = false; return }
        if (!st.powered) { hdResetInto(st, 16, 2); st.powered = true }
        const lines = bits === 8 ? ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'] : ['D4', 'D5', 'D6', 'D7']
        const ok = api.boardPin('RS') === Number(rs) && api.boardPin('E') === Number(en) &&
          (Number(rw) !== 255 ? api.boardPin('RW') === Number(rw) : api.level('RW') === 0) &&
          lines.every((n, i) => api.boardPin(n) === Number(d?.[i]))
        if (!ok) { st.ignored = (st.ignored ?? 0) + 1; return }
        hdApply(st, q)
      },
    },
    visual(root, { solved, state, off }) {
      const on = !off && !!solved?.powered
      lcdVisual(root, { st: state, on, backlight: off ? 0 : (solved?.backlight ?? 0), contrast: solved?.contrast ?? 0 }, setGlow, makeLcdTexture)
    },
    readout({ state }) { return state?.text ? state.text.map(t => t.trimEnd()).join(' | ') : '' },
  },
  code: {
    includes: ['LiquidCrystal'], classes: ['LiquidCrystal'],
    sandbox: SANDBOX,
    example: `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
void setup() {
  lcd.begin(16, 2);
  lcd.print("Hello, world!");
}
void loop() {
  lcd.setCursor(0, 1);
  lcd.print(millis() / 1000);
  delay(200);
}`,
  },
  blockly: {
    blocks: [
      {
        type: 'part_lcd_16x2_print', message0: 'LCD print %1', args0: [{ type: 'input_value', name: 'TEXT', check: ['String', 'Number'] }],
        previousStatement: null, nextStatement: null, colour: '#8b5cf6',
        tooltip: 'Prints text or a number at the cursor (LCD wired RS 12, E 11, D4–D7 on 5, 4, 3, 2).',
      },
      {
        type: 'part_lcd_16x2_setcursor', message0: 'LCD set cursor column %1 row %2',
        args0: [{ type: 'field_number', name: 'COL', value: 0, min: 0, max: 15, precision: 1 }, { type: 'field_number', name: 'ROW', value: 0, min: 0, max: 1, precision: 1 }],
        previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Moves the cursor (column 0–15, row 0–1).',
      },
      { type: 'part_lcd_16x2_clear', message0: 'LCD clear', previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Clears the screen and homes the cursor.' },
    ],
    generators: {
      part_lcd_16x2_print(block, gen, H) { lcdDecl(gen, H); return `lcd.print(${gen.valueToCode(block, 'TEXT', H.Order.NONE) || '""'});\n` },
      part_lcd_16x2_setcursor(block, gen, H) { lcdDecl(gen, H); return `lcd.setCursor(${block.getFieldValue('COL')}, ${block.getFieldValue('ROW')});\n` },
      part_lcd_16x2_clear(block, gen, H) { lcdDecl(gen, H); return 'lcd.clear();\n' },
    },
  },
  tests: [
    {
      name: 'end to end: classic 4-bit wiring — the sketch shows "Hello" in row 0 and a float + int in row 1',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', L: 'lcd_16x2' }, classicWires())
        const s = runSketch(kit, `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
void setup() {
  lcd.begin(16, 2);
  lcd.print("Hello");
  lcd.setCursor(0, 1);
  lcd.print(3.14159);
  lcd.print(" ");
  lcd.print(42);
}
void loop() { delay(10); }`)
        await s.run(150)
        const st = kit.partState('L')
        kit.equal(st.text[0], 'Hello' + ' '.repeat(11), 'row 0')
        kit.equal(st.text[1], '3.14 42' + ' '.repeat(9), 'row 1 (float prints 2 decimals, like Arduino Print)')
        kit.equal(st.displayOn, true, 'display on after begin()')
        kit.equal(st.twoLine && !st.eightBit, true, '4-bit, 2-line mode')
        const sol = kit.state('L')
        kit.ok(sol.powered && sol.contrast === 1, 'powered, V0 at GND = full contrast')
        // Backlight: (5 − Vj) / (100 Ω + 8 Ω Rs + 0.05 Ω) with Vj ≈ 2.94 + 0.0905·ln(I/20 mA) → ≈19.1 mA.
        kit.near(sol.backlightCurrent, 0.0191, 0.0008, 'backlight current')
        s.stop()
      },
    },
    {
      name: 'wiring errors show nothing: a data line on the wrong pin, or RW left floating (pulled up = read mode)',
      async run(kit, { runSketch }) {
        const sketch = `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
void setup() { lcd.begin(16, 2); lcd.print("Hello"); }
void loop() { delay(10); }`
        kit.scene({ U: 'arduino', L: 'lcd_16x2' }, classicWires().map(w => w[0] === 'L:D4' ? ['L:D4', 'U:D6'] : w))
        let s = runSketch(kit, sketch)
        await s.run(100)
        kit.equal(kit.partState('L').text[0].trim(), '', 'D4 on pin 6 instead of 5 → blank')
        s.stop()
        kit.scene({ U: 'arduino', L: 'lcd_16x2' }, classicWires().filter(w => w[0] !== 'L:RW'))
        s = runSketch(kit, sketch)
        await s.run(100)
        kit.equal(kit.partState('L').text[0].trim(), '', 'RW floating → no writes')
        kit.equal(kit.partState('L').displayOn, false, 'still in power-on reset (display off)')
        s.stop()
      },
    },
    {
      name: 'end to end: 8-bit constructor, createChar, scrollDisplayLeft, clear/home and noDisplay',
      async run(kit, { runSketch }) {
        const w = [['L:VSS', 'U:GND1'], ['L:VDD', 'U:5V'], ['L:V0', 'U:GND2'], ['L:RW', 'U:GND3'], ['L:RS', 'U:D12'], ['L:E', 'U:D11'],
          ['L:A', 'U:5V'], ['L:K', 'U:GND1']]
        const dp = [2, 3, 4, 5, 6, 7, 8, 9]
        dp.forEach((p, i) => w.push([`L:D${i}`, `U:D${p}`]))
        kit.scene({ U: 'arduino', L: 'lcd_16x2' }, w)
        const s = runSketch(kit, `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 2, 3, 4, 5, 6, 7, 8, 9);
byte heart[8] = {0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000};
int step = 0;
void setup() {
  lcd.begin(16, 2);
  lcd.createChar(0, heart);
  lcd.home();
  lcd.print("AB");
  lcd.write((byte)0);
  lcd.scrollDisplayLeft();
}
void loop() { delay(10); }`)
        await s.run(150)
        const st = kit.partState('L')
        kit.equal(st.eightBit, true, '8-bit mode')
        kit.equal(JSON.stringify(st.cgram.slice(0, 8)), '[0,10,31,31,14,4,0,0]', 'CGRAM 0 holds the heart')
        // DDRAM 0x00 'A', 0x01 'B', 0x02 = char 0; after one left scroll column 0 shows address 0x01.
        kit.equal(st.text[0].slice(0, 2), 'B\u0000', 'scrolled left by one, custom char visible')
        s.stop()
      },
    },
  ],
})

function lcdDecl(gen, H) {
  H.include(gen, '<LiquidCrystal.h>')
  H.define(gen, 'lcd', 'LiquidCrystal lcd(12, 11, 5, 4, 3, 2);')
  H.setup(gen, 'lcd_begin', 'lcd.begin(16, 2);')
}
function classicWires() {
  return [['L:VSS', 'U:GND1'], ['L:VDD', 'U:5V'], ['L:V0', 'U:GND2'], ['L:RS', 'U:D12'], ['L:RW', 'U:GND3'], ['L:E', 'U:D11'],
    ['L:D4', 'U:D5'], ['L:D5', 'U:D4'], ['L:D6', 'U:D3'], ['L:D7', 'U:D2'], ['L:A', 'U:5V'], ['L:K', 'U:GND1']]
}
