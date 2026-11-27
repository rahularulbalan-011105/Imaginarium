// ─────────────────────────────────────────────────────────────────────────────
// sensorSim — the single, reusable simulation interface for sensor readings.
//
// Every simulated sensor library (LDR / DHT11 / ColorSensor) routes its readings
// through here, so realistic, scene-driven simulation can later be added in ONE
// place without touching the libraries, the Arduino parser, the runtime wiring,
// or Blockly. Today it returns simulated/mock values, honouring any MANUAL value
// the user set in the electronics store — exactly the convention the existing
// ultrasonic / IR / gas sensors already use (electronicsStore.sensorValues).
//
// Store value keys (electronicsStore.sensorValues, keyed by scene object id):
//   ldr_sensor  → <id>            : 0–1023 raw analog light level
//   dht11       → <id>            : temperature °C
//               → <id>:hum        : relative humidity %
//   color_sensor→ <id>:rgb        : { r, g, b } 0–255
// A sensor with no manual value simply returns the simulated default.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  ldrRaw:   512,                    // mid ambient light
  tempC:    25.0,                   // room temperature
  humidity: 50.0,                   // moderate humidity
  rgb:      { r: 120, g: 90, b: 60 },
}

const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const clamp8  = (v) => clamp(Math.round(Number(v) || 0), 0, 255)
const num     = (v) => (v != null && !Number.isNaN(Number(v))) ? Number(v) : null
const valueAt = (store, key) => (key != null ? store?.sensorValues?.[key] : undefined)

// id == null means the sensor is not correctly wired/powered (not resolved from
// the pin map) → return a DISCONNECTED reading, not a simulated default. This is
// what makes wrong wiring actually fail instead of silently "working".

// LDR: virtual ambient-light level, 0 (dark) … 1023 (bright).
export function readLDR(store, id) {
  if (id == null) return 0                          // floating input reads ~dark
  const m = num(valueAt(store, id))
  return clamp(Math.round(m ?? DEFAULTS.ldrRaw), 0, 1023)
}

// LDR helper: light as a 0–100 % of full scale.
export function readLDRPercentage(store, id) {
  if (id == null) return 0
  return Math.round((readLDR(store, id) / 1023) * 100)
}

// DHT11: temperature in °C.
export function readTemperature(store, id) {
  if (id == null) return NaN                        // real DHT returns NaN on fault
  const m = num(valueAt(store, id))
  return m ?? DEFAULTS.tempC
}

// DHT11: relative humidity in %.
export function readHumidity(store, id) {
  if (id == null) return NaN
  const m = num(valueAt(store, id != null ? `${id}:hum` : null))
  return m ?? DEFAULTS.humidity
}

// Color sensor: reflected colour as { r, g, b } (0–255), or null if disconnected.
export function readColorRGB(store, id) {
  if (id == null) return null                       // no power/signal → no reading
  const m = valueAt(store, id != null ? `${id}:rgb` : null)
  if (m && typeof m === 'object') return { r: clamp8(m.r), g: clamp8(m.g), b: clamp8(m.b) }
  return { ...DEFAULTS.rgb }
}

