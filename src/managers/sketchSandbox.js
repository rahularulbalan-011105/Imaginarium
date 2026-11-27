// ─────────────────────────────────────────────────────────────────────────────
// sketchSandbox — runs a user's transpiled sketch in an ISOLATED iframe.
//
// WHY THIS EXISTS
// A project carries its sketch (`electronics.code`), and projects travel: share
// links, community builds, "Reuse". Opening someone else's robot loads their
// code into the editor, and pressing ▶ Run used to execute it with `new
// Function` — same realm as the app, with full access to `localStorage` (where
// the Supabase session and the analytics key live) and to `fetch`. Shadowing the
// dangerous globals is not enough: the transpiler supports member access, so
// `("").constructor.constructor("return globalThis")()` escapes any shadowing.
//
// THE SANDBOX
//   • <iframe sandbox="allow-scripts"> WITHOUT allow-same-origin → the frame runs
//     in an opaque origin: localStorage/indexedDB/cookies throw, and the parent
//     document is cross-origin and unreachable.
//   • A `default-src 'none'` CSP inside the frame → no fetch/XHR/WebSocket/image
//     beacon, so a hostile sketch cannot phone home even with data it computes.
//   • The sketch therefore touches the app only through the narrow message
//     protocol below, which carries Arduino-level calls (pin writes, Serial …).
//
// Everything scene-aware (wiring maps, servo binding, audio, the OLED, physics
// sensors) stays in SimulationManager: the frame just forwards calls and reads a
// snapshot of input values that the parent pushes each frame.
// ─────────────────────────────────────────────────────────────────────────────

// Calls the frame may forward. Anything not in this list is ignored by the parent.
export const OUT_CALLS = new Set([
  'analogWrite', 'digitalWrite', 'tone', 'noTone',
  // Circuit solver + catalogue parts (src/circuit, src/parts)
  'pinMode', 'shiftOut', 'part',
  'serial', 'oled', 'servoAttach', 'servoWrite', 'pinsWrite', 'irqAttach', 'pcaOut',
  'matrix', 'playTone', 'stopBuzzer', 'playBuzSeq', 'driveMotors',
  'walk', 'turn', 'stopWalking',
  // ESP32
  'ledcAttach', 'ledcWrite', 'ledcDetach', 'dacWrite',
  'wifi', 'ble', 'netSend', 'controlPublish', 'serialConsume',
])

// A sketch that never yields would spin its own frame forever. The frame posts a
// heartbeat each loop; if it goes quiet for this long we tear it down instead of
// leaving a wedged, CPU-burning frame behind. (It can never freeze the editor —
// that is the parent page, a separate event loop.)
const HEARTBEAT_TIMEOUT_MS = 10000

/** Escape so the code can be inlined in a <script> without breaking out of it. */
const forScriptTag = (js) => String(js).replace(/<\/(script)/gi, '<\\/$1')

