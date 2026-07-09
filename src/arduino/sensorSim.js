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