// Classify an RGB triple into the nearest named colour (like a TCS3200 demo).
const NAMED = [
  ['Red',     255,   0,   0], ['Green',     0, 255,   0], ['Blue',    0,   0, 255],
  ['Yellow',  255, 255,   0], ['Cyan',      0, 255, 255], ['Magenta', 255, 0, 255],
  ['White',   255, 255, 255], ['Black',     0,   0,   0], ['Orange',  255, 140, 0],
]
export function classifyColor({ r, g, b }) {
  let best = 'Unknown', bestDist = Infinity
  for (const [name, nr, ng, nb] of NAMED) {
    const d = (nr - r) ** 2 + (ng - g) ** 2 + (nb - b) ** 2
    if (d < bestDist) { bestDist = d; best = name }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// Module sensors — PIR · flame · soil moisture · rain · sound · touch · Hall,
// plus the BMP280 and MPU6050 I²C sensors. Same conventions as above: id == null
// → not powered/wired → a DISCONNECTED reading; a manual value set in the sensor
// panel (electronicsStore.sensorValues) always wins over the default.
//
// Store value keys (by scene object id):
//   pir_sensor    → <id>        : 0|1 motion (manual) — auto mode: scene motion
//   flame_sensor  → <id>        : flame intensity 0–100 %
//   soil_moisture → <id>        : soil moisture 0 (dry) – 100 % (soaked)
//   rain_sensor   → <id>        : wetness of the rain board 0–100 %
//   sound_sensor  → <id>        : sound level 0 (silent) – 100 % (very loud)
//   touch_sensor  → <id>        : 0|1 finger on the pad
//   hall_sensor   → <id>        : 0|1 magnet (south pole) at the sensor face
//   bmp280        → <id>:temp   : °C          <id>:alt : altitude in metres
//   accelerometer → <id>:roll, <id>:pitch : board tilt in degrees (manual)
//   gyroscope     → <id>:gx, <id>:gy, <id>:gz : rotation rate °/s (manual)
//
// Output polarities follow the REAL modules, so sketches copied from the web
// work unchanged:
//   PIR HC-SR501   OUT HIGH while motion is seen (held ~3 s)
//   Flame (LM393)  DO  LOW when a flame is seen · AO falls as the flame grows
//   YL-69 / YL-38  DO  LOW when the soil is wet · AO ≈1023 dry → ≈250 soaked
//   FC-37 rain     DO  LOW when wet            · AO ≈1023 dry → ≈200 soaked
//   KY-038 sound   DO  HIGH on a loud sound    · AO ≈512 idle, swings with sound
//   TTP223 touch   OUT HIGH while touched
//   A3144 (KY-003) OUT LOW when a magnet is near (open collector + pull-up)
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_DEFAULTS = {
  pir_sensor: 0, flame_sensor: 0, soil_moisture: 30, rain_sensor: 0,
  sound_sensor: 10, touch_sensor: 0, hall_sensor: 0,
}
// Comparator thresholds (the module's trim-pot at its factory mid position).
const THRESHOLD = { flame_sensor: 50, soil_moisture: 40, rain_sensor: 30, sound_sensor: 50 }

/** Types read through readModuleAnalog / readModuleDigital. */
export const MODULE_SENSOR_TYPES = new Set(Object.keys(MODULE_DEFAULTS))

/** The physical quantity (panel units) for a module sensor; null if disconnected. */
// ── HC-SR04 ultrasonic / IR obstacle / MQ gas rules (used by SimulationManager) ──
/** Distance (cm) an HC-SR04 reports for a scene distance in units (1 unit = 5 cm); no echo → 400 cm (its max range). */
export function ultrasonicCm(units) { return units == null ? 400 : Math.min(400, Math.round(units * 5)) }
/** Echo pulse width (µs) for a distance in cm: the sound's round trip, 1 cm ≈ 58 µs. */
export function ultrasonicEchoUs(cm) { return Math.round(cm * 58) }
/** IR obstacle module: detects anything within 30 cm. */
export function irDetects(units) { return units != null && Math.round(units * 5) <= 30 ? 1 : 0 }
/** MQ-2 module DO: its comparator trips above mid-scale (raw > 512). */
export function gasDigital(raw) { return raw > 512 ? 1 : 0 }

export function moduleLevel(store, type, id) {
  if (id == null) return null
  const m = num(valueAt(store, id))
  const v = m ?? MODULE_DEFAULTS[type] ?? 0
  if (type === 'pir_sensor' || type === 'touch_sensor' || type === 'hall_sensor') return v ? 1 : 0
  return clamp(v, 0, 100)
}

/** 10-bit raw analog value the module puts on its AO pin (0…1023). */
export function moduleAnalogRaw(type, level, t = 0) {
  if (level == null) return 0                                        // unpowered: AO floats low
  switch (type) {
    case 'flame_sensor':  return clamp(Math.round(1015 - level * 9.6), 0, 1023)
    case 'soil_moisture': return clamp(Math.round(1015 - level * 7.65), 0, 1023)
    case 'rain_sensor':   return clamp(Math.round(1018 - level * 8.2), 0, 1023)
    case 'sound_sensor': {
      // Electret mic biased to mid-rail; the waveform swings around ~512 and
      // a sketch sampling it sees varying peaks (like the real KY-038 AO).
      const swing = (level / 100) * 500 * (0.55 + 0.45 * Math.abs(Math.sin(t * 0.0137 + level)))
      const sign = Math.sin(t * 0.091) >= 0 ? 1 : -1
      return clamp(Math.round(512 + sign * swing + (Math.random() - 0.5) * 6), 0, 1023)
    }
    default: return 0
  }
}

/** Digital level (0|1) on the module's DO / OUT pin — the real module's polarity. */
export function moduleDigital(type, level) {
  if (level == null) return 0
  switch (type) {
    case 'pir_sensor':    return level ? 1 : 0
    case 'touch_sensor':  return level ? 1 : 0
    case 'hall_sensor':   return level ? 0 : 1                       // pulled up, LOW on magnet
    case 'flame_sensor':  return level >= THRESHOLD.flame_sensor ? 0 : 1
    case 'soil_moisture': return level >= THRESHOLD.soil_moisture ? 0 : 1
    case 'rain_sensor':   return level >= THRESHOLD.rain_sensor ? 0 : 1
    case 'sound_sensor':  return level >= THRESHOLD.sound_sensor ? 1 : 0
    default: return 0
  }
}

/** True when the module's on-board "signal" LED is lit (it follows the comparator). */
export function moduleTriggered(type, level) {
  if (level == null) return false
  if (type === 'pir_sensor' || type === 'touch_sensor' || type === 'hall_sensor') return !!level
  return level >= (THRESHOLD[type] ?? 50)
}

// ── BMP280 ────────────────────────────────────────────────────────────────────
const SEA_LEVEL_PA = 101325
/** Pressure (Pa) at an altitude (m) — the standard barometric formula. */
export function pressureAtAltitude(m) {
  return SEA_LEVEL_PA * Math.pow(Math.max(0, 1 - m / 44330), 5.255)
}
/** { temp °C, pressure Pa } for a BMP280; extraAltM = scene height when auto. */
export function readBMP280(store, id, extraAltM = 0) {
  if (id == null) return null
  const temp = num(valueAt(store, `${id}:temp`)) ?? DEFAULTS.tempC
  const alt  = (num(valueAt(store, `${id}:alt`)) ?? 0) + (Number(extraAltM) || 0)
  // Real BMP280: ±0.01 °C, ±0.12 hPa resolution noise.
  return {
    temp: Math.round((temp + (Math.random() - 0.5) * 0.02) * 100) / 100,
    pressure: Math.round((pressureAtAltitude(alt) + (Math.random() - 0.5) * 2.4) * 100) / 100,
  }
}

// ── MPU6050 ───────────────────────────────────────────────────────────────────
/** Acceleration (g, chip axes) of a board tilted by roll/pitch (degrees), at rest. */
export function accelFromTilt(rollDeg, pitchDeg) {
  const r = (Number(rollDeg) || 0) * Math.PI / 180, p = (Number(pitchDeg) || 0) * Math.PI / 180
  return { x: -Math.sin(p), y: Math.sin(r) * Math.cos(p), z: Math.cos(r) * Math.cos(p) }
}
/**
 * MPU6050 reading in MANUAL mode: accelerometer parts take their tilt sliders,
 * gyroscope parts their rate sliders. `motion` (auto mode) overrides both with
 * the part's real movement in the scene.
 */
export function readMPU6050(store, id, type, motion = null) {
  if (id == null) return null
  let a, g
  if (motion) { a = motion.accel; g = motion.gyro }
  else {
    a = type === 'accelerometer'
      ? accelFromTilt(valueAt(store, `${id}:roll`), valueAt(store, `${id}:pitch`))
      : { x: 0, y: 0, z: 1 }
    g = type === 'gyroscope'
      ? { x: num(valueAt(store, `${id}:gx`)) ?? 0, y: num(valueAt(store, `${id}:gy`)) ?? 0, z: num(valueAt(store, `${id}:gz`)) ?? 0 }
      : { x: 0, y: 0, z: 0 }
  }
  const n = (s) => (Math.random() - 0.5) * s
  return {
    ax: a.x + n(0.006), ay: a.y + n(0.006), az: a.z + n(0.006),        // g  (±2 g range noise)
    gx: g.x + n(0.1),   gy: g.y + n(0.1),   gz: g.z + n(0.1),          // °/s (±250 °/s range noise)
    temp: Math.round((DEFAULTS.tempC + 3 + n(0.1)) * 100) / 100,       // die runs a few °C warm
  }
}
