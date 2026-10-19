import { buildPinToComponentMap, buildSensorInputMap, isSensorPowered, SENSOR_TYPES, useElectronicsStore } from '../stores/electronicsStore.js'
import { roboticsHardware } from './physics/robotics/telemetry.js'
import { objectManager } from './ObjectManager.js'
import { parseAndTranspile } from '../utils/arduinoParser.js'
import { createSensorLibraries } from '../arduino/sensorLibs.js'
import { runSketchSandboxed } from './sketchSandbox.js'

const MOTOR_TYPES = new Set(['motor', 'motor_bo', 'motor_dc'])

// NOTE_* frequency constants — mirrors src/arduino/libraries/Subo/pitches.h so
// official SUBO melody sketches (playTone(NOTE_C5, …)) compile unchanged.
const SUBO_NOTES = {
  NOTE_B0:31,NOTE_C1:33,NOTE_CS1:35,NOTE_D1:37,NOTE_DS1:39,NOTE_E1:41,NOTE_F1:44,NOTE_FS1:46,NOTE_G1:49,NOTE_GS1:52,NOTE_A1:55,NOTE_AS1:58,NOTE_B1:62,
  NOTE_C2:65,NOTE_CS2:69,NOTE_D2:73,NOTE_DS2:78,NOTE_E2:82,NOTE_F2:87,NOTE_FS2:93,NOTE_G2:98,NOTE_GS2:104,NOTE_A2:110,NOTE_AS2:117,NOTE_B2:123,
  NOTE_C3:131,NOTE_CS3:139,NOTE_DB3:139,NOTE_D3:147,NOTE_DS3:156,NOTE_EB3:156,NOTE_E3:165,NOTE_F3:175,NOTE_FS3:185,NOTE_G3:196,NOTE_GS3:208,NOTE_A3:220,NOTE_AS3:233,NOTE_B3:247,
  NOTE_C4:262,NOTE_CS4:277,NOTE_D4:294,NOTE_DS4:311,NOTE_E4:330,NOTE_F4:349,NOTE_FS4:370,NOTE_G4:392,NOTE_GS4:415,NOTE_A4:440,NOTE_AS4:466,NOTE_B4:494,
  NOTE_C5:523,NOTE_CS5:554,NOTE_D5:587,NOTE_DS5:622,NOTE_E5:659,NOTE_F5:698,NOTE_FS5:740,NOTE_G5:784,NOTE_GS5:831,NOTE_A5:880,NOTE_AS5:932,NOTE_B5:988,
  NOTE_C6:1047,NOTE_CS6:1109,NOTE_D6:1175,NOTE_DS6:1245,NOTE_E6:1319,NOTE_F6:1397,NOTE_FS6:1480,NOTE_G6:1568,NOTE_GS6:1661,NOTE_A6:1760,NOTE_AS6:1865,NOTE_B6:1976,
  NOTE_C7:2093,NOTE_CS7:2217,NOTE_D7:2349,NOTE_DS7:2489,NOTE_E7:2637,NOTE_F7:2794,NOTE_FS7:2960,NOTE_G7:3136,NOTE_GS7:3322,NOTE_A7:3520,NOTE_AS7:3729,NOTE_B7:3951,
  NOTE_C8:4186,NOTE_CS8:4435,NOTE_D8:4699,NOTE_DS8:4978,REST:0,
}

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
  // Legged locomotion API
  'walk','turn','stopWalking',
  // Sensors / outputs API + constants
  'delayMicroseconds','pulseIn','tone','noTone','Wire','Adafruit_SSD1306',
  'A0','A1','A2','A3','A4','A5','A6','A7','INPUT_PULLUP','LED_BUILTIN',
  'WHITE','BLACK','SSD1306_WHITE','SSD1306_BLACK','SSD1306_INVERSE',
  'SSD1306_SWITCHCAPVCC','SSD1306_EXTERNALVCC','SCREEN_WIDTH','SCREEN_HEIGHT',
  // New sensor libraries (LDR / DHT11 / ColorSensor) + their pin macros
  'LDR','DHT11','ColorSensor','RGB','S0','S1','S2','S3','OUT',
  // Physics-simulated hardware (articulated robots): IMU / joint encoders / battery
  'IMU','Encoder','Battery',
  // SUBO pitches.h note constants
  ...Object.keys(SUBO_NOTES),
])

