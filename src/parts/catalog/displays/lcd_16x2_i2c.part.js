// 16 × 2 character LCD with a PCF8574 I²C backpack (Tinkercad "LCD 16 x 2 (I2C)").
// The 1602 module (see lcd_16x2) with the common 41.5 × 19 mm backpack soldered
// on its header: 4 pins GND · VCC · SDA · SCL, address 0x27 (PCF8574T) or 0x3F
// (PCF8574AT), on-board contrast trimmer (set) and 4.7 kΩ I²C pull-ups.
// PCF8574 bit map (as in LiquidCrystal_I2C): P0 RS · P1 RW · P2 E · P3 backlight ·
// P4–P7 → D4–D7, so the LCD always runs in 4-bit mode.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, setGlow, GOLD, PCB_T, PITCH } from '../../model.js'
import { addLed } from '../lights/ledKit.js'
import { hdReset, hdResetInto, hdApply, lcdVisual, lcdTextApiSource } from './hd44780.js'
import { lcdBody, makeLcdTexture, LCD_W } from './lcdModel.js'

const PCB_Y = 1.0                      // LCD PCB raised above the backpack
const BP_Y = 0.35                      // backpack PCB underside
const HX = -LCD_W / 2 - 0.2            // backpack header sticks out past the LCD's left edge
const PIN_NAMES = ['GND', 'VCC', 'SDA', 'SCL']
const pinZ = (i) => (i - 1.5) * PITCH
const backlights = new WeakMap()       // obj → backlight bit from the last transfer
// SDA/SCL board pins: Uno A4/A5 (= the SDA/SCL header) or ESP32 GPIO21/22.
const I2C_PAIRS = [[18, 19], [21, 22]]

const SANDBOX = `
function LiquidCrystal_I2C(addr, cols, rows, charsize) {
  if (!(this instanceof LiquidCrystal_I2C)) return new LiquidCrystal_I2C(addr, cols, rows, charsize);
  this._addr = Number(addr); this._cols = Number(cols) || 16; this._rows = Number(rows) || 2; this._charsize = charsize || 0;
  this._lines = this._rows; this._bl = 0; this._q = []; this._dc = 0x04; this._dm = 0x02;
}
LiquidCrystal_I2C.prototype = {
  _x: function (rs, b) { this._q.push(4, rs, (b >> 4) & 15, 4, rs, b & 15); },
  _cmd: function (b) { this._x(0, b); },
  _data: function (b) { this._x(1, b); },
  _flush: function (force) {
    if (!this._q.length && !force) return;
    __part('lcd_16x2_i2c', 'bus', [this._addr, this._q, this._bl]);
    this._q = [];
  },
  init: function () { Wire.begin(); this.begin(this._cols, this._rows, this._charsize); },
  begin: function (cols, lines, dotsize) {
    if (cols != null) this._cols = Number(cols) || 16;
    this._lines = lines != null ? (Number(lines) || 1) : this._rows;
    var ds = dotsize != null ? dotsize : this._charsize;
    var fn = (this._lines > 1 ? 0x08 : 0) | (ds && this._lines === 1 ? 0x04 : 0);
    this._q.push(4, 0, 3, 4, 0, 3, 4, 0, 3, 4, 0, 2);
    this._cmd(0x20 | fn);
    this._dc = 0x04; this._cmd(0x08 | this._dc);
    this._cmd(0x01);
    this._dm = 0x02; this._cmd(0x04 | this._dm);
    this._cmd(0x02);
    this._flush(true);
  },
  backlight: function () { this._bl = 1; this._flush(true); },
  noBacklight: function () { this._bl = 0; this._flush(true); },
  setBacklight: function (v) { this._bl = v ? 1 : 0; this._flush(true); },
  printstr: function (s) { return this.print(s); },
  load_custom_character: function (n, m) { this.createChar(n, m); },
  cursor_on: function () { this.cursor(); }, cursor_off: function () { this.noCursor(); },
  blink_on: function () { this.blink(); }, blink_off: function () { this.noBlink(); },
${lcdTextApiSource()}};
`

