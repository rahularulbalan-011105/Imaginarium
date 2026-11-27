// 4×4 matrix membrane keypad (Tinkercad "Keypad 4x4"). 69 × 77 × 0.8 mm
// membrane, 86 mm ribbon ending in an 8-way 2.54 mm female connector, pins
// left → right R1 R2 R3 R4 C1 C2 C3 C4. Key (r, c) shorts row line r to
// column line c; membrane contact resistance 10–500 Ω (100 Ω used), rated
// 24 V DC / 30 mA. Sketches use the Arduino Keypad library (Stanley & Brevig),
// implemented in the sandbox below with its real API and state machine.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { sw } from '../../../circuit/mna.js'
import { mat, box, at, PITCH, textPlane } from '../../model.js'

export const KEYS = [['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']]
const PIN_NAMES = ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4']
const MEM_W = 6.9, MEM_D = 7.7, MEM_T = 0.08, RIB_L = 8.0, CON_D = 0.6, CON_H = PITCH
const KEY_Y = MEM_T + 0.02, Z_END = MEM_D / 2 + RIB_L + CON_D
const keyXZ = (r, c) => ({ x: (c - 1.5) * 1.6, z: -0.3 + (r - 1.5) * 1.75 })
const keyColor = (k) => (/[A-D]/.test(k) ? 0xd32f2f : /[*#]/.test(k) ? 0x455a64 : 0x1e88e5)
const findKey = (label) => {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (KEYS[r][c] === label) return { r, c }
  return null
}

// ── Keypad library (sandbox, ES5) ────────────────────────────────────────────
// getKey() reports a key only when the keypad's row and column lines are wired
// to the pins the sketch passed — matched as an unordered pair, exactly as the
// library's scan (drive a row LOW, read the columns) sees a closed contact. A
// keypad plugged in back to front therefore reports the transposed key, and an
// unwired one reports nothing, like hardware.
const SANDBOX = `
var NO_KEY = 0, IDLE = 0, PRESSED = 1, HOLD = 2, RELEASED = 3, OPEN = 0, CLOSED = 1, LIST_MAX = 10, MAPSIZE = 10;
var makeKeymap = function (k) {
  var out = [];
  var walk = function (a) { for (var i = 0; i < a.length; i++) { if (a[i] && typeof a[i] === 'object') walk(a[i]); else out.push(a[i]); } };
  if (k && typeof k === 'object') walk(k);
  return out;
};
var __keypad_4x4_scan = function (kp) {
  var all = __partIn('keypad_4x4');
  for (var id in all) {
    var k = all[id];
    if (!k || k.a == null || k.b == null) continue;
    for (var i = 0; i < kp._nr; i++) for (var j = 0; j < kp._nc; j++) {
      var r = kp._rows[i], c = kp._cols[j];
      if ((r === k.a && c === k.b) || (r === k.b && c === k.a)) return i * kp._nc + j;
    }
  }
  return -1;
};
function Keypad(map, rows, cols, nr, nc) {
  if (!(this instanceof Keypad)) return new Keypad(map, rows, cols, nr, nc);
  this._nr = Number(nr) || (rows ? rows.length : 0);
  this._nc = Number(nc) || (cols ? cols.length : 0);
  this._rows = []; this._cols = [];
  for (var i = 0; i < this._nr; i++) this._rows.push(Number(rows[i]));
  for (var j = 0; j < this._nc; j++) this._cols.push(Number(cols[j]));
  this.begin(map);
  this._deb = 10; this._hold = 500; this._t = -1e9; this._since = 0; this._cur = -1; this._fn = null;
  this.key = [];
  for (var n = 0; n < LIST_MAX; n++) this.key.push({ kchar: NO_KEY, kcode: -1, kstate: IDLE, stateChanged: false });
  // The library leaves every row and column pin as INPUT_PULLUP between scans.
  for (var a = 0; a < this._nr; a++) pinMode(this._rows[a], 2);
  for (var b = 0; b < this._nc; b++) pinMode(this._cols[b], 2);
}
Keypad.prototype = {
  begin: function (map) { this._map = makeKeymap(map || []); },
  _go: function (s) {
    var k = this.key[0];
    k.kstate = s; k.stateChanged = true;
    if (this._fn) { try { var r = this._fn(k.kchar); if (r && r.catch) r.catch(function () {}); } catch (e) {} }
  },
  getKeys: function () {
    var now = millis();
    if (now - this._t < this._deb) return false;
    this._t = now;
    var k = this.key[0];
    k.stateChanged = false;
    var idx = __keypad_4x4_scan(this);
    if (k.kstate === IDLE) {
      if (idx >= 0) {
        var ch = this._map[idx];
        this._cur = idx; k.kchar = ch == null ? NO_KEY : ch; k.kcode = idx; this._since = now;
        this._go(PRESSED);
      }
    } else if (k.kstate === PRESSED) {
      if (idx !== this._cur) this._go(RELEASED);
      else if (now - this._since > this._hold) this._go(HOLD);
    } else if (k.kstate === HOLD) {
      if (idx !== this._cur) this._go(RELEASED);
    } else if (k.kstate === RELEASED) {
      this._go(IDLE);
      this._cur = -1; k.kchar = NO_KEY; k.kcode = -1;
    }
    return k.stateChanged;
  },
  getKey: function () {
    if (this.getKeys() && this.key[0].stateChanged && this.key[0].kstate === PRESSED) return this.key[0].kchar;
    return NO_KEY;
  },
  getState: function () { return this.key[0].kstate; },
  keyStateChanged: function () { return this.key[0].stateChanged; },
  isPressed: function (ch) { var k = this.key[0]; return k.kchar === ch && k.kstate === PRESSED && k.stateChanged; },
  findInList: function (ch) { return this.key[0].kchar === ch && this.key[0].kstate !== IDLE ? 0 : -1; },
  numKeys: function () { return this.key[0].kstate === IDLE ? 0 : 1; },
  setDebounceTime: function (ms) { this._deb = Math.max(1, Number(ms) || 1); },
  setHoldTime: function (ms) { this._hold = Math.max(0, Number(ms) || 0); },
  addEventListener: function (fn) { this._fn = typeof fn === 'function' ? fn : null; },
  waitForKey: async function () {
    var k = NO_KEY;
    while ((k = this.getKey()) === NO_KEY) { if (!RUNNING) throw new Error('stopped'); await delay(5); }
    return k;
  },
};
`

export default definePart({
  type: 'keypad_4x4',
  label: 'Keypad 4×4',
  shortName: 'KEYPAD',
  tinkercad: 'Keypad 4x4',
  category: 'input',
  icon: '⌨',
  desc: '16-key membrane matrix · 8-pin ribbon',
  purpose: 'Sixteen keys in a 4 × 4 matrix: pressing a key connects its row line to its column line. Plug the 8 ribbon pins (R1–R4, C1–C4) into 8 digital pins and use the Keypad library: Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, 4, 4); then keypad.getKey(). Press keys in the sim bar.',
  usage: 'PIN-code locks · menus · calculators',
  // d = 77 mm membrane + 80 mm ribbon + 6 mm connector.
  spec: { dims_mm: { w: 69, h: 2.54, d: (MEM_D / 2 + Z_END) * 10 },
    mass_kg: 0.008, rating: '24 V DC 30 mA', contact_ohm: 100, debounce_ms: 10, hold_ms: 500,
    summary: 'Key (row r, column c) shorts Rr to Cc. Pins R1 R2 R3 R4 C1 C2 C3 C4, left to right.' },
  pins: PIN_NAMES.map((name, i) => ({ name, kind: 'digital', x: (i - 3.5) * PITCH, y: CON_H / 2, z: Z_END, r: 0.06, ldy: i % 2 ? 0.25 : 0 })),
  build() {
    const g = new Group()
    g.add(box(MEM_W, MEM_T, MEM_D, mat(0x161616, { rough: 0.8 }), 0, MEM_T / 2, 0))
    KEYS.forEach((row, r) => row.forEach((k, c) => {
      const { x, z } = keyXZ(r, c)
      const key = box(1.25, 0.04, 1.25, mat(keyColor(k), { rough: 0.5 }), x, KEY_Y, z)
      key.name = `key_${k}`
      g.add(key)
      const t = textPlane(k, 0.6, 0.6, { fg: '#ffffff', bg: null })
      if (t) { t.rotation.x = -Math.PI / 2; key.add(at(t, 0, 0.021, 0)) }
    }))
    // Ribbon with its eight silver traces, then the 8-way female connector.
    const rz = MEM_D / 2 + RIB_L / 2
    g.add(box(8 * PITCH, 0.03, RIB_L, mat(0xd9d9d9, { rough: 0.6, opacity: 0.9 }), 0, 0.015, rz))
    for (let i = 0; i < 8; i++) g.add(box(0.05, 0.004, RIB_L, mat(0x9aa0a6, { metal: 0.7 }), (i - 3.5) * PITCH, 0.032, rz))
    g.add(box(8 * PITCH + 0.05, CON_H, CON_D, mat(0x111111, { rough: 0.7 }), 0, CON_H / 2, Z_END - CON_D / 2))
    for (let i = 0; i < 8; i++) g.add(box(0.1, 0.1, 0.004, mat(0x333333), (i - 3.5) * PITCH, CON_H / 2, Z_END + 0.002))
    return g
  },
  sim: {
    controls: [{ key: 'key', kind: 'keypad', label: 'Keys', rows: KEYS }],
    circuit(api) {
      const s = []
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s.push(api.add(sw(api.pin(`R${r + 1}`), api.pin(`C${c + 1}`), { Ron: 100 })))
      return { s }
    },
    beforeStep(h, api) {
      const held = api.control('key') || ''
      h.s.forEach((e, i) => { e.closed = KEYS[Math.floor(i / 4)][i % 4] === held })
    },
    solved(h, api) {
      const i = Math.max(...h.s.map(e => Math.abs(api.cur(e))))
      if (i > 0.03) api.issue('current', 'warning', `${api.obj.name}: ${(i * 1000).toFixed(0)} mA through a key`, 'A membrane keypad is rated about 30 mA. Drive it from logic pins (the Keypad library uses INPUT_PULLUP), not from a supply.')
      else api.clearIssue('current')
      return { key: api.control('key') || '', current: i }
    },
    // The held key + the board pins its row and column lines reach.
    input(api) {
      const label = api.control('key') || ''
      const at = findKey(label)
      if (!at) return { key: '' }
      return { key: label, a: api.boardPin(`R${at.r + 1}`), b: api.boardPin(`C${at.c + 1}`) }
    },
    visual(root, { solved }) {
      for (const row of KEYS) for (const k of row) {
        const m = root.getObjectByName(`key_${k}`)
        if (m) m.position.y = solved?.key === k ? KEY_Y - 0.03 : KEY_Y
      }
    },
  },
  code: {
    includes: ['Keypad'],
    classes: ['Keypad'],
    consts: ['NO_KEY', 'IDLE', 'PRESSED', 'HOLD', 'RELEASED', 'OPEN', 'CLOSED', 'LIST_MAX', 'MAPSIZE'],
    functions: { makeKeymap: 1 },
    sandbox: SANDBOX,
    example: `#include <Keypad.h>
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
void setup() {
  Serial.begin(9600);
}
void loop() {
  char key = keypad.getKey();
  if (key != NO_KEY) {
    Serial.println(key);
  }
}`,
  },
  blockly: {
    blocks: [{
      type: 'part_keypad_4x4_get_key',
      message0: 'keypad key pressed (rows %1 cols %2)',
      args0: [
        { type: 'field_input', name: 'ROWS', text: '9,8,7,6' },
        { type: 'field_input', name: 'COLS', text: '5,4,3,2' },
      ],
      output: 'Number', colour: '#0891b2',
      tooltip: "Keypad.getKey(): the character of a key just pressed, or 0 (NO_KEY). Compare it with a character such as '5'. Row pins R1–R4, column pins C1–C4.",
    }],
    generators: {
      part_keypad_4x4_get_key(block, gen, H) {
        const pins = (s) => String(s).split(/[^0-9]+/).filter(Boolean).slice(0, 4).map(Number)
        const rows = pins(block.getFieldValue('ROWS')), cols = pins(block.getFieldValue('COLS'))
        while (rows.length < 4) rows.push(9 - rows.length)
        while (cols.length < 4) cols.push(5 - cols.length)
        H.include(gen, '<Keypad.h>')
        H.define(gen, 'kp_keys', "char kpKeys[4][4] = {{'1','2','3','A'},{'4','5','6','B'},{'7','8','9','C'},{'*','0','#','D'}};")
        H.define(gen, 'kp_rows', `byte kpRowPins[4] = {${rows.join(', ')}};`)
        H.define(gen, 'kp_cols', `byte kpColPins[4] = {${cols.join(', ')}};`)
        H.define(gen, 'kp_obj', 'Keypad kpd = Keypad(makeKeymap(kpKeys), kpRowPins, kpColPins, 4, 4);')
        return ['kpd.getKey()', H.Order.ATOMIC]
      },
    },
  },
  tests: [
    {
      name: 'pressing a key shorts its row to its column (R1–C1 for "1"), nothing else',
      run(kit) {
        kit.scene({ U: 'arduino', K: 'keypad_4x4' }, [['K:R1', 'U:D9'], ['K:C1', 'U:GND1']])
        kit.pinMode(9, 'pullup'); kit.step(0.02)
        kit.equal(kit.digitalRead(9), 1, 'released')
        kit.control('K', 'key', '1'); kit.step(0.02)
        // 5 V × 100 Ω / (35 kΩ + 100 Ω) = 14 mV.
        kit.near(kit.pinVoltage(9), 5 * 100 / 35100, 0.002, '"1" closes R1–C1')
        kit.equal(kit.digitalRead(9), 0)
        kit.control('K', 'key', '2'); kit.step(0.02)
        kit.equal(kit.digitalRead(9), 1, '"2" is R1–C2: C1 stays open')
      },
    },
    {
      name: 'end to end: the Keypad library sketch prints the key pressed (wired 9…2)',
      async run(kit, { runSketch }) {
        const wires = PIN_NAMES.map((n, i) => [`K:${n}`, `U:D${9 - i}`])
        kit.scene({ U: 'arduino', K: 'keypad_4x4' }, wires)
        const s = runSketch(kit, KEYPAD_SKETCH)
        await s.run(100)
        kit.equal(s.out.length, 0, 'nothing before a press')
        kit.control('K', 'key', '5'); await s.run(120)
        kit.control('K', 'key', ''); await s.run(80)
        kit.control('K', 'key', 'D'); await s.run(120)
        kit.control('K', 'key', ''); await s.run(60)
        s.stop()
        // Serial.println(key) on a char prints the character, as on an Arduino.
        kit.equal(s.out.join('|'), '5\n|D\n', 'one report per press, in order')
      },
    },
    {
      name: 'a mis-wired keypad behaves like hardware: R1/R2 swapped → "1" reads as "4"; unwired column → no key',
      async run(kit, { runSketch }) {
        const wires = PIN_NAMES.map((n, i) => [`K:${n}`, `U:D${9 - i}`])
        wires[0] = ['K:R1', 'U:D8']; wires[1] = ['K:R2', 'U:D9']
        kit.scene({ U: 'arduino', K: 'keypad_4x4' }, wires)
        let s = runSketch(kit, KEYPAD_SKETCH)
        kit.control('K', 'key', '1'); await s.run(150)
        s.stop()
        kit.equal(s.out.join('|'), '4\n', "R1 on the sketch's row-2 pin → '4'")
        kit.scene({ U: 'arduino', K: 'keypad_4x4' }, PIN_NAMES.map((n, i) => [`K:${n}`, `U:D${9 - i}`]).filter(([p]) => p !== 'K:C1'))
        s = runSketch(kit, KEYPAD_SKETCH)
        kit.control('K', 'key', '1'); await s.run(150)
        s.stop()
        kit.equal(s.out.length, 0, 'C1 not wired: no key')
      },
    },
    {
      name: 'setHoldTime + getState: holding "#" past 200 ms reaches HOLD, then RELEASED',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', K: 'keypad_4x4' }, PIN_NAMES.map((n, i) => [`K:${n}`, `U:D${9 - i}`]))
        const s = runSketch(kit, `#include <Keypad.h>
char keys[4][4] = {{'1','2','3','A'},{'4','5','6','B'},{'7','8','9','C'},{'*','0','#','D'}};
byte rowPins[4] = {9, 8, 7, 6};
byte colPins[4] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, 4, 4);
void setup() { Serial.begin(9600); keypad.setHoldTime(200); keypad.setDebounceTime(5); }
void loop() {
  keypad.getKey();
  if (keypad.keyStateChanged()) { Serial.println(keypad.getState()); }
  delay(2);
}`)
        // Generous wall-clock windows: the sandbox runs on real timers, and a
        // busy test machine can stretch its loop well past delay(2).
        kit.control('K', 'key', '#'); await s.run(600)
        kit.control('K', 'key', ''); await s.run(300)
        s.stop()
        // PRESSED = 1, HOLD = 2, RELEASED = 3, IDLE = 0.
        kit.equal(s.out.join(''), '1\n2\n3\n0\n', 'state sequence')
      },
    },
  ],
})

const KEYPAD_SKETCH = `#include <Keypad.h>
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
void setup() { Serial.begin(9600); }
void loop() {
  char key = keypad.getKey();
  if (key != NO_KEY) { Serial.println(key); }
  delay(2);
}`