class SimulationManager {
  constructor() {
    this._running         = false
    this._cancelDelay     = null
    this._sandbox         = null
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
    // Legged locomotion drive intent set by the sketch via walk()/turn(). Units
    // match DrivePanel's drive controls (speed = scene units/s, turn = rad/s) so
    // DriveManager can use them interchangeably. _leggedCmd flips true the first
    // time the code issues any walk/turn/stopWalking call — that's the signal to
    // let the gait engine translate the body instead of skipping it.
    this.leggedDrive      = { speed: 0, turn: 0 }
    this._leggedCmd       = false
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
    // Reset code-driven legged locomotion each run.
    this.leggedDrive = { speed: 0, turn: 0 }
    this._leggedCmd  = false

    const pinMap    = buildPinToComponentMap(this._connections, this._objects)
    const sensorMap = buildSensorInputMap(this._connections, this._objects)
    const self      = this

    // Sensor libraries (LDR / DHT11 / ColorSensor / RGB) — provided to the sketch
    // exactly like the built-in Servo class. Each instance binds to the scene
    // sensor wired to its pin (via sensorMap) and routes readings through the
    // single reusable sensorSim interface.
    const { LDR, DHT11, ColorSensor } = createSensorLibraries({
      sensorMap,
      getStore: () => useElectronicsStore.getState(),
    })

    // ── Arduino API ───────────────────────────────────────────────────────────
    // NOTE: the pure parts of the API (delay, millis, maths, Serial, the Servo /
    // sensor / SUBO classes …) live INSIDE the sandbox frame — see
    // sketchSandbox.js. What remains here is everything that needs the scene,
    // the wiring maps, audio or physics: the sandbox forwards those calls to the
    // `dispatch` table at the end of start(), and reads values back through the
    // per-frame snapshot built by _buildInput().

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


    // ── Legged locomotion API (beginner "just walk it" path) ───────────────────
    // walk(speed) / turn(rate) / stopWalking() set a drive intent that the gait
    // engine reads to actually move a legged robot's body. speed & rate are −100…
    // +100 (%). Raw Servo.write() still animates individual leg servos for hand-
    // authored gaits — using walk() just takes over the locomotion + auto-gait.
    const LEGGED_CODE_MAX_SPEED = 8    // matches DrivePanel LEGGED_SPEED (units/s)
    const LEGGED_CODE_MAX_TURN  = 1.8  // matches DrivePanel LEGGED_TURN  (rad/s)
    const walk = (speed) => {
      const p = Math.max(-100, Math.min(100, Number(speed) || 0)) / 100
      self.leggedDrive.speed = p * LEGGED_CODE_MAX_SPEED
      self._leggedCmd = true
    }
    const turn = (rate) => {
      const p = Math.max(-100, Math.min(100, Number(rate) || 0)) / 100
      self.leggedDrive.turn = p * LEGGED_CODE_MAX_TURN
      self._leggedCmd = true
    }
    const stopWalking = () => {
      self.leggedDrive.speed = 0
      self.leggedDrive.turn = 0
      self._leggedCmd = true
    }

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
      if (s) {
        if (s.type === 'ir_sensor')  return _read(s) ? 1 : 0
        if (s.type === 'gas_sensor') return (_read(s) > 512) ? 1 : 0    // DO threshold
        return 0
      }
      // SUBO on-board push buttons (GPIO 47 = right, 1 = left). Real hardware
      // uses internal pull-ups → idle HIGH (1), pressed LOW (0). State comes from
      // the sim's SUBO panel; only active when a SUBO board is in the scene.
      if (self._objects.some(o => o.type === 'subo')) {
        const sv = _store().sensorValues
        if (pin === 47) return sv['SUBO_BTN_R'] ? 0 : 1
        if (pin === 1)  return sv['SUBO_BTN_L'] ? 0 : 1
      }
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

    const onRuntimeError = (msg) => {
      self._running = false
      self.motorSpeeds   = {}
      self.ledBrightness = {}
      if (self._onRuntimeError) self._onRuntimeError(msg)
    }

    // ── Servo binding (the sandboxed Servo class forwards here) ───────────────
    // Auto-bind so the CODE drives real servos even when the user hasn't
    // manually wired them (common for legged robots). If NO servo is wired to
    // this pin, claim the next unclaimed scene servo — in scene order, which
    // usually matches how the legs were built — so Servo.write() animates actual
    // leg servos (and the body then walks). Wired setups are untouched: this
    // only fires when the pin has no servo from the wiring.
    const _servoAttach = (pin) => {
      const p = Number(pin)
      const hasWired = (pinMap[p] || []).some(c => c.type === 'servo')
      if (hasWired) return
      const claimed = self._autoServoIds || (self._autoServoIds = new Set())
      const wiredIds = new Set()
      for (const arr of Object.values(pinMap))
        for (const c of arr) if (c.type === 'servo') wiredIds.add(c.id)
      const next = self._objects.find(
        (o) => o.type === 'servo' && !wiredIds.has(o.id) && !claimed.has(o.id)
      )
      if (next) {
        claimed.add(next.id)
        ;(pinMap[p] ||= []).push({ id: next.id, type: 'servo', terminal: 'A' })
        console.log(`[Sim] auto-bound servo ${next.id} → pin ${p} (no wire; code-driven)`)
      }
    }
    const _servoWrite = (pin, angle) => {
      const a = Math.max(0, Math.min(180, Number(angle) || 0))
      for (const comp of (pinMap[Number(pin)] || [])) {
        if (comp.type === 'servo') {
          self.servoAngles[comp.id] = a
          if (self._onServoAngle) self._onServoAngle(comp.id, a)
        }
      }
    }

    // Sensor-library values, resolved per pin for the sandbox snapshot. Uses the
    // very same library classes the sketch used to call directly, so readings
    // (including "not wired" values) are unchanged.
    const _libInst = new Map()
    const libReaders = (pin) => {
      const s = sensorMap[pin]
      if (!s) return {}
      let L = _libInst.get(pin)
      if (!L) {
        L = { ldr: new LDR(pin), dht: new DHT11(pin), col: new ColorSensor(0, 0, 0, 0, pin) }
        _libInst.set(pin, L)
      }
      const out = {}
      if (s.type === 'ldr_sensor')   { out.ldr = L.ldr.read(); out.ldrPct = L.ldr.readPercentage() }
      if (s.type === 'dht11')        { out.temp = L.dht.readTemperature(); out.hum = L.dht.readHumidity() }
      if (s.type === 'color_sensor') { const c = L.col.readRGB(); out.rgb = { r: c.r, g: c.g, b: c.b }; out.color = L.col.readColor() }
      return out
    }


    // ── SUBO board library shims ──────────────────────────────────────────────
    // Lets real Subo sketches (Subo.h / MotorExpansion.h) run in the simulator.
    // Motor-expansion pins (GPIO): M1A=9, M1B=3, M2A=10, M2B=11 → drive wired motors.
    const _mexSet = (a, b, c, d) => {
      _write(9, a, false); _write(3, b, false); _write(10, c, false); _write(11, d, false)
    }
    // On-board 48-LED NeoPixel matrix — drive every SUBO board's 3D matrix.
    const _matrixSet = (mode, ...args) => {
      for (const o of self._objects) if (o.type === 'subo') objectManager.setSuboMatrix(o.id, mode, ...args)
    }
    // On-board buzzer — real Web-Audio tone. NOTE: SUBO's dur is in SECONDS.
    const playTone       = (f, dur) => {
      _beep(+f || 440, dur ? +dur : 0)
      if (self._onSerialOut) self._onSerialOut(`♪ ${Math.round(+f || 0)}Hz\n`)
    }
    const stopBuzzer     = () => { _silence() }
    const playBuzSeq     = (id) => {
      // Simplified built-in melodies (ids 1–5) played through the buzzer.
      const seqs = {
        1: [523, 659, 784, 1047], 2: [1047, 784, 659, 523], 3: [440, 554, 659, 880],
        4: [659, 659, 0, 659, 0, 523, 659, 784], 5: [523, 587, 659, 698, 784, 880],
      }
      const notes = seqs[Math.round(id)] || seqs[1]
      let t = 0
      for (const n of notes) { const nn = n; setTimeout(() => { if (self._running) { nn ? _beep(nn, 0.16) : _silence() } }, t); t += 190 }
    }

    // SUBO constants (IOn → GPIO, onboard pins) — prepended to the script so the
    // user's library-style code (digitalWrite(IO3,...) etc.) resolves them.
    const SUBO_CONSTS = `const IO1=4,IO2=39,IO3=13,IO4=38,IO5=14,IO6=48,IO7=42,IO8=5,IO9=41,IO10=40,IO11=6,IO12=7,IO13=15,IO14=16,IO15=17,IO16=18,IO17=8,IO18=11,IO19=10,IO20=9,IO21=3,SUBO_BUZZER_PIN=2,SUBO_LED_PIN=12,SUBO_LED_NUM=48,SUBO_BUTTONR=47,SUBO_BUTTONL=1,A0=14,A1=15,A2=16,A3=17,A4=18,A5=19,A6=20,A7=21,INPUT_PULLUP=2,LED_BUILTIN=13,WHITE=1,BLACK=0,SSD1306_WHITE=1,SSD1306_BLACK=0,SSD1306_INVERSE=2,SSD1306_SWITCHCAPVCC=2,SSD1306_EXTERNALVCC=1,SCREEN_WIDTH=128,SCREEN_HEIGHT=64;`

    // Default TCS3200 colour-sensor control-pin macros, so `ColorSensor color(S0,
    // S1,S2,S3,OUT);` runs even when a copied sketch omits its own #defines.
    // A sketch that DOES #define them has those skipped (see BUILTIN_NAMES) and
    // uses these instead — harmless because the simulated reading is pin-agnostic.
    const SENSOR_CONSTS = `const S0=4,S1=5,S2=6,S3=7,OUT=8;`

    // pitches.h NOTE_* constants for SUBO buzzer melody sketches.
    const SUBO_NOTE_DEFS = 'const ' + Object.entries(SUBO_NOTES).map(([k, v]) => `${k}=${v}`).join(',') + ';'

    // ── Parse + transpile ─────────────────────────────────────────────────────

    for (const [pin, comps] of Object.entries(pinMap))
      console.log(`[Sim] pin ${pin}:`, comps.map(c => `${c.type} T${c.terminal}`).join(', '))
    for (const [pin, s] of Object.entries(sensorMap))
      console.log(`[Sim] sensor on pin ${pin}: ${s.type} (${s.pin})`)
    if (Object.keys(sensorMap).length === 0)
      console.log('[Sim] no sensors wired to a controller pin — digitalRead/analogRead/pulseIn will read 0')
    // Flag sensors that ARE present but won't read because they lack correct
    // power/ground — so wrong wiring fails loudly instead of silently working.
    for (const o of this._objects) {
      if (!SENSOR_TYPES.has(o.type)) continue
      if (!isSensorPowered(this._connections, this._objects, o.id))
        console.warn(`[Sim] ${o.name || o.type} has no power/ground — needs VCC→5V and GND→GND. Reads as disconnected.`)
    }
    // IMU / Encoder / Battery read the articulated physics sensor models. If the
    // sketch uses them with no physics robot running, say so once — the readings
    // are neutral placeholders, not measurements.
    if (/\b(IMU|Encoder|Battery)\b/.test(code) && !roboticsHardware.active && this._onSerialOut)
      this._onSerialOut('[sim] IMU/Encoder/Battery read physics sensors — start the Simulation to get live values\n')

    const { code: jsCode, error: parseErr } = parseAndTranspile(code, BUILTIN_NAMES)
    if (parseErr) {
      this._running = false
      return { error: 'Parse error: ' + parseErr }
    }


    // ── Run the sketch in an isolated frame ───────────────────────────────────
    // The sketch may come from a shared link or someone else's community build,
    // so it never runs in this page's realm (see sketchSandbox.js). It can only
    // reach the app through the calls dispatched below.
    const servoInstances = new Map()          // pin → last angle, for Servo.read()
    const dispatch = (fn, a) => {
      if (!self._running) return
      switch (fn) {
        case 'analogWrite':  _write(a[0], a[1], false); break
        case 'digitalWrite': _write(a[0], a[1], true); break
        case 'tone':         tone(a[0], a[1], a[2]); break
        case 'noTone':       noTone(a[0]); break
        case 'serial':       if (self._onSerialOut) self._onSerialOut(a[0]); break
        case 'oled':         _oledSet(a[0]); break
        case 'servoAttach':  _servoAttach(a[0]); break
        case 'servoWrite':   _servoWrite(a[0], a[1]); servoInstances.set(a[0], a[1]); break
        case 'matrix':       _matrixSet(...a); break
        case 'playTone':     playTone(a[0], a[1]); break
        case 'stopBuzzer':   stopBuzzer(); break
        case 'playBuzSeq':   playBuzSeq(a[0]); break
        case 'driveMotors':  _mexSet(a[0], a[1], a[2], a[3]); break
        case 'walk':         walk(a[0]); break
        case 'turn':         turn(a[0]); break
        case 'stopWalking':  stopWalking(); break
        default: break      // unknown call → ignored
      }
    }

    try {
      this._sandbox = runSketchSandboxed({
        userJs: jsCode,
        consts: `${SUBO_CONSTS}\n${SENSOR_CONSTS}\n${SUBO_NOTE_DEFS}`,
        onOut: dispatch,
        onError: (msg) => onRuntimeError(msg),
        getInput: () => self._buildInput(sensorMap, pinMap, digitalRead, analogRead, pulseIn, libReaders),
      })
    } catch (e) {
      this._running = false
      return { error: e.message }
    }

    return null
  }