// Exported for tests: the whole runtime lives inside one template literal, so a
// stray backtick or an under-escaped newline silently breaks EVERY sketch. A
// test parses this output to catch that before a user ever presses Run.
export function bootstrapHtml(userJs, consts, extraRuntime = '') {
  // NOTE: this runs inside the sandboxed frame. It has no app imports and no
  // access to anything outside itself.
  const runtime = `
'use strict';
var IN = { aread:{}, dread:{}, pulse:{}, enc:{}, lib:{}, parts:{}, shiftIn:{}, i2c:[], imu:null, battery:null, hwActive:false,
           touch:{}, ctrl:{}, wifi:null, ble:null, net:null, serialIn:'' };
var RUNNING = true;
var send = function (f, a) { try { parent.postMessage({ t:'out', f:f, a:a }, '*') } catch (e) {} };
addEventListener('message', function (e) {
  var d = e.data;
  if (!d) return;
  if (d.t === 'in') { IN = d.s; __encStep(); }
  else if (d.t === 'stop') { RUNNING = false; }
});

// ── timing ────────────────────────────────────────────────────────────────
var delay = function (ms) {
  return new Promise(function (res, rej) {
    if (!RUNNING) { rej(new Error('stopped')); return }
    setTimeout(function () { RUNNING ? res() : rej(new Error('stopped')) }, Math.max(1, Number(ms) || 0));
  });
};
var __yield = function () { return new Promise(function (r) { setTimeout(r, 0) }) };
var delayMicroseconds = function () {};
var millis = function () { return Math.round(performance.now()) };
var micros = function () { return Math.round(performance.now() * 1000) };

// ── pins: writes go out, reads come from the snapshot ─────────────────────
// pinMode reaches the circuit solver: OUTPUT drives, INPUT floats, INPUT_PULLUP
// switches the ~35 kΩ internal pull-up in (a button to GND then reads LOW).
var pinMode = function (p, m) { send('pinMode', [Number(p), Number(m)]) };
var analogWrite  = function (p, v) { send('analogWrite',  [Number(p), Number(v)]) };
var digitalWrite = function (p, v) { send('digitalWrite', [Number(p), v]) };
var analogRead = function (p) { var v = IN.aread[Number(p)]; return v == null ? 0 : v };
var digitalRead = function (p) {
  var e = ENC_LEVEL[Number(p)]; if (e != null) return e;      // encoder A/B outputs (see below)
  var v = IN.dread[Number(p)]; return v == null ? 0 : v;
};
var pulseIn = function (p) { var v = IN.pulse[Number(p)]; return v == null ? 0 : v };
var HIGH = 1, LOW = 0, OUTPUT = 1, INPUT = 0;
// shiftOut / shiftIn (Arduino core): one call carries the whole byte, so a
// 74HC595 sees every clock edge even though the sketch runs between frames.
var MSBFIRST = 1, LSBFIRST = 0;
var shiftOut = function (d, c, order, v) { send('shiftOut', [Number(d), Number(c), Number(order), (Number(v) || 0) & 255]) };
var shiftIn = function (d) { var v = IN.shiftIn && IN.shiftIn[Number(d)]; return v == null ? 0 : v };
// Catalogue part libraries talk to their parent-side handler through these.
var __part = function (type, fn, args) { send('part', [String(type), String(fn), args || []]) };
var __partIn = function (type) { return (IN.parts && IN.parts[type]) || {} };

// ── interrupts + quadrature encoders ──────────────────────────────────────
// The parent sends each encoder's exact signed quadrature count (IN.quad). Every
// change is replayed here edge by edge: the A/B levels step through
// 00 → 10 → 11 → 01 (forward) and each edge fires the attachInterrupt()
// handler on that pin, with the other channel already at its true level — so
// "if (digitalRead(B) == LOW) ticks++" counts direction exactly as on hardware.
// Handlers run between the sketch's awaits (e.g. during delay()), never in the
// middle of its synchronous code, so noInterrupts() sections are safe.
var CHANGE = 1, FALLING = 2, RISING = 3;
var ENC_LEVEL = {}, QPREV = {}, IRQ = {}, IRQ_ON = true;
var digitalPinToInterrupt = function (p) { return Number(p) };
// attachInterrupt(0 / 1, …) is the old Uno style for pins 2 / 3.
var __irqPin = function (n) { n = Number(n); return (IN.uno && (n === 0 || n === 1)) ? n + 2 : n };
var attachInterrupt = function (n, fn, mode) { IRQ[Number(n)] = { fn: fn, mode: Number(mode) }; send('irqAttach', [Number(n), Number(mode)]) };
var detachInterrupt = function (n) { delete IRQ[Number(n)] };
var interrupts = function () { IRQ_ON = true };
var noInterrupts = function () { IRQ_ON = false };
var __fire = function (pin, rising) {
  if (!IRQ_ON || !RUNNING) return;
  for (var k in IRQ) {
    var ip = __irqPin(k);
    if (ip !== pin) continue;
    if (IN.uno && ip !== 2 && ip !== 3) continue;          // an Uno has interrupts on 2 and 3 only
    var h = IRQ[k], m = h.mode;
    if (m === CHANGE || (m === RISING && rising) || (m === FALLING && !rising)) {
      try {
        var r = typeof h.fn === 'function' ? h.fn() : null;
        if (r && r.catch) r.catch(function (e) { onRuntimeError(e && e.message ? e.message : String(e)) });
      } catch (e) { onRuntimeError(e && e.message ? e.message : String(e)) }
    }
  }
};
var __lv = function (c) { var s = ((c % 4) + 4) % 4; return [(s === 1 || s === 2) ? 1 : 0, (s === 2 || s === 3) ? 1 : 0] };
var __encStep = function () {
  var q = IN.quad || {};
  for (var key in q) {
    var e = q[key], c = Math.trunc(Number(e.count) || 0);
    if (QPREV[key] === undefined) {
      var l0 = __lv(c); QPREV[key] = c;
      if (e.a >= 0) ENC_LEVEL[e.a] = l0[0];
      if (e.b >= 0) ENC_LEVEL[e.b] = l0[1];
      continue;
    }
    var p = QPREV[key];
    if (Math.abs(c - p) > 20000) p = c - (c > p ? 20000 : -20000);   // never stall the frame
    while (p !== c) {
      var from = __lv(p); p += c > p ? 1 : -1; var to = __lv(p);
      if (e.a >= 0) ENC_LEVEL[e.a] = to[0];
      if (e.b >= 0) ENC_LEVEL[e.b] = to[1];
      if (e.a >= 0 && to[0] !== from[0]) __fire(e.a, to[0] === 1);
      if (e.b >= 0 && to[1] !== from[1]) __fire(e.b, to[1] === 1);
    }
    QPREV[key] = c;
  }
};

// ── maths (pure, identical to the Arduino core) ───────────────────────────
var map = function (x, a, b, c, d) { return ((x - a) * (d - c)) / (b - a) + c };
var constrain = function (x, a, b) { return x < a ? a : x > b ? b : x };
var abs = Math.abs, min = Math.min, max = Math.max;
var sq = function (x) { return x * x };
var sqrt = Math.sqrt, pow = Math.pow, floor = Math.floor, ceil = Math.ceil, round = Math.round;
var log = Math.log, exp = Math.exp, sin = Math.sin, cos = Math.cos, tan = Math.tan;
var random = function (a, b) {
  if (b === undefined) { b = a; a = 0 }
  return Math.floor(Math.random() * (Number(b) - Number(a))) + Number(a);
};
var randomSeed = function () {};
// Bit helpers (Arduino.h macros that return a value).
var bitRead = function (x, n) { return ((Number(x) >> Number(n)) & 1) };
var bit = function (n) { return 1 << Number(n) };
var lowByte = function (x) { return Number(x) & 0xff };
var highByte = function (x) { return (Number(x) >> 8) & 0xff };
// Arduino Print formatting (the transpiler wraps print()/println() arguments):
// a char prints as its character, a float with 2 decimals (or the given
// digits), an integer in the given base — print(255, HEX) → "FF".
var HEX = 16, DEC = 10, OCT = 8, BIN = 2;
var __chr = function (v) { return typeof v === 'number' ? String.fromCharCode(v) : v };
var __flt = function (v, d) { var n = Number(v); if (!isFinite(n)) return isNaN(n) ? 'nan' : (n > 0 ? 'inf' : '-inf'); return n.toFixed(d == null ? 2 : Math.max(0, Math.min(20, Number(d) || 0))) };
var __base = function (v, b) {
  var n = Number(v); b = Number(b);
  if (typeof v !== 'number' || !(b === 2 || b === 8 || b === 10 || b === 16)) return v;
  if (b === 10) return String(Math.trunc(n));
  var u = n < 0 ? (n >>> 0) : Math.trunc(n);                 // negative ints print as unsigned 32-bit, as on an AVR long
  return u.toString(b).toUpperCase();
};

// ── output devices ────────────────────────────────────────────────────────
var Serial = {
  begin: function () {},
  print: function (v) { send('serial', [String(v == null ? '' : v)]) },
  println: function (v) { send('serial', [String(v == null ? '' : v) + '\\n']) },
  write: function (v) { send('serial', [String(v == null ? '' : v)]) },
  // Input typed into the Simulation tab's serial box.
  available: function () { return IN.serialIn ? IN.serialIn.length : 0 },
  read: function () {
    if (!IN.serialIn || !IN.serialIn.length) return -1;
    var ch = IN.serialIn.charCodeAt(0);
    IN.serialIn = IN.serialIn.slice(1);
    send('serialConsume', [1]);
    return ch;
  },
  readString: function () {
    var s = IN.serialIn || '';
    IN.serialIn = '';
    if (s.length) send('serialConsume', [s.length]);
    return s;
  },
  // Real firmware reads one line at a time; honour the terminator so a sketch
  // that sends two lines before the next loop() does not swallow both.
  readStringUntil: function (term) {
    var t = typeof term === 'number' ? String.fromCharCode(term) : (term == null ? '\\n' : String(term));
    var buf = IN.serialIn || '';
    var i = buf.indexOf(t);
    if (i < 0) return this.readString();
    IN.serialIn = buf.slice(i + 1);
    send('serialConsume', [i + 1]);
    return buf.slice(0, i).replace(/\\r$/, '');
  },
  flush: function () {},
};
var tone = function (p, f, d) { send('tone', [Number(p), Number(f), d == null ? 0 : Number(d)]) };
var noTone = function (p) { send('noTone', [Number(p)]) };
var Wire = {
  begin: function () {}, beginTransmission: function () {}, write: function (v) { send('serial', [String(v == null ? '' : v)]) },
  endTransmission: function () { return 0 }, println: function (v) { send('serial', [String(v == null ? '' : v) + '\\n']) },
};
function Adafruit_SSD1306() { this._lines = []; this._cur = '' }
Adafruit_SSD1306.prototype = {
  begin: function () { send('oled', ['']); return true },
  clearDisplay: function () { this._lines = []; this._cur = '' },
  setCursor: function () {}, setTextSize: function () {}, setTextColor: function () {},
  setRotation: function () {}, cp437: function () {}, dim: function () {},
  print: function (t) { this._cur += String(t == null ? '' : t) },
  write: function (t) { this._cur += String(t == null ? '' : t) },
  println: function (t) { this._lines.push(this._cur + String(t == null ? '' : t)); this._cur = '' },
  drawPixel: function () {}, drawLine: function () {}, drawRect: function () {}, fillRect: function () {},
  drawCircle: function () {}, fillCircle: function () {}, fillScreen: function () {}, drawBitmap: function () {},
  startscrollright: function () {}, stopscroll: function () {},
  display: function () {
    var out = this._lines.slice(); if (this._cur) out.push(this._cur);
    send('oled', [out.join('\\n')]);
  },
  width: function () { return 128 }, height: function () { return 64 },
};

// ── Servo: the parent owns pin→component binding ──────────────────────────
function Servo() { this._pin = -1; this._angle = 90 }
Servo.prototype = {
  attach: function (p) { this._pin = Number(p); send('servoAttach', [this._pin]) },
  write: function (a) {
    this._angle = Math.max(0, Math.min(180, Number(a) || 0));
    send('servoWrite', [this._pin, this._angle]);
  },
  writeMicroseconds: function (us) { this.write(Math.max(0, Math.min(180, ((Number(us) - 500) / 2000) * 180))) },
  read: function () { return this._angle },
  attached: function () { return this._pin >= 0 },
  detach: function () { this._pin = -1 },
};

// ── PCA9685 (Adafruit_PWMServoDriver) ───────────────────────────────────────
// The library's own arithmetic: setPWMFreq() → prescale register (from the
// oscillator frequency the sketch BELIEVES, default 25 MHz), setPWM(ch, on, off)
// → tick values out of 4096. The chip's real clock is 25 MHz, so the pulse
// that comes out is what the registers make at 25 MHz. Each channel's pulse
// width (µs) and the frame rate go to the parent (utils/pca9685.js), which
// moves the servos wired to that channel. Power-on state: asleep, 200 Hz.
var _PCA_OSC = 25000000;
function Adafruit_PWMServoDriver(addr) {
  if (!(this instanceof Adafruit_PWMServoDriver)) return new Adafruit_PWMServoDriver(addr);
  this._addr = addr == null || typeof addr === 'object' ? 0x40 : Number(addr);
  this._osc = 25000000; this._pre = 30; this._sleep = true; this._on = {}; this._off = {};
}
Adafruit_PWMServoDriver.prototype = {
  _hz: function () { return _PCA_OSC / (4096 * (this._pre + 1)) },
  _emit: function (n) {
    var on = this._on[n] || 0, off = this._off[n] == null ? 4096 : this._off[n], hz = this._hz(), us;
    if (this._sleep || off >= 4096) us = 0;
    else if (on >= 4096) us = 1e6 / hz;
    else us = ((((off - on) % 4096) + 4096) % 4096) * (1e6 / hz) / 4096;
    send('pcaOut', [this._addr, n, us, hz]);
  },
  _all: function () { for (var n in this._off) this._emit(Number(n)) },
  begin: function (prescale) { this.reset(); if (prescale) { this._pre = Math.max(3, Math.min(255, Number(prescale))); this._sleep = false } else this.setPWMFreq(1000); return true },
  reset: function () { this._sleep = false; this._on = {}; this._off = {} },
  sleep: function () { this._sleep = true; this._all() },
  wakeup: function () { this._sleep = false; this._all() },
  setExtClk: function (p) { this._pre = Math.max(3, Math.min(255, Number(p) || 3)); this._sleep = false; this._all() },
  setPWMFreq: function (f) {
    f = Math.min(3500, Math.max(1, Number(f) || 1));
    var v = this._osc / (f * 4096) + 0.5 - 1;
    this._pre = Math.floor(Math.min(255, Math.max(3, v)));
    this._sleep = false; this._all();
  },
  setOutputMode: function () {},
  readPrescale: function () { return this._pre },
  getPWM: function (n, off) { return off ? (this._off[n] || 0) : (this._on[n] || 0) },
  setPWM: function (n, on, off) {
    n = Number(n) & 15; this._on[n] = Number(on) | 0; this._off[n] = Number(off) | 0; this._emit(n); return 0;
  },
  setPin: function (n, val, invert) {
    val = Math.min(Math.max(Number(val) | 0, 0), 4095);
    if (invert) val = 4095 - val;
    if (val === 4095) this.setPWM(n, 4096, 0);
    else if (val === 0) this.setPWM(n, 0, 4096);
    else this.setPWM(n, 0, val);
  },
  writeMicroseconds: function (n, us) {
    var tickUs = 1e6 * (this._pre + 1) / this._osc;
    this.setPWM(n, 0, Math.floor(Number(us) / tickUs));
  },
  setOscillatorFrequency: function (f) { this._osc = Number(f) || 25000000 },
  getOscillatorFrequency: function () { return this._osc },
};

// ── Stepper (Arduino Stepper.h, 4-wire) ───────────────────────────────────
// Mirrors Stepper.cpp: the same 4-step coil sequence, step_number bookkeeping
// and setSpeed() delay. step() blocks (awaited) until the move is done. Each
// step goes out as ONE atomic pin update stamped with the time it was due, so
// the parent sees the true step rate even when timers fire late and a few
// steps arrive together (catch-up keeps the average speed exact).
var _STEP_SEQ = [[1, 0, 1, 0], [0, 1, 1, 0], [0, 1, 0, 1], [1, 0, 0, 1]];
function Stepper(n, p1, p2, p3, p4) {
  this._n = Math.max(1, Math.round(Number(n) || 2048));
  this._pins = [p1, p2, p3, p4].map(Number);
  this._num = 0; this._dly = 0; this._t = -1e9;
}
Stepper.prototype = {
  setSpeed: function (rpm) { rpm = Number(rpm) || 0; this._dly = rpm > 0 ? 60000 / this._n / rpm : 0 },
  version: function () { return 5 },
  _out: function (t) {
    var s = _STEP_SEQ[this._num % 4], p = this._pins;
    send('pinsWrite', [[[p[0], s[0]], [p[1], s[1]], [p[2], s[2]], [p[3], s[3]]], t]);
  },
  step: async function (k) {
    k = Math.trunc(Number(k) || 0);
    var left = Math.abs(k), dir = k > 0 ? 1 : -1;
    var t = Math.max(this._t, performance.now() - this._dly);
    while (left > 0) {
      if (!RUNNING) throw new Error('stopped');
      t += this._dly;
      var wait = t - performance.now();
      if (wait > 2) await delay(wait);
      else if (left % 64 === 0) await __yield();
      if (dir > 0) { this._num++; if (this._num === this._n) this._num = 0 }
      else { if (this._num === 0) this._num = this._n; this._num-- }
      this._out(t);
      left--;
    }
    this._t = t;
  },
};

// ── sensor libraries: read the snapshot by pin ────────────────────────────
var _lib = function (p) { return IN.lib[Number(p)] || {} };
function LDR(p) { this._pin = Number(p) }
LDR.prototype = {
  begin: function () { return true },
  read: function () { var v = _lib(this._pin).ldr; return v == null ? 0 : v },
  readPercentage: function () { var v = _lib(this._pin).ldrPct; return v == null ? 0 : v },
};
function DHT11(p) { this._pin = Number(p) }
DHT11.prototype = {
  begin: function () { return true },
  readTemperature: function () { var v = _lib(this._pin).temp; return v == null ? NaN : v },
  readHumidity: function () { var v = _lib(this._pin).hum; return v == null ? NaN : v },
};
// RGB is a VALUE STRUCT (what ColorSensor.readRGB() returns), matching
// arduino/sensorLibs.js — not an LED driver.
function RGB(r, g, b) {
  this.r = Math.round(Number(r) || 0); this.g = Math.round(Number(g) || 0); this.b = Math.round(Number(b) || 0);
}
function ColorSensor(s0, s1, s2, s3, out) { this._pin = Number(out) }
ColorSensor.prototype = {
  begin: function () { return true },
  _rgb: function () { return _lib(this._pin).rgb || null },
  readRGB: function () { var c = this._rgb(); return c ? new RGB(c.r, c.g, c.b) : new RGB(0, 0, 0) },
  readColor: function () { var v = _lib(this._pin).color; return v == null ? 'None' : v },
  readRed: function () { var c = this._rgb(); return c ? c.r : 0 },
  readGreen: function () { var c = this._rgb(); return c ? c.g : 0 },
  readBlue: function () { var c = this._rgb(); return c ? c.b : 0 },
};

// ── I²C sensors: Adafruit_BMP280 · MPU6050 (MPU6050_light API) ───────────
// IN.i2c lists every sensor answering on the bus: { kind, addr, ...reading }.
// begin(addr) must hit the board's real address, as on hardware; with no
// begin() at all (Blockly read blocks) the first board of that kind is used.
var __i2c = function (kind, addr) {
  var L = IN.i2c || [];
  for (var i = 0; i < L.length; i++) if (L[i].kind === kind && (addr == null || L[i].addr === addr)) return L[i];
  return null;
};
var __i2cSaid = {};
var __i2cHint = function (kind, name, addr) {
  if (__i2cSaid[kind + addr]) return;
  __i2cSaid[kind + addr] = 1;
  var other = __i2c(kind, null);
  var hex = function (a) { return '0x' + Number(a).toString(16) };
  send('serial', [other
    ? '[sim] No ' + name + ' answers at ' + hex(addr) + ' - yours is at ' + hex(other.addr) + '. Use begin(' + hex(other.addr) + ').\\n'
    : '[sim] No ' + name + ' on the I2C bus - wire SDA/SCL to the board and VCC/GND to power.\\n']);
};
function Adafruit_BMP280() { this._addr = null; this._ok = false; this._began = false }
Adafruit_BMP280.prototype = {
  begin: function (addr, chipid) {
    this._began = true;
    this._addr = addr == null ? 0x77 : Number(addr);           // the library default
    this._ok = !!__i2c('bmp280', this._addr);
    if (!this._ok) __i2cHint('bmp280', 'BMP280', this._addr);
    return this._ok;
  },
  setSampling: function () {},
  reset: function () {},
  sensorID: function () { return this._r() ? 0x58 : 0 },
  getStatus: function () { return 0 },
  _r: function () {
    if (!this._began) return __i2c('bmp280', null);
    return this._ok ? __i2c('bmp280', this._addr) : null;
  },
  readTemperature: function () { var r = this._r(); return r ? r.temp : NaN },
  readPressure: function () { var r = this._r(); return r ? r.pressure : NaN },
  readAltitude: function (sea) {
    var r = this._r(); if (!r) return NaN;
    sea = Number(sea) || 1013.25;
    return 44330 * (1 - Math.pow((r.pressure / 100) / sea, 0.1903));
  },
  seaLevelForAltitude: function (alt, p) { return (Number(p) || 0) / Math.pow(1 - (Number(alt) || 0) / 44330, 5.255) },
};
// MPU6050_light: values refresh on update(); angles are a complementary filter
// of the gyro rate and the accelerometer tilt, exactly like the library.
var __R2D = 180 / Math.PI;
function MPU6050(wire) {
  this._addr = 0x68; this._began = false; this._ok = false; this._auto = true;
  this._coef = 0.98; this._t = 0;
  this._a = { x: 0, y: 0, z: 1 }; this._g = { x: 0, y: 0, z: 0 }; this._temp = 0;
  this._ao = { x: 0, y: 0, z: 0 }; this._go = { x: 0, y: 0, z: 0 };
  this._ang = { x: 0, y: 0, z: 0 };
}
MPU6050.prototype = {
  setAddress: function (a) { this._addr = Number(a) },
  getAddress: function () { return this._addr },
  begin: function () {
    this._began = true;
    this._ok = !!__i2c('mpu6050', this._addr);
    if (!this._ok) { __i2cHint('mpu6050', 'MPU6050', this._addr); return 2 }   // 2 = NACK on address
    this._fetch(); this._ang.x = this.getAccAngleX(); this._ang.y = this.getAccAngleY(); this._ang.z = 0;
    this._t = performance.now();
    return 0;
  },
  _src: function () { return this._began ? (this._ok ? __i2c('mpu6050', this._addr) : null) : __i2c('mpu6050', null) },
  _fetch: function () {
    var r = this._src();
    if (!r) { this._a = { x: 0, y: 0, z: 0 }; this._g = { x: 0, y: 0, z: 0 }; this._temp = 0; return false }
    this._a = { x: r.ax - this._ao.x, y: r.ay - this._ao.y, z: r.az - this._ao.z };
    this._g = { x: r.gx - this._go.x, y: r.gy - this._go.y, z: r.gz - this._go.z };
    this._temp = r.temp;
    return true;
  },
  _step: function () {
    var now = performance.now(), dt = this._t ? Math.min(0.5, (now - this._t) / 1000) : 0;
    this._t = now;
    this._fetch();
    var wrap = function (a) { while (a > 180) a -= 360; while (a < -180) a += 360; return a };
    var k = this._coef;
    this._ang.x = wrap(k * (this._ang.x + this._g.x * dt) + (1 - k) * this.getAccAngleX());
    this._ang.y = wrap(k * (this._ang.y + this._g.y * dt) + (1 - k) * this.getAccAngleY());
    this._ang.z = this._ang.z + this._g.z * dt;
  },
  update: function () { this._auto = false; this._step() },
  fetchData: function () { this._auto = false; this._fetch() },
  _live: function () { if (this._auto) this._step() },
  calcOffsets: function (gyro, acc) {
    var r = this._src(); if (!r) return;
    if (gyro !== false) this._go = { x: r.gx, y: r.gy, z: r.gz };
    if (acc !== false) this._ao = { x: r.ax, y: r.ay, z: r.az - 1 };
  },
  calcGyroOffsets: function () { this.calcOffsets(true, false) },
  calcAccOffsets: function () { this.calcOffsets(false, true) },
  setGyroOffsets: function (x, y, z) { this._go = { x: +x || 0, y: +y || 0, z: +z || 0 } },
  setAccOffsets: function (x, y, z) { this._ao = { x: +x || 0, y: +y || 0, z: +z || 0 } },
  getGyroXoffset: function () { return this._go.x }, getGyroYoffset: function () { return this._go.y }, getGyroZoffset: function () { return this._go.z },
  getAccXoffset: function () { return this._ao.x }, getAccYoffset: function () { return this._ao.y }, getAccZoffset: function () { return this._ao.z },
  setFilterGyroCoef: function (c) { this._coef = Math.max(0, Math.min(1, Number(c))) },
  setFilterAccCoef: function (c) { this._coef = 1 - Math.max(0, Math.min(1, Number(c))) },
  getFilterGyroCoef: function () { return this._coef },
  getFilterAccCoef: function () { return 1 - this._coef },
  setGyroConfig: function () { return 0 }, setAccConfig: function () { return 0 },
  getTemp: function () { this._live(); return this._temp },
  getAccX: function () { this._live(); return this._a.x },
  getAccY: function () { this._live(); return this._a.y },
  getAccZ: function () { this._live(); return this._a.z },
  getGyroX: function () { this._live(); return this._g.x },
  getGyroY: function () { this._live(); return this._g.y },
  getGyroZ: function () { this._live(); return this._g.z },
  getAccAngleX: function () { var a = this._a; return Math.atan2(a.y, Math.sqrt(a.z * a.z + a.x * a.x)) * __R2D },
  getAccAngleY: function () { var a = this._a; return -Math.atan2(a.x, Math.sqrt(a.z * a.z + a.y * a.y)) * __R2D },
  getAngleX: function () { this._live(); return this._ang.x },
  getAngleY: function () { this._live(); return this._ang.y },
  getAngleZ: function () { this._live(); return this._ang.z },
};

// ── physics-backed hardware: read the snapshot ────────────────────────────
function IMU() {}
IMU.prototype = {
  begin: function () { return true },
  update: function () { this._r = IN.imu; return !!this._r },
  _get: function () { return this._r || IN.imu },
  getRoll:   function () { var r = this._get(); return r ? r.roll : 0 },
  getPitch:  function () { var r = this._get(); return r ? r.pitch : 0 },
  getYaw:    function () { var r = this._get(); return r ? r.yaw : 0 },
  getAccelX: function () { var r = this._get(); return r ? r.accel.x : 0 },
  getAccelY: function () { var r = this._get(); return r ? r.accel.y : 9.81 },
  getAccelZ: function () { var r = this._get(); return r ? r.accel.z : 0 },
  getGyroX:  function () { var r = this._get(); return r ? r.gyro.x : 0 },
  getGyroY:  function () { var r = this._get(); return r ? r.gyro.y : 0 },
  getGyroZ:  function () { var r = this._get(); return r ? r.gyro.z : 0 },
};
// Encoder enc(pin)       → a servo's joint encoder (degrees, physics robots)
// Encoder enc(pinA, pinB) → a quadrature encoder, like the PJRC Encoder library:
//                           read() = 4× count, write(n), readAndReset()
function Encoder(p, b) { this._pin = p == null ? -1 : Number(p); this._b = b == null ? null : Number(b); this._off = 0 }
Encoder.prototype = {
  attach: function (p) { this._pin = Number(p) },
  _q: function () {
    var q = IN.quad || {};
    for (var k in q) {
      var e = q[k];
      if (e.a === this._pin && e.b === this._b) return Math.trunc(e.count);
      if (e.a === this._b && e.b === this._pin) return -Math.trunc(e.count);   // A/B swapped → reversed
    }
    return 0;
  },
  read: function () {
    if (this._b != null) return this._q() - this._off;
    var e = IN.enc[this._pin]; return e ? e.deg : 90;
  },
  write: function (v) { if (this._b != null) this._off = this._q() - (Number(v) || 0) },
  readAndReset: function () { var v = this.read(); this.write(0); return v },
  readVelocity: function () { var e = IN.enc[this._pin]; return e ? e.degPerSec : 0 },
};
function Battery() {}
Battery.prototype = {
  readVoltage: function () { return IN.battery ? IN.battery.voltage : 0 },
  readCurrent: function () { return IN.battery ? IN.battery.current : 0 },
  readPercent: function () { return IN.battery ? IN.battery.percent : 0 },
};

// ── SUBO board library ────────────────────────────────────────────────────
var SuboMatrixInit = function () { send('matrix', ['clear']) };
var stripclear     = function () { send('matrix', ['clear']) };
var setAllLED      = function (r, g, b) { send('matrix', ['all', +r || 0, +g || 0, +b || 0]) };
var setSingleLED   = function (n, r, g, b) { send('matrix', ['one', +n || 1, +r || 0, +g || 0, +b || 0]) };
var playLEDSeq     = function (id) { send('matrix', ['seq', +id || 1]) };
var playTone       = function (f, d) { send('playTone', [+f || 440, d ? +d : 0]) };
var stopBuzzer     = function () { send('stopBuzzer', []) };
var playBuzSeq     = function (id) { send('playBuzSeq', [Math.round(+id || 1)]) };
var start_motors   = function () {};
var drive_motors   = function (a, b, c, d) { send('driveMotors', [+a || 0, +b || 0, +c || 0, +d || 0]) };
var runMotor       = function (dir, s) {
  s = Number(s) || 0;
  if (dir === 'F') send('driveMotors', [s, 0, s, 0]);
  else if (dir === 'B') send('driveMotors', [0, s, 0, s]);
  else if (dir === 'L') send('driveMotors', [s, 0, 0, s]);
  else if (dir === 'R') send('driveMotors', [0, s, s, 0]);
  else send('driveMotors', [0, 0, 0, 0]);
};

// ── legged locomotion ─────────────────────────────────────────────────────
var walk = function (s) { send('walk', [Number(s) || 0]) };
var turn = function (r) { send('turn', [Number(r) || 0]) };
var stopWalking = function () { send('stopWalking', []) };

// ── ESP32: LEDC PWM, DAC, touch ───────────────────────────────────────────
// Arduino-ESP32 core 3.x uses ledcAttach(pin, freq, bits) + ledcWrite(pin, duty).
// Core 2.x used ledcSetup(ch, freq, bits) + ledcAttachPin(pin, ch) +
// ledcWrite(ch, duty). Both spellings are accepted; channel→pin is tracked so a
// 2.x sketch still drives the right pin.
var _ledcChanPin = {};
var ledcSetup = function (ch, freq, bits) { return Number(freq) || 5000 };
var ledcAttachPin = function (pin, ch) { _ledcChanPin[Number(ch)] = Number(pin); send('ledcAttach', [Number(pin), 5000, 8]) };
var ledcAttach = function (pin, freq, bits) { send('ledcAttach', [Number(pin), Number(freq) || 5000, Number(bits) || 8]); return true };
var ledcWrite = function (a, duty) {
  var n = Number(a);
  var pin = (_ledcChanPin[n] !== undefined) ? _ledcChanPin[n] : n;   // channel or pin
  send('ledcWrite', [pin, Number(duty) || 0]);
};
var ledcDetach = function (pin) { send('ledcDetach', [Number(pin)]) };
var ledcRead = function () { return 0 };
var dacWrite = function (pin, v) { send('dacWrite', [Number(pin), Number(v) || 0]) };
var touchRead = function (p) { var v = IN.touch[Number(p)]; return v == null ? 80 : v };
var analogReadResolution = function () {};
var analogSetAttenuation = function () {};

// ── ESP32: simulated Wi-Fi ────────────────────────────────────────────────
// A simulated board has no radio. This models the Arduino WiFi API's lifecycle
// and status codes against a simulated network; the Simulation tab labels it
// SIMULATED so it can never be mistaken for a real connection.
var WL_IDLE_STATUS = 0, WL_NO_SSID_AVAIL = 1, WL_CONNECTED = 3, WL_CONNECT_FAILED = 4, WL_DISCONNECTED = 6;
var WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3, WIFI_OFF = 0;
var WiFi = {
  begin: function (ssid, pass) { send('wifi', ['begin', String(ssid == null ? '' : ssid), String(pass == null ? '' : pass)]); return WL_DISCONNECTED },
  disconnect: function () { send('wifi', ['disconnect']) },
  softAP: function (ssid, pass) { send('wifi', ['softAP', String(ssid == null ? '' : ssid), String(pass == null ? '' : pass)]); return true },
  softAPdisconnect: function () { send('wifi', ['disconnect']) },
  mode: function (m) { send('wifi', ['mode', Number(m) || 0]); return true },
  status: function () { return IN.wifi ? IN.wifi.status : WL_IDLE_STATUS },
  localIP: function () { return IN.wifi ? IN.wifi.ip : '0.0.0.0' },
  softAPIP: function () { return IN.wifi ? IN.wifi.apIp : '0.0.0.0' },
  SSID: function () { return IN.wifi ? IN.wifi.ssid : '' },
  RSSI: function () { return IN.wifi ? IN.wifi.rssi : 0 },
  macAddress: function () { return IN.wifi ? IN.wifi.mac : '00:00:00:00:00:00' },
  isConnected: function () { return !!(IN.wifi && IN.wifi.status === WL_CONNECTED) },
  setHostname: function () { return true },
};
// Minimal client: writes land in the Simulation tab's network log.
function WiFiClient() { this._open = false }
WiFiClient.prototype = {
  connect: function (host, port) { this._open = !!(IN.wifi && IN.wifi.status === WL_CONNECTED); send('netSend', ['connect', String(host) + ':' + String(port)]); return this._open },
  connected: function () { return this._open },
  print: function (v) { send('netSend', ['tx', String(v == null ? '' : v)]) },
  println: function (v) { send('netSend', ['tx', String(v == null ? '' : v) + '\\n']) },
  available: function () { return IN.net ? IN.net.available : 0 },
  read: function () { return IN.net && IN.net.buf && IN.net.buf.length ? IN.net.buf.charCodeAt(0) : -1 },
  stop: function () { this._open = false; send('netSend', ['close']) },
};

// ── ESP32: simulated Bluetooth ────────────────────────────────────────────
// BluetoothSerial models Classic SPP (supported by the ESP32-WROOM-32 chip);
// BLESerial models a BLE UART service. Both are SIMULATED here — see
// docs/ESP32.md for what a browser can and cannot do with real hardware.
// Bluetooth Serial — Classic SPP and a BLE UART, with the same stream API as
// the real libraries. These are CONSTRUCTORS, because a sketch declares them as
// objects: BluetoothSerial SerialBT; transpiles to new BluetoothSerial().
function _btClass(kind) {
  function C() {}
  C.prototype = {
    begin: function (name) { send('ble', [kind, 'begin', String(name == null ? 'ESP32' : name)]); return true },
    end: function () { send('ble', [kind, 'end']) },
    hasClient: function () { return !!(IN.ble && IN.ble.connected) },
    connected: function () { return !!(IN.ble && IN.ble.connected) },
    available: function () { return IN.ble ? IN.ble.available : 0 },
    read: function () {
      if (!IN.ble || !IN.ble.buf || !IN.ble.buf.length) return -1;
      var ch = IN.ble.buf.charCodeAt(0);
      IN.ble.buf = IN.ble.buf.slice(1); IN.ble.available = IN.ble.buf.length;
      send('ble', [kind, 'consume', 1]);
      return ch;
    },
    readString: function () {
      if (!IN.ble || !IN.ble.buf) return '';
      var s = IN.ble.buf; IN.ble.buf = ''; IN.ble.available = 0;
      send('ble', [kind, 'consume', s.length]);
      return s;
    },
    // One line at a time, terminator dropped (and a stray CR with it).
    readStringUntil: function (term) {
      if (!IN.ble || !IN.ble.buf) return '';
      var t = typeof term === 'number' ? String.fromCharCode(term) : (term == null ? '\\n' : String(term));
      var i = IN.ble.buf.indexOf(t);
      if (i < 0) return this.readString();
      var line = IN.ble.buf.slice(0, i);
      IN.ble.buf = IN.ble.buf.slice(i + 1); IN.ble.available = IN.ble.buf.length;
      send('ble', [kind, 'consume', i + 1]);
      return line.replace(/\\r$/, '');
    },
    print: function (v) { send('ble', [kind, 'tx', String(v == null ? '' : v)]) },
    println: function (v) { send('ble', [kind, 'tx', String(v == null ? '' : v) + '\\n']) },
    write: function (v) { send('ble', [kind, 'tx', String(v == null ? '' : v)]) },
    flush: function () {},
  };
  return C;
}
var BluetoothSerial = _btClass('classic');
var BLESerial = _btClass('ble');

// ── Program-defined simulation controls ───────────────────────────────────
var controlValue = function (id) { var v = IN.ctrl[String(id)]; return v == null ? 0 : v };
var controlPublish = function (id, v) { send('controlPublish', [String(id), Number(v)]) };

var onRuntimeError = function (m) { try { parent.postMessage({ t:'err', m:String(m) }, '*') } catch (e) {} };
`
  // Libraries contributed by catalogue parts (part.code.sandbox), same scope.
  + '\n' + (extraRuntime || '') + '\n'

  // The user's sketch plus the forever-loop, in the same scope as the runtime.
  const program = `
${consts}
${userJs}
(async function () {
  try {
    if (typeof setup === 'function') await setup();
    var beat = 0;
    while (RUNNING) {
      if (typeof loop === 'function') await loop();
      await __yield();
      if (++beat % 10 === 0) { try { parent.postMessage({ t: 'beat' }, '*') } catch (e) {} }
    }
  } catch (e) {
    if (e && e.message === 'stopped') return;
    var msg = (e instanceof Error) ? (e.name + ': ' + e.message) : String(e);
    onRuntimeError(msg);
  }
})();
`

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
</head><body><script>
${forScriptTag(runtime)}
try {
${forScriptTag(program)}
} catch (e) {
  try { parent.postMessage({ t:'err', m: (e && e.name ? e.name + ': ' + e.message : String(e)) }, '*') } catch (_) {}
}
try { parent.postMessage({ t:'ready' }, '*') } catch (e) {}
<\/script></body></html>`
}

/**
 * Create a sandbox and run `userJs` in it.
 * @param {object} o
 * @param {string} o.userJs      transpiled sketch
 * @param {string} o.consts      constant declarations prepended to the sketch
 * @param {(fn:string,args:any[])=>void} o.onOut    a forwarded Arduino-level call
 * @param {(msg:string)=>void} o.onError            runtime error from the sketch
 * @param {()=>object} o.getInput                   builds the input snapshot
 * @returns {{stop:()=>void, push:()=>void}}
 */
export function runSketchSandboxed({ userJs, consts, onOut, onError, getInput, extraRuntime = '' }) {
  const frame = document.createElement('iframe')
  // No allow-same-origin: the frame gets an opaque origin, so app storage and the
  // parent DOM are unreachable. No allow-popups / allow-forms / allow-modals.
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none'
  frame.srcdoc = bootstrapHtml(userJs, consts, extraRuntime)

  let stopped = false
  let lastBeat = performance.now()
  let raf = 0
  let watchdog = 0

  const onMessage = (e) => {
    if (stopped || e.source !== frame.contentWindow) return    // only this frame
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.t === 'beat' || d.t === 'ready') { lastBeat = performance.now(); return }
    if (d.t === 'err') { onError(String(d.m || 'error')); return }
    if (d.t === 'out' && OUT_CALLS.has(d.f) && Array.isArray(d.a)) {
      lastBeat = performance.now()
      onOut(d.f, d.a)
    }
  }
  window.addEventListener('message', onMessage)

  const push = () => {
    if (stopped) return
    try { frame.contentWindow?.postMessage({ t: 'in', s: getInput() }, '*') } catch { /* frame gone */ }
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    clearInterval(watchdog)
    window.removeEventListener('message', onMessage)
    try { frame.contentWindow?.postMessage({ t: 'stop' }, '*') } catch { /* ignore */ }
    frame.remove()                      // tearing down the frame kills the sketch
  }

  document.body.appendChild(frame)

  // Keep the frame's view of the world current, once per animation frame.
  const tick = () => { push(); raf = requestAnimationFrame(tick) }
  raf = requestAnimationFrame(tick)

  watchdog = setInterval(() => {
    if (performance.now() - lastBeat > HEARTBEAT_TIMEOUT_MS) {
      onError('Sketch stopped responding (no yield for 10 s) — it was halted. Add a delay() inside loop().')
      stop()
    }
  }, 2000)

  return { stop, push }
}
