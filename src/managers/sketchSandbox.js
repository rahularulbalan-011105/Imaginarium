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
  'serial', 'oled', 'servoAttach', 'servoWrite',
  'matrix', 'playTone', 'stopBuzzer', 'playBuzSeq', 'driveMotors',
  'walk', 'turn', 'stopWalking',
])

// A sketch that never yields would spin its own frame forever. The frame posts a
// heartbeat each loop; if it goes quiet for this long we tear it down instead of
// leaving a wedged, CPU-burning frame behind. (It can never freeze the editor —
// that is the parent page, a separate event loop.)
const HEARTBEAT_TIMEOUT_MS = 10000

/** Escape so the code can be inlined in a <script> without breaking out of it. */
const forScriptTag = (js) => String(js).replace(/<\/(script)/gi, '<\\/$1')

function bootstrapHtml(userJs, consts) {
  // NOTE: this runs inside the sandboxed frame. It has no app imports and no
  // access to anything outside itself.
  const runtime = `
'use strict';
var IN = { aread:{}, dread:{}, pulse:{}, enc:{}, lib:{}, imu:null, battery:null, hwActive:false };
var RUNNING = true;
var send = function (f, a) { try { parent.postMessage({ t:'out', f:f, a:a }, '*') } catch (e) {} };
addEventListener('message', function (e) {
  var d = e.data;
  if (!d) return;
  if (d.t === 'in') IN = d.s;
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
var pinMode = function () {};
var analogWrite  = function (p, v) { send('analogWrite',  [Number(p), Number(v)]) };
var digitalWrite = function (p, v) { send('digitalWrite', [Number(p), v]) };
var analogRead = function (p) { var v = IN.aread[Number(p)]; return v == null ? 0 : v };
var digitalRead = function (p) { var v = IN.dread[Number(p)]; return v == null ? 0 : v };
var pulseIn = function (p) { var v = IN.pulse[Number(p)]; return v == null ? 0 : v };
var HIGH = 1, LOW = 0, OUTPUT = 1, INPUT = 0;

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

// ── output devices ────────────────────────────────────────────────────────
var Serial = {
  begin: function () {},
  print: function (v) { send('serial', [String(v == null ? '' : v)]) },
  println: function (v) { send('serial', [String(v == null ? '' : v) + '\\n']) },
  write: function (v) { send('serial', [String(v == null ? '' : v)]) },
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
function Encoder(p) { this._pin = p == null ? -1 : Number(p) }
Encoder.prototype = {
  attach: function (p) { this._pin = Number(p) },
  read: function () { var e = IN.enc[this._pin]; return e ? e.deg : 90 },
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

var onRuntimeError = function (m) { try { parent.postMessage({ t:'err', m:String(m) }, '*') } catch (e) {} };
`

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
export function runSketchSandboxed({ userJs, consts, onOut, onError, getInput }) {
  const frame = document.createElement('iframe')
  // No allow-same-origin: the frame gets an opaque origin, so app storage and the
  // parent DOM are unreachable. No allow-popups / allow-forms / allow-modals.
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none'
  frame.srcdoc = bootstrapHtml(userJs, consts)

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