  /**
   * Snapshot of everything the sketch can read, rebuilt once per animation frame
   * and posted into the sandbox. Values are resolved HERE (scene, wiring maps,
   * physics telemetry) because the frame has no access to any of that.
   */
  _buildInput(sensorMap, pinMap, digitalRead, analogRead, pulseIn, libReaders) {
    const aread = {}, dread = {}, pulse = {}, lib = {}, enc = {}
    for (const pin of Object.keys(sensorMap)) {
      const p = Number(pin)
      aread[p] = analogRead(p)
      dread[p] = digitalRead(p)
      pulse[p] = pulseIn(p)
      lib[p] = libReaders(p)
    }
    // SUBO on-board buttons are not in sensorMap but are read with digitalRead.
    for (const p of [47, 1]) if (dread[p] == null) dread[p] = digitalRead(p)
    // Encoders read the servo wired to a pin.
    for (const [pin, comps] of Object.entries(pinMap)) {
      const servo = comps.find(c => c.type === 'servo')
      if (!servo) continue
      const e = roboticsHardware.encoder(servo.id)
      enc[Number(pin)] = e ? { deg: e.deg, degPerSec: e.degPerSec } : { deg: 90, degPerSec: 0 }
    }
    return {
      aread, dread, pulse, lib, enc,
      imu: roboticsHardware.imu() ?? null,
      battery: roboticsHardware.battery() ?? null,
      hwActive: !!roboticsHardware.active,
    }
  }

  stop() {
    this._running = false
    if (this._stopOsc) this._stopOsc()        // silence the buzzer
    for (const o of this._objects) if (o.type === 'oled') objectManager.setOledScreen(o.id, '')   // blank OLED screens
    for (const o of this._objects) if (o.type === 'subo') objectManager.setSuboMatrix(o.id, 'clear')  // blank SUBO matrix
    if (this._onOled) this._onOled('')         // blank the panel HUD
    for (const [id] of Object.entries(this.ledBrightness)) {
      if (this._onLedBrightness) this._onLedBrightness(id, 0)
    }
    this.motorSpeeds     = {}
    this._motorTerminals = {}
    this.ledBrightness   = {}
    this.servoAngles     = {}
    // Tearing down the frame kills the sketch outright — no pending timer can
    // resume it, and nothing of it survives.
    if (this._sandbox) {
      this._sandbox.stop()
      this._sandbox = null
    }
    if (this._cancelDelay) {
      this._cancelDelay()
      this._cancelDelay = null
    }
  }

  isRunning() { return this._running }
}

export const simulationManager = new SimulationManager()
