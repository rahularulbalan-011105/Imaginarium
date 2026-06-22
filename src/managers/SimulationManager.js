import { buildPinToComponentMap } from '../stores/electronicsStore.js'
import { parseAndTranspile } from '../utils/arduinoParser.js'

const MOTOR_TYPES = new Set(['motor', 'motor_bo', 'motor_dc'])

// Names that are injected as closure variables — skip any user #define with these
// names to avoid "Identifier already declared" errors in strict mode.
const BUILTIN_NAMES = new Set([
  'analogWrite','digitalWrite','pinMode','digitalRead','analogRead',
  'delay','HIGH','LOW','OUTPUT','INPUT',
  'millis','micros','map','constrain',
  'abs','min','max','sq','sqrt','pow','floor','ceil','round','log','exp',
  'sin','cos','tan','random','randomSeed','Serial','onRuntimeError',
  'Servo',
  // SUBO library API + constants
  'SuboMatrixInit','setAllLED','setSingleLED','playLEDSeq','stripclear',
  'playTone','stopBuzzer','playBuzSeq','start_motors','drive_motors','runMotor',
  'IO1','IO2','IO3','IO4','IO5','IO6','IO7','IO8','IO9','IO10','IO11','IO12',
  'IO13','IO14','IO15','IO16','IO17','IO18','IO19','IO20','IO21',
  'SUBO_BUZZER_PIN','SUBO_LED_PIN','SUBO_LED_NUM','SUBO_BUTTONR','SUBO_BUTTONL',
])

class SimulationManager {
  constructor() {
    this._running         = false
    this._cancelDelay     = null
    this._onMotorSpeed    = null
    this._onLedBrightness = null
    this._onServoAngle    = null
    this._onRuntimeError  = null
    this._onSerialOut     = null
    this._connections     = {}
    this._objects         = []
    this.motorSpeeds      = {}   // motorId → signed speed −255…+255
    this._motorTerminals  = {}   // motorId → { A: 0, B: 0 }
    this.ledBrightness    = {}
    this.servoAngles      = {}   // servoId → angle 0–180°
  }

