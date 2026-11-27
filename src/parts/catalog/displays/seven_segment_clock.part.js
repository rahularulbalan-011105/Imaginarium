// Adafruit 0.56" 4-digit 7-segment display with I²C backpack (Tinkercad
// "7 segment clock display", Adafruit #878/#879/#880/#881). The backpack's
// HT16K33 drives a common-cathode 4-digit clock display (digits + centre colon)
// from its 16 × 8 display RAM. Header pins + − D C = VCC GND SDA SCL; address
// 0x70 + the A0–A2 solder jumpers (0x70…0x77).
//
// The chip is simulated through sim.i2c, so raw Wire writes and the
// Adafruit_LEDBackpack library both reach the same HT16K33 command decoder:
//   0x20|S      system setup (S = 1: oscillator on)
//   0x80|B<<1|D display setup (D = display on, B = blink 0 off · 1 2 Hz · 2 1 Hz · 3 0.5 Hz)
//   0xE0|P      dimming, 1/16 … 16/16 duty
//   0x00…0x0F   display RAM pointer, followed by data bytes (auto-increment)
// Adafruit's 7-segment wiring of that RAM: digit 0 → RAM 0x00, digit 1 → 0x02,
// colon → 0x04 (bit 1), digit 2 → 0x06, digit 3 → 0x08; bits 0–6 = a–g, bit 7 = DP.
// The display lights only after oscillator on + display on, as on the chip.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, setGlow, GOLD, BLACK, PCB_T, PITCH } from '../../model.js'

const TYPE = 'seven_segment_clock'
const W = 5.04, D = 1.9                       // 50.4 × 19 mm module
const SPACER = 0.25                           // header plastic under the backpack
const PCB_Y = SPACER                          // backpack PCB underside
const DISP_Y = PCB_Y + PCB_T                  // display body underside
const DISP_H = 0.8                            // 8 mm display body
const HX = -W / 2 + 0.2                       // header column near the left edge
const RED = 0xff2a1a
const PIN_DEF = [['VCC', '+', 'power'], ['GND', '−', 'gnd'], ['SDA', 'D', 'digital'], ['SCL', 'C', 'digital']]
const pinZ = (i) => (i - 1.5) * PITCH
const DIGIT_X = [-1.85, -0.72, 0.72, 1.85]
const DIGIT_RAM = [0, 2, 6, 8]
const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
// Segment bars [x, z, w(x), d(z)] for a 14.2 mm digit (top of the digit toward −Z).
const L = 0.33, T = 0.1
const GEOM = {
  a: [0.03, -0.66, L * 2 - 0.1, T], g: [0, 0, L * 2 - 0.1, T], d: [-0.03, 0.66, L * 2 - 0.1, T],
  f: [-0.34, -0.33, T, 0.55], b: [0.36, -0.33, T, 0.55],
  e: [-0.36, 0.33, T, 0.55], c: [0.34, 0.33, T, 0.55],
}
// HT16K33 bit pattern → character (the Adafruit number table 0–F, minus, blank).
const NUMTAB = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71]
const GLYPH = new Map([[0, ' '], [0x40, '-'], ...NUMTAB.map((m, i) => [m, i.toString(16).toUpperCase()])])
// SDA/SCL board pins: Uno A4/A5 (= SDA/SCL header), ESP32 GPIO21/22, micro:bit P20/P19.
const I2C_PAIRS = [[18, 19], [21, 22], [20, 19]]
const VMIN = 4.5, VMAX = 5.5                  // HT16K33 VDD range
const SEG_MA = 2.5                            // average mA per lit segment at 16/16 duty (multiplexed 1/8)
const LOGIC_MA = 1.0

const RUN = new WeakMap()                     // obj → run state (shared by the bridge and the solver side)