export default definePart({
  type: 'lcd_16x2_i2c',
  label: 'LCD 16 x 2 (I2C)',
  shortName: 'LCD',
  tinkercad: 'LCD 16 x 2 (I2C)',
  category: 'displays',
  icon: '📟',
  desc: 'HD44780 16 × 2 + PCF8574 backpack · 4 wires · 0x27 / 0x3F',
  purpose: 'The 16 × 2 LCD on just four wires: GND→GND, VCC→5V, SDA→A4 (SDA), SCL→A5 (SCL). In code: #include <LiquidCrystal_I2C.h>, LiquidCrystal_I2C lcd(0x27, 16, 2); then lcd.init(); lcd.backlight(); lcd.print("Hello"); Set the address in Properties to match the sketch (0x27 for PCF8574T, 0x3F for PCF8574AT).',
  usage: 'menus · sensor readouts · projects short of pins',
  spec: {
    dims_mm: { w: 82.3, h: 18.6, d: 36 }, mass_kg: 0.04,
    controller: 'HD44780 + PCF8574 I/O expander', vcc_V: [4.5, 5.5], i2c: '100 kHz, 4.7 kΩ pull-ups on board',
    current_mA: { logic: 1.5, backlight: 19 },
    summary: 'Pins GND VCC SDA SCL. PCF8574 P0 RS, P1 RW, P2 E, P3 backlight, P4–P7 D4–D7 (4-bit).',
  },
  props: {
    address: { type: 'select', label: 'I²C address', default: '0x27', options: [
      { value: '0x27', label: '0x27 (PCF8574T)' }, { value: '0x3F', label: '0x3F (PCF8574AT)' }] },
  },
  pins: PIN_NAMES.map((name, i) => ({ name, kind: name === 'GND' ? 'gnd' : name === 'VCC' ? 'power' : 'digital', x: HX, y: 0.02, z: pinZ(i), r: 0.06, label: name, ldx: -0.3 })),
  build() {
    const g = new Group()
    lcdBody(g, PCB_Y)
    // Backpack under the LCD: blue PCB, PCF8574 SOIC, blue contrast trimmer, backlight jumper.
    g.add(box(4.15, PCB_T, 1.9, mat(0x1d4ed8, { rough: 0.5 }), HX + 2.1, BP_Y + PCB_T / 2, 0))
    g.add(box(1.0, 0.18, 0.75, mat(0x1a1a1a, { rough: 0.7 }), HX + 2.4, BP_Y - 0.09, 0.3))
    g.add(at(cyl(0.3, 0.45, mat(0x2563eb, { rough: 0.6 }), { seg: 16 }), HX + 3.4, BP_Y + PCB_T + 0.225, -0.35))
    g.add(box(0.5, 0.25, 0.25, mat(0x111111), HX + 1.2, BP_Y + PCB_T + 0.125, -0.6))
    // 16 header pins joining backpack and LCD.
    for (let i = 0; i < 16; i++) g.add(box(0.064, PCB_Y - BP_Y, 0.064, GOLD(), -LCD_W / 2 + 0.8 + i * PITCH, (PCB_Y + BP_Y) / 2, -1.55))
    // 4-pin I²C header, pins down to the breadboard.
    g.add(box(0.254, 0.25, 4 * PITCH, mat(0x111111, { rough: 0.7 }), HX, BP_Y - 0.125, 0))
    for (let i = 0; i < 4; i++) g.add(box(0.064, BP_Y + PCB_T + 0.1, 0.064, GOLD(), HX, (BP_Y + PCB_T + 0.1) / 2, pinZ(i)))
    return g
  },
  sim: {
    initState: () => ({ ...hdReset(16, 2), backlight: 0 }),
    circuit(api) {
      const vcc = api.pin('VCC'), gnd = api.pin('GND'), mid = api.node()
      return {
        logic: api.add(resistor(vcc, gnd, 3300)),                 // HD44780 + PCF8574 ≈1.5 mA
        pullSda: api.add(resistor(api.pin('SDA'), vcc, 4700)),    // on-board I²C pull-ups
        pullScl: api.add(resistor(api.pin('SCL'), vcc, 4700)),
        blSw: api.add(resistor(vcc, mid, 1e9)),                   // backlight: 100 Ω via the P3 transistor
        bl: addLed(api, mid, gnd, 3.1),
      }
    },
    beforeStep(h, api) { h.blSw.R = backlights.get(api.obj) ? 100 : 1e9 },
    solved(h, api) {
      const v = api.vpin('VCC') - api.vpin('GND'), ibl = Math.max(0, api.cur(h.bl))
      if (v > 5.7) api.issue('overvoltage', 'error', `${api.obj.name || 'LCD'} has ${v.toFixed(1)} V on VCC`, 'The module is rated 4.5–5.5 V.')
      else api.clearIssue('overvoltage')
      return { voltage: v, powered: v >= 4.5, backlightCurrent: ibl, backlight: Math.min(1, ibl / 0.02), contrast: 1 }
    },
    calls: {
      bus([addr, q, bl], api) {
        const st = api.state
        const v = api.vpin('VCC') - api.vpin('GND')
        if (!(v >= 4.5)) { st.powered = false; backlights.set(api.obj, 0); return }
        if (!st.powered) { hdResetInto(st, 16, 2); st.backlight = 0; st.powered = true }
        const sda = api.boardPin('SDA'), scl = api.boardPin('SCL')
        const wired = I2C_PAIRS.some(([a, b]) => a === sda && b === scl)
        if (!wired || Number(addr) !== Number(api.prop('address'))) { st.ignored = (st.ignored ?? 0) + 1; return }   // no ACK
        st.backlight = bl ? 1 : 0
        backlights.set(api.obj, st.backlight)
        hdApply(st, q)
      },
    },
    visual(root, { solved, state, off }) {
      const on = !off && !!solved?.powered
      lcdVisual(root, { st: state, on, backlight: off ? 0 : (solved?.backlight ?? 0), contrast: 1 }, setGlow, makeLcdTexture)
    },
    readout({ state }) { return state?.text ? state.text.map(t => t.trimEnd()).join(' | ') : '' },
  },
  code: {
    includes: ['LiquidCrystal_I2C'], classes: ['LiquidCrystal_I2C'],
    sandbox: SANDBOX,
    example: `#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() {
  lcd.init();
  lcd.backlight();
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
        type: 'part_lcd_16x2_i2c_print', message0: 'I2C LCD print %1', args0: [{ type: 'input_value', name: 'TEXT', check: ['String', 'Number'] }],
        previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Prints at the cursor on the I²C LCD at 0x27 (SDA A4, SCL A5).',
      },
      {
        type: 'part_lcd_16x2_i2c_setcursor', message0: 'I2C LCD set cursor column %1 row %2',
        args0: [{ type: 'field_number', name: 'COL', value: 0, min: 0, max: 15, precision: 1 }, { type: 'field_number', name: 'ROW', value: 0, min: 0, max: 1, precision: 1 }],
        previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Moves the cursor (column 0–15, row 0–1).',
      },
      { type: 'part_lcd_16x2_i2c_clear', message0: 'I2C LCD clear', previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Clears the screen.' },
    ],
    generators: {
      part_lcd_16x2_i2c_print(block, gen, H) { decl(gen, H); return `lcd_i2c.print(${gen.valueToCode(block, 'TEXT', H.Order.NONE) || '""'});\n` },
      part_lcd_16x2_i2c_setcursor(block, gen, H) { decl(gen, H); return `lcd_i2c.setCursor(${block.getFieldValue('COL')}, ${block.getFieldValue('ROW')});\n` },
      part_lcd_16x2_i2c_clear(block, gen, H) { decl(gen, H); return 'lcd_i2c.clear();\n' },
    },
  },
  tests: [
    {
      name: 'end to end: init + backlight + print shows "Hello" in row 0 at 0x27 on SDA/SCL',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', L: 'lcd_16x2_i2c' }, [['L:GND', 'U:GND1'], ['L:VCC', 'U:5V'], ['L:SDA', 'U:SDA'], ['L:SCL', 'U:SCL']])
        const s = runSketch(kit, `#include <Wire.h>
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello");
  lcd.setCursor(3, 1);
  lcd.print(-7);
}
void loop() { delay(10); }`)
        await s.run(150)
        const st = kit.partState('L')
        kit.equal(st.text[0], 'Hello' + ' '.repeat(11), 'row 0')
        kit.equal(st.text[1], '   -7' + ' '.repeat(11), 'row 1 from column 3')
        kit.equal(st.backlight, 1, 'backlight bit set')
        // Backlight branch 100 Ω + 8 Ω Rs from 5 V into a 3.1 V white LED ≈ 19.1 mA.
        kit.near(kit.state('L').backlightCurrent, 0.0191, 0.001, 'backlight current')
        s.stop()
      },
    },
    {
      name: 'wrong address (0x3F module, sketch says 0x27) or SDA/SCL swapped: nothing shown',
      async run(kit, { runSketch }) {
        const sketch = `#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() { lcd.init(); lcd.backlight(); lcd.print("Hello"); }
void loop() { delay(10); }`
        kit.scene({ U: 'arduino', L: { type: 'lcd_16x2_i2c', address: '0x3F' } }, [['L:GND', 'U:GND1'], ['L:VCC', 'U:5V'], ['L:SDA', 'U:A4'], ['L:SCL', 'U:A5']])
        let s = runSketch(kit, sketch)
        await s.run(100)
        kit.equal(kit.partState('L').text[0].trim(), '', 'no ACK at 0x27 → blank')
        kit.equal(kit.partState('L').backlight, 0, 'backlight stays off')
        s.stop()
        kit.scene({ U: 'arduino', L: 'lcd_16x2_i2c' }, [['L:GND', 'U:GND1'], ['L:VCC', 'U:5V'], ['L:SDA', 'U:A5'], ['L:SCL', 'U:A4']])
        s = runSketch(kit, sketch)
        await s.run(100)
        kit.equal(kit.partState('L').text[0].trim(), '', 'SDA/SCL swapped → blank')
        s.stop()
      },
    },
    {
      name: 'end to end: clear() and noBacklight(); with VCC unwired nothing is shown',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', L: 'lcd_16x2_i2c' }, [['L:GND', 'U:GND1'], ['L:SDA', 'U:SDA'], ['L:SCL', 'U:SCL']])
        let s = runSketch(kit, `#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() { lcd.init(); lcd.backlight(); lcd.print("Hello"); }
void loop() { delay(10); }`)
        await s.run(100)
        kit.equal(kit.partState('L').text[0].trim(), '', 'VCC unwired → blank')
        s.stop()
        kit.scene({ U: 'arduino', L: 'lcd_16x2_i2c' }, [['L:GND', 'U:GND1'], ['L:VCC', 'U:5V'], ['L:SDA', 'U:SDA'], ['L:SCL', 'U:SCL']])
        s = runSketch(kit, `#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup() {
  lcd.init();
  lcd.backlight();
  lcd.print("Old");
  lcd.clear();
  lcd.print("New");
  lcd.noBacklight();
}
void loop() { delay(10); }`)
        await s.run(150)
        kit.equal(kit.partState('L').text[0].trimEnd(), 'New', 'clear() wiped the old text')
        kit.equal(kit.partState('L').backlight, 0, 'backlight off')
        kit.near(kit.state('L').backlightCurrent, 0, 1e-5, 'no backlight current')
        s.stop()
      },
    },
  ],
})

function decl(gen, H) {
  H.include(gen, '<Wire.h>')
  H.include(gen, '<LiquidCrystal_I2C.h>')
  H.define(gen, 'lcd_i2c', 'LiquidCrystal_I2C lcd_i2c(0x27, 16, 2);')
  H.setup(gen, 'lcd_i2c_init', 'lcd_i2c.init();')
  H.setup(gen, 'lcd_i2c_bl', 'lcd_i2c.backlight();')
}