  configure(connections, objects, onMotorSpeed, onRuntimeError, onSerialOut, onLedBrightness, onServoAngle) {
    this._connections     = connections
    this._objects         = objects
    this._onMotorSpeed    = onMotorSpeed    ?? null
    this._onRuntimeError  = onRuntimeError  ?? null
    this._onSerialOut     = onSerialOut     ?? null
    this._onLedBrightness = onLedBrightness ?? null
    this._onServoAngle    = onServoAngle    ?? null
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

    // Yield control to the browser once per loop() iteration. Without this, a
    // loop() that never calls delay() (easy to make with blocks) spins forever
    // on the main thread and hard-freezes the page. Also lets stop() interrupt.
    const __yield = () =>
      new Promise((resolve, reject) => {
        if (!self._running) { reject(new Error('stopped')); return }
        const id = setTimeout(resolve, 0)
        self._cancelDelay = () => { clearTimeout(id); reject(new Error('stopped')) }
      })

    const _write = (pin, val, isDigital) => {
      if (!self._running) return
      const comps = pinMap[pin]
      if (!comps || comps.length === 0) {
        console.warn(`[Sim] pin ${pin} written but no component connected — check wire connections`)
        return
      }
      // Raw value is always 0–255 (magnitude of the signal on this pin)
      const value = isDigital ? (val ? 255 : 0) : Math.max(0, Math.min(255, Number(val) || 0))
      for (const comp of comps) {
        if (MOTOR_TYPES.has(comp.type)) {
          // Track each terminal separately so swapping connections reverses direction.
          // Net speed = TERM_A_value − TERM_B_value  (range −255 … +255)
          if (!self._motorTerminals[comp.id]) self._motorTerminals[comp.id] = { A: 0, B: 0 }
          self._motorTerminals[comp.id][comp.terminal || 'A'] = value
          const { A, B } = self._motorTerminals[comp.id]
          const net = A - B
          if (!self._dbgWrites) self._dbgWrites = 0
          if (++self._dbgWrites <= 20)
            console.log(`[Sim] pin${pin}=${value} → motor T${comp.terminal}: A=${A} B=${B} net=${net}`)
          if (A !== 0 && B !== 0 && net === 0)
            console.warn('[Sim] Motor speed is 0 because TERM_A and TERM_B are BOTH wired to the same pin. Wire TERM_B to GND instead of D' + pin + '.')
          self.motorSpeeds[comp.id] = net
          if (self._onMotorSpeed) self._onMotorSpeed(comp.id, net)
        } else if (comp.type === 'led') {
          self.ledBrightness[comp.id] = value
          if (self._onLedBrightness) self._onLedBrightness(comp.id, value)
        } else if (comp.type === 'servo') {
          // analogWrite fallback: map 0–255 → 0–180°
          const angle = Math.round((value / 255) * 180)
          self.servoAngles[comp.id] = angle
          if (self._onServoAngle) self._onServoAngle(comp.id, angle)
        }
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

    // ── Servo library class ───────────────────────────────────────────────────
    // `Servo myServo;` transpiles to `let myServo = new Servo()`.
    // attach(pin) + write(angle) are the two methods users call.
    class Servo {
      constructor() { this._pin = -1; this._angle = 90 }
      attach(pin)   { this._pin = Number(pin) }
      write(angle) {
        this._angle = Math.max(0, Math.min(180, Number(angle) || 0))
        for (const comp of (pinMap[this._pin] || [])) {
          if (comp.type === 'servo') {
            self.servoAngles[comp.id] = this._angle
            if (self._onServoAngle) self._onServoAngle(comp.id, this._angle)
          }
        }
      }
      writeMicroseconds(us) {
        this.write(Math.max(0, Math.min(180, ((Number(us) - 500) / 2000) * 180)))
      }
      read()     { return this._angle }
      attached() { return this._pin >= 0 }
      detach()   { this._pin = -1 }
    }

    // ── SUBO board library shims ──────────────────────────────────────────────
    // Lets real Subo sketches (Subo.h / MotorExpansion.h) run in the simulator.
    // Motor-expansion pins (GPIO): M1A=9, M1B=3, M2A=10, M2B=11 → drive wired motors.
    const _mexSet = (a, b, c, d) => {
      _write(9, a, false); _write(3, b, false); _write(10, c, false); _write(11, d, false)
    }
    const SuboMatrixInit = () => {}
    const stripclear     = () => { if (self._onSuboMatrix) self._onSuboMatrix('clear') }
    const setAllLED      = (r, g, b) => { if (self._onSuboMatrix) self._onSuboMatrix('all', r, g, b) }
    const setSingleLED   = (n, r, g, b) => { if (self._onSuboMatrix) self._onSuboMatrix('one', n, r, g, b) }
    const playLEDSeq     = () => {}
    const playTone       = (f, dur) => { if (self._onSerialOut) self._onSerialOut(`♪ ${Math.round(f)}Hz ${dur}s\n`) }
    const stopBuzzer     = () => {}
    const playBuzSeq     = () => {}
    const start_motors   = () => {}
    const drive_motors   = (m1a, m1b, m2a, m2b) => _mexSet(+m1a || 0, +m1b || 0, +m2a || 0, +m2b || 0)
    const runMotor       = (dir, speed) => {
      const s = Number(speed) || 0
      if      (dir === 'F') _mexSet(s, 0, s, 0)
      else if (dir === 'B') _mexSet(0, s, 0, s)
      else if (dir === 'L') _mexSet(s, 0, 0, s)
      else if (dir === 'R') _mexSet(0, s, s, 0)
      else                  _mexSet(0, 0, 0, 0)
    }

    // SUBO constants (IOn → GPIO, onboard pins) — prepended to the script so the
    // user's library-style code (digitalWrite(IO3,...) etc.) resolves them.
    const SUBO_CONSTS = `const IO1=4,IO2=39,IO3=13,IO4=38,IO5=14,IO6=48,IO7=42,IO8=5,IO9=41,IO10=40,IO11=6,IO12=7,IO13=15,IO14=16,IO15=17,IO16=18,IO17=8,IO18=11,IO19=10,IO20=9,IO21=3,SUBO_BUZZER_PIN=2,SUBO_LED_PIN=12,SUBO_LED_NUM=48,SUBO_BUTTONR=47,SUBO_BUTTONL=1;`

    // ── Parse + transpile ─────────────────────────────────────────────────────

    for (const [pin, comps] of Object.entries(pinMap))
      console.log(`[Sim] pin ${pin}:`, comps.map(c => `${c.type} T${c.terminal}`).join(', '))
    const { code: jsCode, error: parseErr } = parseAndTranspile(code, BUILTIN_NAMES)
    if (parseErr) {
      this._running = false
      return { error: 'Parse error: ' + parseErr }
    }

    const script = `
${SUBO_CONSTS}
${jsCode}
if (typeof setup === 'function') await setup();
while (true) {
  if (typeof loop === 'function') await loop();
  await __yield();
}
`

    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'analogWrite','digitalWrite','pinMode','digitalRead','analogRead',
        'delay','HIGH','LOW','OUTPUT','INPUT',
        'millis','micros','map','constrain',
        'abs','min','max','sq','sqrt','pow','floor','ceil','round','log','exp',
        'sin','cos','tan','random','randomSeed','Serial','onRuntimeError','Servo','__yield',
        'SuboMatrixInit','setAllLED','setSingleLED','playLEDSeq','stripclear',
        'playTone','stopBuzzer','playBuzSeq','start_motors','drive_motors','runMotor',
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
        sin, cos, tan, random, randomSeed, Serial, onRuntimeError, Servo, __yield,
        SuboMatrixInit, setAllLED, setSingleLED, playLEDSeq, stripclear,
        playTone, stopBuzzer, playBuzSeq, start_motors, drive_motors, runMotor
      ).then(() => { self._running = false })

    } catch (e) {
      this._running = false
      return { error: e.message }
    }

    return null
  }

  stop() {
    this._running = false
    for (const [id] of Object.entries(this.ledBrightness)) {
      if (this._onLedBrightness) this._onLedBrightness(id, 0)
    }
    this.motorSpeeds     = {}
    this._motorTerminals = {}
    this.ledBrightness   = {}
    this.servoAngles     = {}
    if (this._cancelDelay) {
      this._cancelDelay()
      this._cancelDelay = null
    }
  }

  isRunning() { return this._running }
}

export const simulationManager = new SimulationManager()