function freshState() {
  return { osc: false, on: false, blink: 0, bright: 15, ram: Array(16).fill(0), ptr: 0, digits: [' ', ' ', ' ', ' '], colon: false, lit: false, text: '     ', powered: false, writes: 0 }
}
function decode(st) {
  st.lit = st.osc && st.on
  const digits = DIGIT_RAM.map(r => {
    const m = st.ram[r] & 0xff
    const ch = GLYPH.get(m & 0x7f) ?? '?'
    return st.lit ? ch + (m & 0x80 ? '.' : '') : ' '
  })
  st.digits = digits
  st.colon = st.lit && !!(st.ram[4] & 0x02)
  st.text = `${digits[0]}${digits[1]}${st.colon ? ':' : ' '}${digits[2]}${digits[3]}`
}
function litSegments(st) {
  if (!st?.osc || !st?.on) return 0
  let n = 0
  for (const r of [...DIGIT_RAM, 4]) { let m = st.ram[r] & (r === 4 ? 0x02 : 0xff); while (m) { n += m & 1; m >>= 1 } }
  return n
}
const supply = (api) => api.vpin('VCC') - api.vpin('GND')
function wired(api) {
  const sda = api.boardPin('SDA'), scl = api.boardPin('SCL')
  return I2C_PAIRS.some(([a, b]) => a === sda && b === scl)
}

/** HT16K33 command decoder — one I²C transmission. */
export function ht16k33Write(st, bytes) {
  if (!bytes.length) return
  const c = bytes[0] & 0xff
  const hi = c & 0xf0
  if (hi === 0x00) {
    let p = c & 0x0f
    for (let i = 1; i < bytes.length; i++) { st.ram[p] = bytes[i] & 0xff; p = (p + 1) & 0x0f }
    st.ptr = p
  } else if (hi === 0x20) st.osc = !!(c & 1)
  else if (hi === 0x80) { st.on = !!(c & 1); st.blink = (c >> 1) & 3 }
  else if (hi === 0xe0) st.bright = c & 0x0f
  // 0xA0 ROW/INT set and 0x40 key-data address: accepted, no effect on the display.
  st.writes++
  decode(st)
}

