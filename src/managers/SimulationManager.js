import { buildPinToComponentMap, buildSensorInputMap, useElectronicsStore } from '../stores/electronicsStore.js'
import { objectManager } from './ObjectManager.js'
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
  // Sensors / outputs API + constants
  'delayMicroseconds','pulseIn','tone','noTone','Wire','Adafruit_SSD1306',
  'A0','A1','A2','A3','A4','A5','A6','A7','INPUT_PULLUP','LED_BUILTIN',
  'WHITE','BLACK','SSD1306_WHITE','SSD1306_BLACK','SSD1306_INVERSE',
  'SSD1306_SWITCHCAPVCC','SSD1306_EXTERNALVCC','SCREEN_WIDTH','SCREEN_HEIGHT',
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
    this._onOled          = null
    this._onBuzzer        = null
    this._audio           = null
    this._stopOsc         = null
    this._connections     = {}
    this._objects         = []
    this.motorSpeeds      = {}   // motorId → signed speed −255…+255
    this._motorTerminals  = {}   // motorId → { A: 0, B: 0 }
    this.ledBrightness    = {}
    this.servoAngles      = {}   // servoId → angle 0–180°
  }

  configure(connections, objects, onMotorSpeed, onRuntimeError, onSerialOut, onLedBrightness, onServoAngle, onOled, onBuzzer) {
    this._connections     = connections
    this._objects         = objects
    this._onMotorSpeed    = onMotorSpeed    ?? null
    this._onRuntimeError  = onRuntimeError  ?? null
    this._onSerialOut     = onSerialOut     ?? null
    this._onLedBrightness = onLedBrightness ?? null
    this._onServoAngle    = onServoAngle    ?? null
    this._onOled          = onOled          ?? null
    this._onBuzzer        = onBuzzer        ?? null
  }

  start(code) {
    this.stop()
    this._running = true

    const pinMap    = buildPinToComponentMap(this._connections, this._objects)
    const sensorMap = buildSensorInputMap(this._connections, this._objects)
    const self      = this

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
        } else if (comp.type === 'buzzer') {
          // Passive buzzer driven on/off via digitalWrite: HIGH → ~2 kHz, LOW → silent.
          if (value > 0) _beep(2000, 0); else _silence()
          if (self._onBuzzer) self._onBuzzer(comp.id, value > 0 ? 2000 : 0)
        }
      }
    }

    const analogWrite  = (pin, val) => _write(pin, val, false)
    const digitalWrite = (pin, val) => _write(pin, val, true)
    const pinMode      = () => {}

    // ── Sensor inputs (sensor → controller) ───────────────────────────────────
    // In AUTO mode the value is measured live from the scene (distance to the
    // nearest shape); in MANUAL mode it comes from the Sensor panel. Auto readings
    // are mirrored back to the store so the panels show them. Works regardless of
    // which Run button launched the sim (Code tab or Simulate bar).
    const _store  = () => useElectronicsStore.getState()
    const _report = (id, v) => { const st = _store(); if (st.sensorValues[id] !== v) st.setSensorValue(id, v) }
    // Reading in display units: ultrasonic → cm, ir → 0|1, gas → 0-1023.
    const _read = (s) => {
      const st = _store()
      if (s.type === 'gas_sensor') return st.sensorValues[s.id] ?? 0   // gas: always manual
      if (st.autoSense) {
        const d  = objectManager.senseDistance(s.id)        // scene units, or null
        const cm = d == null ? null : Math.round(d * 5)     // 1 scene unit = 5 cm
        if (s.type === 'ultrasonic') { const v = cm == null ? 400 : Math.min(400, cm); _report(s.id, v); return v }
        if (s.type === 'ir_sensor')  { const v = (cm != null && cm <= 30) ? 1 : 0;     _report(s.id, v); return v }
      }
      return st.sensorValues[s.id] ?? (s.type === 'ultrasonic' ? 100 : 0)
    }
    const digitalRead = (pin) => {
      const s = sensorMap[pin]
      if (!s) return 0
      if (s.type === 'ir_sensor')  return _read(s) ? 1 : 0
      if (s.type === 'gas_sensor') return (_read(s) > 512) ? 1 : 0    // DO threshold
      return 0
    }
    const analogRead = (pin) => {
      const s = sensorMap[pin]
      if (!s) return 0
      const v = _read(s)
      if (s.type === 'ir_sensor') return v ? 1023 : 0
      return Math.max(0, Math.min(1023, Math.round(v)))   // gas / generic analog
    }
    // HC-SR04: returns echo pulse width (µs). distance_cm = pulseIn(echo)/58.
    const pulseIn = (pin) => {
      const s = sensorMap[pin]
      if (!s || s.type !== 'ultrasonic') return 0
      return Math.round(_read(s) * 58)
    }
    const delayMicroseconds = () => {}   // sub-millisecond — effectively instant here

    // ── Buzzer (Web Audio) ────────────────────────────────────────────────────
    const _beep = (freq, durSec) => {
      try {
        if (!self._audio) self._audio = new (window.AudioContext || window.webkitAudioContext)()
        const ctx = self._audio
        if (ctx.state === 'suspended') ctx.resume()
        if (self._stopOsc) self._stopOsc()
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.type = 'square'
        osc.frequency.value = Math.max(20, Math.min(8000, Number(freq) || 440))
        gain.gain.value = 0.04
        osc.connect(gain); gain.connect(ctx.destination); osc.start()
        self._stopOsc = () => { try { osc.stop() } catch (_) {} self._stopOsc = null }
        if (durSec > 0) setTimeout(() => { if (self._stopOsc) self._stopOsc() }, durSec * 1000)
      } catch (_) { /* audio unavailable */ }
    }
    const _silence = () => { if (self._stopOsc) self._stopOsc() }
    const tone = (pin, freq, dur) => {
      _beep(freq, dur ? Number(dur) / 1000 : 0)
      if (self._onSerialOut) self._onSerialOut(`♪ ${Math.round(Number(freq) || 0)}Hz\n`)
      for (const c of (pinMap[pin] || [])) if (c.type === 'buzzer' && self._onBuzzer) self._onBuzzer(c.id, Number(freq) || 0)
    }
    const noTone = (pin) => {
      _silence()
      for (const c of (pinMap[pin] || [])) if (c.type === 'buzzer' && self._onBuzzer) self._onBuzzer(c.id, 0)
    }

    // ── OLED + I2C ────────────────────────────────────────────────────────────
    // Render onto every OLED's 3D screen (works whether launched from the Code tab
    // or the Simulate bar), and also forward to any panel HUD via onOled.
    const _oledSet = (text) => {
      for (const o of self._objects) if (o.type === 'oled') objectManager.setOledScreen(o.id, text)
      if (self._onOled) self._onOled(text)
    }
    class Adafruit_SSD1306 {
      constructor() { this._lines = []; this._cur = '' }
      begin() { _oledSet(''); return true }
      clearDisplay() { this._lines = []; this._cur = '' }
      setCursor() {} setTextSize() {} setTextColor() {} setRotation() {} cp437() {} dim() {}
      print(t)   { this._cur += String(t ?? '') }
      write(t)   { this._cur += String(t ?? '') }
      println(t) { this._lines.push(this._cur + String(t ?? '')); this._cur = '' }
      drawPixel() {} drawLine() {} drawRect() {} fillRect() {} drawCircle() {} fillCircle() {} fillScreen() {} drawBitmap() {} startscrollright() {} stopscroll() {}
      display() {
        const out = [...this._lines]; if (this._cur) out.push(this._cur)
        _oledSet(out.join('\n'))
      }
      width()  { return 128 }
      height() { return 64 }
    }
    const Wire = {
      begin() {}, beginTransmission() {}, write() {}, endTransmission() { return 0 },
      requestFrom() { return 0 }, read() { return 0 }, available() { return 0 },
    }

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
    const SUBO_CONSTS = `const IO1=4,IO2=39,IO3=13,IO4=38,IO5=14,IO6=48,IO7=42,IO8=5,IO9=41,IO10=40,IO11=6,IO12=7,IO13=15,IO14=16,IO15=17,IO16=18,IO17=8,IO18=11,IO19=10,IO20=9,IO21=3,SUBO_BUZZER_PIN=2,SUBO_LED_PIN=12,SUBO_LED_NUM=48,SUBO_BUTTONR=47,SUBO_BUTTONL=1,A0=14,A1=15,A2=16,A3=17,A4=18,A5=19,A6=20,A7=21,INPUT_PULLUP=2,LED_BUILTIN=13,WHITE=1,BLACK=0,SSD1306_WHITE=1,SSD1306_BLACK=0,SSD1306_INVERSE=2,SSD1306_SWITCHCAPVCC=2,SSD1306_EXTERNALVCC=1,SCREEN_WIDTH=128,SCREEN_HEIGHT=64;`

    // ── Parse + transpile ─────────────────────────────────────────────────────

    for (const [pin, comps] of Object.entries(pinMap))
      console.log(`[Sim] pin ${pin}:`, comps.map(c => `${c.type} T${c.terminal}`).join(', '))
    for (const [pin, s] of Object.entries(sensorMap))
      console.log(`[Sim] sensor on pin ${pin}: ${s.type} (${s.pin})`)
    if (Object.keys(sensorMap).length === 0)
      console.log('[Sim] no sensors wired to a controller pin — digitalRead/analogRead/pulseIn will read 0')
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
        'delayMicroseconds','pulseIn','tone','noTone','Wire','Adafruit_SSD1306',
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
        playTone, stopBuzzer, playBuzSeq, start_motors, drive_motors, runMotor,
        delayMicroseconds, pulseIn, tone, noTone, Wire, Adafruit_SSD1306
      ).then(() => { self._running = false })

    } catch (e) {
      this._running = false
      return { error: e.message }
    }

    return null
  }

  stop() {
    this._running = false
    if (this._stopOsc) this._stopOsc()        // silence the buzzer
    for (const o of this._objects) if (o.type === 'oled') objectManager.setOledScreen(o.id, '')   // blank OLED screens
    if (this._onOled) this._onOled('')         // blank the panel HUD
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
