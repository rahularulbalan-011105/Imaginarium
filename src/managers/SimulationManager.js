import { buildPinToComponentMap } from '../stores/electronicsStore.js'

const MOTOR_TYPES = new Set(['motor', 'motor_bo', 'motor_dc'])

// Names injected as function parameters — #define for these is skipped to avoid
// "Identifier already declared" SyntaxError in strict mode.
const BUILTIN_NAMES = new Set([
  'analogWrite','digitalWrite','pinMode','digitalRead','analogRead',
  'delay','HIGH','LOW','OUTPUT','INPUT',
  'millis','micros','map','constrain',
  'abs','min','max','sq','sqrt','pow','floor','ceil','round','log','exp',
  'sin','cos','tan','random','randomSeed','Serial','onRuntimeError',
])

function transpile(code) {
  return code
    // strip #include lines
    .replace(/^\s*#include\s.*$/gm, '')
    // #define NAME value → const NAME = value (skip builtins to avoid redeclaration)
    .replace(/^\s*#define\s+(\w+)\s+(.*?)\s*$/gm, (_, name, val) => {
      if (BUILTIN_NAMES.has(name)) return ''
      const jsVal = val.trim().replace(/\b(\d+)[LlUuFf]+\b/g, '$1')
      return `const ${name} = ${jsVal}`
    })
    // strip remaining preprocessor lines
    .replace(/^\s*#.*$/gm, '')
    // void setup / void loop → async functions
    .replace(/\bvoid\s+setup\s*\(\s*\)/g, 'async function setup()')
    .replace(/\bvoid\s+loop\s*\(\s*\)/g,  'async function loop()')
    // other void functions
    .replace(/\bvoid\s+(?!setup\b|loop\b)(\w+\s*\()/g, 'async function $1')
    // const type declarations → keep const
    .replace(/\bconst\s+(?:unsigned\s+)?(?:int|float|double|long|byte|char|bool|boolean|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t)\s+/g, 'const ')
    // plain type declarations → let (must run after const-type)
    .replace(/\b(?:unsigned\s+)?(?:int|float|double|long|byte|char|bool|boolean|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t)\s+(?=[a-zA-Z_])/g, 'let ')
    .replace(/\bString\b(?=\s+[a-zA-Z_])/g, 'let ')
    // delay / delayMicroseconds → await delay
    .replace(/\bdelay(?:Microseconds)?\s*\(/g, 'await delay(')
}

class SimulationManager {
  constructor() {
    this._running        = false
    this._cancelDelay    = null
    this._onMotorSpeed   = null
    this._onLedBrightness = null
    this._onRuntimeError = null
    this._onSerialOut    = null
    this._connections    = {}
    this._objects        = []
    this.motorSpeeds     = {}
    this.ledBrightness   = {}
  }

  configure(connections, objects, onMotorSpeed, onRuntimeError, onSerialOut, onLedBrightness) {
    this._connections     = connections
    this._objects         = objects
    this._onMotorSpeed    = onMotorSpeed    ?? null
    this._onRuntimeError  = onRuntimeError  ?? null
    this._onSerialOut     = onSerialOut     ?? null
    this._onLedBrightness = onLedBrightness ?? null
  }

  start(code) {
    this.stop()
    this._running = true

    const pinMap = buildPinToComponentMap(this._connections, this._objects)
    const self   = this

    // ── Arduino API ───────────────────────────────────────────────────────────

    const delay = (ms) =>
      new Promise((resolve, reject) => {
        if (!self._running) { reject(new Error('stopped')); return }
        const id = setTimeout(resolve, Math.max(1, Number(ms) || 0))
        self._cancelDelay = () => { clearTimeout(id); reject(new Error('stopped')) }
      })

    const _write = (pin, val, isDigital) => {
      if (!self._running) return
      const comp = pinMap[pin]
      if (!comp) return
      const value = isDigital ? (val ? 255 : 0) : Math.max(0, Math.min(255, Number(val) || 0))
      if (MOTOR_TYPES.has(comp.type)) {
        self.motorSpeeds[comp.id] = value
        if (self._onMotorSpeed) self._onMotorSpeed(comp.id, value)
      } else if (comp.type === 'led') {
        self.ledBrightness[comp.id] = value
        if (self._onLedBrightness) self._onLedBrightness(comp.id, value)
      }
    }

    const analogWrite  = (pin, val) => _write(pin, val, false)
    const digitalWrite = (pin, val) => _write(pin, val, true)
    const pinMode      = () => {}
    const digitalRead  = () => 0
    const analogRead   = () => 0
    const HIGH = 1, LOW = 0, OUTPUT = 1, INPUT = 0
    const millis     = () => performance.now()
    const micros     = () => performance.now() * 1000
    const map        = (v, il, ih, ol, oh) => ((v - il) / (ih - il)) * (oh - ol) + ol
    const constrain  = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    const abs    = Math.abs
    const min    = (a, b) => Math.min(a, b)
    const max    = (a, b) => Math.max(a, b)
    const sq     = (x) => x * x
    const sqrt   = Math.sqrt
    const pow    = Math.pow
    const floor  = Math.floor
    const ceil   = Math.ceil
    const round  = Math.round
    const log    = Math.log
    const exp    = Math.exp
    const sin    = Math.sin
    const cos    = Math.cos
    const tan    = Math.tan
    const random     = (lo, hi) => hi !== undefined
      ? Math.floor(Math.random() * (hi - lo + 1)) + lo
      : Math.floor(Math.random() * (lo || 1))
    const randomSeed = () => {}
    const Serial = {
      begin:   () => {},
      print:   (v) => { if (self._onSerialOut) self._onSerialOut(String(v ?? '')) },
      println: (v) => { if (self._onSerialOut) self._onSerialOut(String(v ?? '') + '\n') },
      write:   (v) => { if (self._onSerialOut) self._onSerialOut(String(v ?? '')) },
    }

    const onRuntimeError = (msg) => {
      self._running = false
      self.motorSpeeds   = {}
      self.ledBrightness = {}
      if (self._onRuntimeError) self._onRuntimeError(msg)
    }

    // ── Transpile ─────────────────────────────────────────────────────────────

    let jsCode
    try {
      jsCode = transpile(code)
    } catch (e) {
      this._running = false
      return { error: 'Transpile error: ' + e.message }
    }

    const script = `
${jsCode}
if (typeof setup === 'function') await setup();
while (true) {
  if (typeof loop === 'function') await loop();
}
`

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'analogWrite','digitalWrite','pinMode','digitalRead','analogRead',
        'delay','HIGH','LOW','OUTPUT','INPUT',
        'millis','micros','map','constrain',
        'abs','min','max','sq','sqrt','pow','floor','ceil','round','log','exp',
        'sin','cos','tan','random','randomSeed','Serial','onRuntimeError',
        `"use strict";
         return (async () => {
           try { ${script} }
           catch (e) {
             if (e?.message !== 'stopped') {
               const msg = (e instanceof Error) ? (e.name + ': ' + e.message) : String(e)
               onRuntimeError(msg)
             }
           }
         })()`
      )

      fn(
        analogWrite, digitalWrite, pinMode, digitalRead, analogRead,
        delay, HIGH, LOW, OUTPUT, INPUT,
        millis, micros, map, constrain,
        abs, min, max, sq, sqrt, pow, floor, ceil, round, log, exp,
        sin, cos, tan, random, randomSeed, Serial, onRuntimeError
      ).then(() => { self._running = false })

    } catch (e) {
      this._running = false
      let msg = e.message
      if (msg.includes("'#'")) msg = "Syntax error: unexpected '#' — check for unsupported preprocessor directives"
      return { error: msg }
    }

    return null
  }

  stop() {
    this._running = false
    // Turn off all LEDs before clearing the brightness map
    for (const [id] of Object.entries(this.ledBrightness)) {
      if (this._onLedBrightness) this._onLedBrightness(id, 0)
    }
    this.motorSpeeds   = {}
    this.ledBrightness = {}
    if (this._cancelDelay) {
      this._cancelDelay()
      this._cancelDelay = null
    }
  }

  isRunning() { return this._running }
}

export const simulationManager = new SimulationManager()