const SANDBOX = `
var __seven_segment_clock_NUM = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F, 0x77, 0x7C, 0x39, 0x5E, 0x79, 0x71];
function Adafruit_7segment() {
  if (!(this instanceof Adafruit_7segment)) return new Adafruit_7segment();
  this._addr = 0x70; this._buf = [0, 0, 0, 0, 0, 0, 0, 0];
}
Adafruit_7segment.prototype = {
  _cmd: function (c) { Wire.beginTransmission(this._addr); Wire.write(c & 255); return Wire.endTransmission(); },
  begin: function (a) {
    if (a != null) this._addr = Number(a) & 0x7f;
    Wire.begin();
    var ok = this._cmd(0x21) === 0;
    this.blinkRate(0); this.setBrightness(15);
    return ok ? 1 : 0;
  },
  setBrightness: function (b) { b = Math.floor(Number(b) || 0); if (b > 15) b = 15; if (b < 0) b = 0; this._cmd(0xE0 | b); },
  blinkRate: function (b) { b = Math.floor(Number(b) || 0); if (b > 3 || b < 0) b = 0; this._cmd(0x80 | 0x01 | (b << 1)); },
  writeDisplay: function () {
    Wire.beginTransmission(this._addr); Wire.write(0x00);
    for (var i = 0; i < 8; i++) { Wire.write(this._buf[i] & 0xFF); Wire.write((this._buf[i] >> 8) & 0xFF); }
    return Wire.endTransmission();
  },
  clear: function () { for (var i = 0; i < 8; i++) this._buf[i] = 0; },
  writeDigitRaw: function (d, m) { d = Number(d); if (d > 4 || d < 0) return; this._buf[d] = Number(m) & 0xFFFF; },
  writeDigitNum: function (d, n, dot) { n = Number(n); d = Number(d); if (d > 4 || d < 0 || n > 15 || n < 0) return; this.writeDigitRaw(d, __seven_segment_clock_NUM[n] | (dot ? 0x80 : 0)); },
  drawColon: function (s) { this._buf[2] = s ? 0x02 : 0; },
  writeColon: function () { Wire.beginTransmission(this._addr); Wire.write(0x04); Wire.write(this._buf[2] & 0xFF); Wire.write((this._buf[2] >> 8) & 0xFF); Wire.endTransmission(); },
  printError: function () { for (var i = 0; i < 5; i++) this.writeDigitRaw(i, i === 2 ? 0x00 : 0x40); },
  printFloat: function (n, frac, base) {
    var digits = 4, neg = false, i;
    n = Number(n); frac = Math.floor(Number(frac) || 0); base = Number(base) || 10;
    if (!isFinite(n)) { this.printError(); return; }
    if (n < 0) { neg = true; digits--; n = -n; }
    var f = 1; for (i = 0; i < frac; i++) f *= base;
    var dn = Math.floor(n * f + 0.5);
    var big = 1; for (i = 0; i < digits; i++) big *= base;
    while (dn >= big) { frac--; f /= base; dn = Math.floor(n * f + 0.5); }
    if (f < 1) { this.printError(); return; }
    var pos = 4;
    for (i = 0; dn || i <= frac; ++i) {
      this.writeDigitNum(pos--, dn % base, frac !== 0 && i === frac);
      if (pos === 2) this.writeDigitRaw(pos--, 0x00);
      dn = Math.floor(dn / base);
    }
    if (neg) this.writeDigitRaw(pos--, 0x40);
    while (pos >= 0) this.writeDigitRaw(pos--, 0x00);
  },
  printNumber: function (n, base) { this.printFloat(n, 0, base == null ? 10 : base); },
  _printDigits: function (s) {
    if (s.length > 4) { this.printError(); return; }
    var pos = 4;
    for (var i = s.length - 1; i >= 0; i--) {
      this.writeDigitNum(pos--, parseInt(s.charAt(i), 16), false);
      if (pos === 2) this.writeDigitRaw(pos--, 0x00);
    }
    while (pos >= 0) this.writeDigitRaw(pos--, 0x00);
  },
  // The transpiler hands print() a number, or a string it already formatted:
  // a float as "12.50" (__flt), an integer in a base as "FF" (__base).
  print: function (v, b) {
    if (typeof v === 'number') {
      if (b != null) { this.printFloat(v, 0, Number(b)); return; }
      this.printFloat(v, v % 1 === 0 ? 0 : 2, 10); return;
    }
    var s = String(v == null ? '' : v), m = /^-?[0-9]+[.]([0-9]+)$/.exec(s);
    if (m) { this.printFloat(Number(s), m[1].length, 10); return; }
    if (/^-?[0-9]+$/.test(s)) { this.printFloat(Number(s), 0, 10); return; }
    if (/^[0-9A-Fa-f]+$/.test(s)) { this._printDigits(s); return; }
    this.printError();
  },
  println: function (v, b) { if (v != null) this.print(v, b); }
};
`

export default definePart({
  type: TYPE,
  label: '7 Segment Clock Display (I2C)',
  shortName: 'CLOCK',
  tinkercad: '7 segment clock display',
  category: 'displays',
  icon: '🕒',
  desc: 'Adafruit 0.56" 4-digit + colon · HT16K33 I²C backpack · 0x70',
  purpose: 'Four digits and a clock colon on just four wires: + → 5V, − → GND, D → SDA (A4), C → SCL (A5). In code: #include <Wire.h>, #include <Adafruit_GFX.h>, #include "Adafruit_LEDBackpack.h", Adafruit_7segment matrix = Adafruit_7segment(); then matrix.begin(0x70); matrix.print(1234); matrix.drawColon(true); matrix.writeDisplay(); Nothing changes on the display until writeDisplay(). Set the address in Properties to match the A0–A2 jumpers (0x70–0x77).',
  usage: 'clocks · timers · counters · scoreboards',
  spec: {
    dims_mm: { w: 50.4, h: 12.1, d: 19.0 }, mass_kg: 0.01,
    controller: 'HT16K33 (16 × 8 LED matrix driver, I²C)', vcc_V: [VMIN, VMAX], digitHeight_mm: 14.2,
    i2c: '7-bit address 0x70 + A2A1A0 jumpers', current_mA: { logic: LOGIC_MA, perSegmentAvg: SEG_MA },
    summary: 'Pins + − D C (VCC GND SDA SCL). Commands: 0x21 oscillator on, 0x81 display on (blink in bits 1–2), 0xE0–0xEF brightness, 0x00 + data writes display RAM (digit 0,1 = RAM 0,2; colon RAM 4 bit 1; digit 2,3 = RAM 6,8).',
  },
  props: {
    address: { type: 'select', label: 'I²C address', default: '0x70', options:
      [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ value: `0x7${i}`, label: `0x7${i}${i ? ` (A2A1A0 = ${i.toString(2).padStart(3, '0')})` : ' (no jumpers)'}` })) },
  },
  pins: PIN_DEF.map(([name, label, kind], i) => ({ name, label, kind, x: HX, y: 0.02, z: pinZ(i), r: 0.06, ldx: -0.3 })),
  build() {
    const g = new Group()
    // Backpack PCB (black, Adafruit) + header plastic and pins.
    g.add(box(W, PCB_T, D, mat(0x111111, { rough: 0.5 }), 0, PCB_Y + PCB_T / 2, 0))
    g.add(box(PITCH, SPACER, 4 * PITCH, BLACK(), HX, SPACER / 2, 0))
    for (let i = 0; i < 4; i++) g.add(box(0.064, SPACER + PCB_T + 0.06, 0.064, GOLD(), HX, (SPACER + PCB_T + 0.06) / 2, pinZ(i)))
    g.add(box(0.9, 0.12, 0.6, mat(0x1a1a1a, { rough: 0.7 }), 0.6, PCB_Y - 0.06, 0))        // HT16K33 SOIC under the board
    // Display body (dark grey case, black face).
    g.add(box(W - 0.02, DISP_H, D - 0.02, mat(0x2a2a2a, { rough: 0.85 }), 0, DISP_Y + DISP_H / 2, 0))
    const faceY = DISP_Y + DISP_H
    g.add(box(W - 0.1, 0.01, D - 0.1, mat(0x0d0d0d, { rough: 0.4 }), 0, faceY + 0.004, 0))
    const off = 0x3a2626
    DIGIT_X.forEach((dx, i) => {
      for (const s of SEGS) {
        const [x, z, w, d] = GEOM[s]
        const m = box(w, 0.02, d, mat(off, { rough: 0.4, emissive: 0x000000 }), dx + x, faceY + 0.012, z)
        m.name = `d${i}_${s}`
        g.add(m)
      }
      const dp = cyl(0.055, 0.02, mat(off, { rough: 0.4, emissive: 0x000000 }), { seg: 12 })
      dp.name = `d${i}_DP`
      g.add(at(dp, dx + 0.5, faceY + 0.012, 0.68))
    })
    for (const [k, z] of [['colon_top', -0.3], ['colon_bot', 0.3]]) {
      const c = cyl(0.06, 0.02, mat(off, { rough: 0.4, emissive: 0x000000 }), { seg: 12 })
      c.name = k
      g.add(at(c, 0, faceY + 0.012, z))
    }
    return g
  },
  sim: {
    initState(obj) { const st = freshState(); RUN.set(obj, st); return st },
    circuit(api) {
      // Supply load: HT16K33 logic plus the multiplexed segment current (set every step).
      return { load: api.add(resistor(api.pin('VCC'), api.pin('GND'), 5 / (LOGIC_MA / 1000))) }
    },
    beforeStep(h, api) {
      const st = RUN.get(api.obj)
      const mA = LOGIC_MA + litSegments(st) * SEG_MA * ((st?.bright ?? 15) + 1) / 16
      h.load.R = 5 / (mA / 1000)
    },
    solved(h, api) {
      const v = api.vpin('VCC') - api.vpin('GND')
      if (v > VMAX + 0.3) api.issue('overvoltage', 'error', `${api.obj.name || 'Clock display'} has ${v.toFixed(1)} V on +`, `The HT16K33 is rated ${VMIN}–${VMAX} V.`)
      else api.clearIssue('overvoltage')
      if (v > 1 && v < VMIN) api.issue('undervoltage', 'warning', `${api.obj.name || 'Clock display'} has only ${v.toFixed(1)} V on +`, `The HT16K33 needs ${VMIN}–${VMAX} V; wire + to 5V. Below ${VMIN} V it does not answer on I²C.`)
      else api.clearIssue('undervoltage')
      return { voltage: v, powered: v >= VMIN, current: Math.max(0, api.cur(h.load)) }
    },
    i2c: {
      address(api) {
        const st = api.state
        if (!(supply(api) >= VMIN)) {
          if (st.powered) Object.assign(st, freshState())      // power lost: RAM and setup gone
          return null
        }
        st.powered = true
        return wired(api) ? Number(api.prop('address')) : null
      },
      write(bytes, api) { ht16k33Write(api.state, bytes) },
      read(api) { return api.state.ram.slice() },                 // display RAM read-back from the pointer 0
    },
    visual(root, { solved, state, off }) {
      const on = !off && !!solved?.powered && !!state?.lit
      const period = [0, 500, 1000, 2000][state?.blink ?? 0]
      const phaseOn = !period || (Date.now() % period) < period / 2
      const level = on && phaseOn ? 0.3 + 0.7 * ((state.bright + 1) / 16) : 0
      DIGIT_RAM.forEach((r, i) => {
        const m = state?.ram?.[r] ?? 0
        SEGS.forEach((s, b) => setGlow(root.getObjectByName(`d${i}_${s}`), RED, m & (1 << b) ? level : 0))
        setGlow(root.getObjectByName(`d${i}_DP`), RED, m & 0x80 ? level : 0)
      })
      const colon = (state?.ram?.[4] ?? 0) & 0x02 ? level : 0
      setGlow(root.getObjectByName('colon_top'), RED, colon)
      setGlow(root.getObjectByName('colon_bot'), RED, colon)
    },
    readout({ state }) { return state?.lit ? state.text : 'off' },
  },
  code: {
    includes: ['Adafruit_LEDBackpack'], classes: ['Adafruit_7segment'],
    sandbox: SANDBOX,
    example: `#include <Wire.h>
#include <Adafruit_GFX.h>
#include "Adafruit_LEDBackpack.h"
Adafruit_7segment matrix = Adafruit_7segment();
void setup() {
  matrix.begin(0x70);
}
void loop() {
  int s = millis() / 1000;
  matrix.print((s / 60) * 100 + s % 60);
  matrix.drawColon(true);
  matrix.writeDisplay();
  delay(500);
}`,
  },
  blockly: {
    blocks: [
      {
        type: `part_${TYPE}_number`, message0: 'clock display show number %1', args0: [{ type: 'input_value', name: 'NUM', check: 'Number' }],
        previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Shows a number (up to 4 digits) on the I²C clock display at 0x70.',
      },
      {
        type: `part_${TYPE}_colon`, message0: 'clock display colon %1',
        args0: [{ type: 'field_dropdown', name: 'ON', options: [['on', 'true'], ['off', 'false']] }],
        previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Turns the centre colon on or off.',
      },
      { type: `part_${TYPE}_clear`, message0: 'clock display clear', previousStatement: null, nextStatement: null, colour: '#8b5cf6', tooltip: 'Blanks all four digits and the colon.' },
    ],
    generators: {
      [`part_${TYPE}_number`](block, gen, H) { decl(gen, H); return `clockDisplay.print(${gen.valueToCode(block, 'NUM', H.Order.NONE) || '0'});\nclockDisplay.writeDisplay();\n` },
      [`part_${TYPE}_colon`](block, gen, H) { decl(gen, H); return `clockDisplay.drawColon(${block.getFieldValue('ON') === 'true' ? 'true' : 'false'});\nclockDisplay.writeDisplay();\n` },
      [`part_${TYPE}_clear`](block, gen, H) { decl(gen, H); return 'clockDisplay.clear();\nclockDisplay.writeDisplay();\n' },
    },
  },
  tests: [
    {
      name: 'end to end: Adafruit_7segment print(1234) + writeDisplay shows 1 2 3 4; drawColon lights the colon',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', C: TYPE }, [['C:VCC', 'U:5V'], ['C:GND', 'U:GND1'], ['C:SDA', 'U:SDA'], ['C:SCL', 'U:SCL']])
        const s = runSketch(kit, `#include <Wire.h>
#include <Adafruit_GFX.h>
#include "Adafruit_LEDBackpack.h"
Adafruit_7segment matrix = Adafruit_7segment();
void setup() {
  Serial.begin(9600);
  Serial.println(matrix.begin(0x70));
  matrix.print(1234);
  matrix.drawColon(true);
  delay(60);
  matrix.writeDisplay();
}
void loop() { delay(10); }`)
        await s.run(30)
        const st = kit.partState('C')
        kit.ok(st.osc && st.on, 'begin() sent 0x21 (oscillator) and 0x81 (display on)')
        kit.equal(st.bright, 15, 'begin() sent 0xEF (full brightness)')
        kit.equal(st.digits.join(''), '    ', 'nothing shown before writeDisplay()')
        await s.run(150)
        kit.equal(st.digits.join(','), '1,2,3,4', 'digits')
        kit.equal(st.colon, true, 'colon')
        kit.equal(st.text, '12:34')
        // RAM as the HT16K33 holds it: 0x06 0x5B · colon 0x02 · 0x4F 0x66.
        kit.equal([st.ram[0], st.ram[2], st.ram[4], st.ram[6], st.ram[8]].join(','), [0x06, 0x5b, 0x02, 0x4f, 0x66].join(','), 'display RAM')
        kit.equal(s.out.join(''), '1\n', 'begin() returned true (ACK)')
        kit.ok(kit.mesh('C').getObjectByName('d0_b').material.emissiveIntensity > 0.5, 'digit 1 segment b glows')
        kit.ok(kit.mesh('C').getObjectByName('d0_a').material.emissiveIntensity === 0, 'digit 1 segment a dark')
        kit.ok(kit.mesh('C').getObjectByName('colon_top').material.emissiveIntensity > 0.5, 'colon glows')
        // 1 mA logic + 2+5+5+4 segments + colon (17 × 2.5 mA at 16/16) ≈ 43.5 mA from 5 V.
        kit.near(kit.state('C').current, 0.0435, 0.004, 'supply current')
        s.stop()
      },
    },
    {
      name: 'end to end: raw Wire HT16K33 commands; print(-1.5) and HEX through the library',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', C: { type: TYPE, address: '0x71' } }, [['C:VCC', 'U:5V'], ['C:GND', 'U:GND1'], ['C:SDA', 'U:A4'], ['C:SCL', 'U:A5']])
        let s = runSketch(kit, `#include <Wire.h>
void cmd(int c) { Wire.beginTransmission(0x71); Wire.write(c); Wire.endTransmission(); }
void setup() {
  Wire.begin();
  cmd(0x21);
  cmd(0x83);
  cmd(0xE7);
  Wire.beginTransmission(0x71);
  Wire.write(0x00);
  Wire.write(0x6D); Wire.write(0);
  Wire.write(0x3F); Wire.write(0);
  Wire.write(0x00); Wire.write(0);
  Wire.write(0x07); Wire.write(0);
  Wire.write(0xFF); Wire.write(0);
  Wire.endTransmission();
}
void loop() { delay(10); }`)
        await s.run(150)
        let st = kit.partState('C')
        kit.equal(st.text, '50 78.', 'raw RAM bytes decoded (5 0 · 7 8.)')
        kit.equal(st.blink, 1, '0x83 = display on, blink 2 Hz')
        kit.equal(st.bright, 7, '0xE7 = 8/16 duty')
        s.stop()
        kit.scene({ U: 'arduino', C: TYPE }, [['C:VCC', 'U:5V'], ['C:GND', 'U:GND1'], ['C:SDA', 'U:SDA'], ['C:SCL', 'U:SCL']])
        s = runSketch(kit, `#include <Adafruit_LEDBackpack.h>
Adafruit_7segment m;
void setup() {
  m.begin(0x70);
  float t = -1.5;
  m.print(t);
  m.writeDisplay();
  delay(60);
  m.print(0xBEEF, HEX);
  m.writeDigitNum(0, 0xB, true);
  delay(60);
  m.writeDisplay();
}
void loop() { delay(10); }`)
        await s.run(50)
        st = kit.partState('C')
        // printFloat(-1.5, 2): 3 digits left after the sign → 150, decimal after the 1.
        kit.equal(st.text, '-1. 50', 'print(-1.5) = "-1.50"')
        await s.run(150)
        kit.equal(st.text, 'B.E EF', 'print(0xBEEF, HEX) then writeDigitNum(0, 0xB, dot)')
        s.stop()
      },
    },
    {
      name: 'wrong address (sketch 0x70, jumpers 0x72) or unpowered: blank, begin() NACKs',
      async run(kit, { runSketch }) {
        const sketch = `#include <Wire.h>
#include "Adafruit_LEDBackpack.h"
Adafruit_7segment matrix = Adafruit_7segment();
void setup() { Serial.begin(9600); Serial.println(matrix.begin(0x70)); matrix.print(1234); matrix.drawColon(true); matrix.writeDisplay(); }
void loop() { delay(10); }`
        kit.scene({ U: 'arduino', C: { type: TYPE, address: '0x72' } }, [['C:VCC', 'U:5V'], ['C:GND', 'U:GND1'], ['C:SDA', 'U:SDA'], ['C:SCL', 'U:SCL']])
        let s = runSketch(kit, sketch)
        await s.run(120)
        kit.equal(kit.partState('C').text, '     ', 'wrong address → blank')
        kit.equal(kit.partState('C').writes, 0, 'nothing reached the chip')
        kit.equal(s.out.join(''), '0\n', 'begin() returned false')
        s.stop()
        kit.scene({ U: 'arduino', C: TYPE }, [['C:GND', 'U:GND1'], ['C:SDA', 'U:SDA'], ['C:SCL', 'U:SCL']])
        s = runSketch(kit, sketch)
        await s.run(120)
        kit.equal(kit.partState('C').text, '     ', '+ unwired → blank')
        kit.ok(kit.mesh('C').getObjectByName('d0_b').material.emissiveIntensity === 0, 'no segment glows')
        s.stop()
      },
    },
    {
      name: '3.3 V on + is below the HT16K33 4.5 V minimum: a warning, and the chip does not answer',
      run(kit) {
        kit.scene({ U: 'arduino', C: TYPE }, [['C:VCC', 'U:3V3'], ['C:GND', 'U:GND1'], ['C:SDA', 'U:SDA'], ['C:SCL', 'U:SCL']])
        kit.step(0.05)
        kit.ok(kit.hasIssue('C:undervoltage'), 'under-voltage warning')
        kit.equal(kit.bridge.i2cBus()[0x70], undefined, 'no device at 0x70')
      },
    },
  ],
})

function decl(gen, H) {
  H.include(gen, '<Wire.h>')
  H.include(gen, '<Adafruit_GFX.h>')
  H.include(gen, '<Adafruit_LEDBackpack.h>')
  H.define(gen, 'clockDisplay', 'Adafruit_7segment clockDisplay;')
  H.setup(gen, 'clockDisplay_begin', 'clockDisplay.begin(0x70);')
}
