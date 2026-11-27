import * as THREE from 'three'
import { GRIP, fingerRoot } from './gripper.js'
import { cloneModel, findRotorNode, detectRotorAxis, findEmissiveMeshes } from './modelLoader.js'
import { ESP32_PINS } from './esp32Board.js'
import { onPartsRegistered, partPinDefs3D } from '../parts/registry.js'

// ─── shared material helper ───────────────────────────────────────────────────
const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...opts })

// ─── Pin definitions (local-space positions) ─────────────────────────────────
// type: 'pwm' | 'digital' | 'analog' | 'gnd' | 'power'
// Positions are tuned to match the scaled GLB / procedural models

// Uno R3 header layout as fractions along the board's long edge (0 = USB end).
// Digital row (top edge): D13 … D0 run away from the USB end, after GND/SDA/SCL.
// Bottom edge: power header (3V3 5V GND GND VIN) then analog A0 … A5.
const UNO_PWM = new Set([3, 5, 6, 9, 10, 11])
export const UNO_LAYOUT = [
  ...['SCL', 'SDA', 'GND3'].map((name, i) => ({ name, row: 'dig', t: 0.24 + i * 0.037 })),
  ...Array.from({ length: 14 }, (_, k) => 13 - k).map((n, k) => ({ name: `D${n}`, row: 'dig', t: 0.36 + k * 0.037 + (n <= 7 ? 0.035 : 0) })),
  ...['3V3', '5V', 'GND1', 'GND2', 'VIN'].map((name, i) => ({ name, row: 'pwr', t: 0.37 + i * 0.037 })),
  ...['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map((name, i) => ({ name, row: 'pwr', t: 0.6 + i * 0.037 })),
]
export function unoPinStyle(name) {
  const d = name.match(/^D(\d+)$/)
  if (d) { const n = +d[1]; return UNO_PWM.has(n) ? { color: 0xff8800, type: 'pwm', label: `~${n}` } : { color: 0xffcc00, type: 'digital', label: `${n}` } }
  if (/^A\d$/.test(name)) return { color: 0x22cc88, type: 'analog', label: name }
  if (name === '5V' || name === '3V3' || name === 'VIN') return { color: 0xff2222, type: 'power', label: name }
  if (name.startsWith('GND')) return { color: 0x333333, type: 'gnd', label: 'GND' }
  if (name === 'SDA') return { color: 0x22c55e, type: 'digital', label: 'SDA' }
  return { color: 0x3b82f6, type: 'digital', label: 'SCL' }
}
// Static fallback (procedural board, 6.86 × 5.34 cm): long axis X, top edge +Z.
export const ARDUINO_PINS = Object.fromEntries(UNO_LAYOUT.map(({ name, row, t }, i) => [name, {
  x: -3.43 + 6.86 * t, y: 0.62, z: row === 'dig' ? 2.5 : -2.5, r: 0.1, ...unoPinStyle(name), ldy: i % 2 ? 0.3 : 0,
}]))

export const MOTOR_PINS = {
  TERM_A: { x: -2.55, y: -0.25, z: 0, color: 0xff2222, type: 'power', label: '+' },
  TERM_B: { x: -2.55, y:  0.25, z: 0, color: 0x111111, type: 'gnd',   label: '−' },
}

export const LED_PINS = {
  ANODE:   { x: 0,  y: -0.55, z:  0.12, color: 0xff2222, type: 'power', label: '+' },
  CATHODE: { x: 0,  y: -0.55, z: -0.12, color: 0x333333, type: 'gnd',   label: '−' },
}

export const SERVO_PINS = {
  SIGNAL:  { x: -2.2, y: 0.4, z:  0.4, color: 0xff8800, type: 'pwm',   label: 'SIG' },
  VCC:     { x: -2.2, y: 0.4, z:  0,   color: 0xff2222, type: 'power', label: 'VCC' },
  GND:     { x: -2.2, y: 0.4, z: -0.4, color: 0x222222, type: 'gnd',   label: 'GND' },
}

// ─── Sensors & extra outputs ──────────────────────────────────────────────────
// Static pin layouts (used since these GLBs don't auto-compute dynamic pins).
// Pins sit in a small fanned row near the model so they're easy to click + wire.
export const IR_PINS = {
  OUT: { x:  0.7, y: -0.1, z: 1.2, color: 0xffcc00, type: 'digital', label: 'OUT' },
  GND: { x:  0.0, y: -0.1, z: 1.2, color: 0x333333, type: 'gnd',     label: 'GND' },
  VCC: { x: -0.7, y: -0.1, z: 1.2, color: 0xff2222, type: 'power',   label: 'VCC' },
}
export const ULTRASONIC_PINS = {
  VCC:  { x: -1.2, y: -0.2, z: 1.3, color: 0xff2222, type: 'power',   label: 'VCC'  },
  TRIG: { x: -0.4, y: -0.2, z: 1.3, color: 0xff8800, type: 'pwm',     label: 'TRIG' },
  ECHO: { x:  0.4, y: -0.2, z: 1.3, color: 0xffcc00, type: 'digital', label: 'ECHO' },
  GND:  { x:  1.2, y: -0.2, z: 1.3, color: 0x333333, type: 'gnd',     label: 'GND'  },
}
export const BUZZER_PINS = {
  SIGNAL: { x:  0.4, y: -0.1, z: 0.9, color: 0xff8800, type: 'pwm', label: 'I/O' },
  GND:    { x: -0.4, y: -0.1, z: 0.9, color: 0x333333, type: 'gnd', label: 'GND' },
}
export const OLED_PINS = {
  GND: { x: -1.2, y: -0.1, z: 1.1, color: 0x333333, type: 'gnd',     label: 'GND' },
  VCC: { x: -0.4, y: -0.1, z: 1.1, color: 0xff2222, type: 'power',   label: 'VCC' },
  SCL: { x:  0.4, y: -0.1, z: 1.1, color: 0x66aaff, type: 'digital', label: 'SCL' },
  SDA: { x:  1.2, y: -0.1, z: 1.1, color: 0x66aaff, type: 'digital', label: 'SDA' },
}
export const GAS_PINS = {
  VCC: { x: -1.2, y: -0.1, z: 1.2, color: 0xff2222, type: 'power',   label: 'VCC' },
  GND: { x: -0.4, y: -0.1, z: 1.2, color: 0x333333, type: 'gnd',     label: 'GND' },
  DO:  { x:  0.4, y: -0.1, z: 1.2, color: 0xffcc00, type: 'digital', label: 'DO'  },
  AO:  { x:  1.2, y: -0.1, z: 1.2, color: 0x22cc88, type: 'analog',  label: 'AO'  },
}
// TCS3200 colour sensor — VCC/GND + S0/S1 (freq scale), S2/S3 (filter), OUT.
export const COLOR_PINS = {
  VCC: { x: -1.8, y: -0.1, z: 1.2, color: 0xff2222, type: 'power',   label: 'VCC' },
  GND: { x: -1.2, y: -0.1, z: 1.2, color: 0x333333, type: 'gnd',     label: 'GND' },
  S0:  { x: -0.6, y: -0.1, z: 1.2, color: 0xff8800, type: 'digital', label: 'S0'  },
  S1:  { x:  0.0, y: -0.1, z: 1.2, color: 0xff8800, type: 'digital', label: 'S1'  },
  S2:  { x:  0.6, y: -0.1, z: 1.2, color: 0x66aaff, type: 'digital', label: 'S2'  },
  S3:  { x:  1.2, y: -0.1, z: 1.2, color: 0x66aaff, type: 'digital', label: 'S3'  },
  OUT: { x:  1.8, y: -0.1, z: 1.2, color: 0xffcc00, type: 'digital', label: 'OUT' },
}
// LDR (photoresistor) module — analog + digital-threshold outputs.
export const LDR_PINS = {
  VCC: { x: -1.05, y: -0.1, z: 1.0, color: 0xff2222, type: 'power',   label: 'VCC' },
  GND: { x: -0.35, y: -0.1, z: 1.0, color: 0x333333, type: 'gnd',     label: 'GND' },
  AO:  { x:  0.35, y: -0.1, z: 1.0, color: 0x22cc88, type: 'analog',  label: 'AO'  },
  DO:  { x:  1.05, y: -0.1, z: 1.0, color: 0xffcc00, type: 'digital', label: 'DO'  },
}
// DHT11 temperature + humidity — single one-wire DATA line.
export const DHT11_PINS = {
  VCC:  { x: -0.7, y: -0.1, z: 1.0, color: 0xff2222, type: 'power',   label: 'VCC'  },
  GND:  { x:  0.0, y: -0.1, z: 1.0, color: 0x333333, type: 'gnd',     label: 'GND'  },
  DATA: { x:  0.7, y: -0.1, z: 1.0, color: 0xffcc00, type: 'digital', label: 'DATA' },
}

// ─── Module sensors (procedural models, real module sizes — 1 unit = 1 cm) ───
// PIR · flame · soil moisture · rain · sound · touch · BMP280 · MPU6050 (as the
// accelerometer and the gyroscope parts) · Hall. Each pin sphere sits on the tip
// of its real 2.54 mm-pitch header pin (createModuleSensor builds the header
// from the same layout), with labels staggered over two rows like the L298N.
const MS_TOP = 0.08                       // PCB top face (1.6 mm board centred on y = 0)
const MS_PITCH = 0.254
const MS_PIN_STYLE = {
  VCC: [0xff2222, 'power'], GND: [0x333333, 'gnd'],
  DO: [0xffcc00, 'digital'], OUT: [0xffcc00, 'digital'], AO: [0x22cc88, 'analog'],
  SCL: [0x3b82f6, 'digital'], SDA: [0x22c55e, 'digital'],
}
const MS_PIN_LABEL = { OUT: 'OUT' }
// names → { [name]: pinDef } for a right-angle header whose pins point out of
// the +Z board edge (style 'out') or straight down under the board ('down').
function moduleHeaderPins(names, { z, cx = 0, style = 'out' }) {
  const x0 = cx - ((names.length - 1) * MS_PITCH) / 2
  return Object.fromEntries(names.map((name, i) => {
    const [color, type] = MS_PIN_STYLE[name] ?? [0xa855f7, 'digital']
    const pos = style === 'down'
      ? { x: x0 + i * MS_PITCH, y: -0.66, z }
      : { x: x0 + i * MS_PITCH, y: MS_TOP + 0.125, z: z + 0.58 }
    return [name, { ...pos, r: 0.1, color, type, label: MS_PIN_LABEL[name] ?? name, ldy: i % 2 ? 0.3 : 0 }]
  }))
}
// Board outlines + header placement, shared by the pin tables and the models.
export const MODULE_SENSOR_LAYOUT = {
  pir_sensor:    { w: 3.2, d: 2.4,  pins: ['VCC', 'OUT', 'GND'],      hdrZ: 1.02, style: 'down' },
  flame_sensor:  { w: 1.5, d: 3.2,  pins: ['VCC', 'GND', 'DO', 'AO'], hdrZ: 1.6 },
  // Probe boards (soil fork / rain plate) + the YL-38 comparator they plug into:
  // the comparator is centred at `compZ`, its 4-pin header at its +Z end.
  soil_moisture: { w: 1.6, d: 3.0,  pins: ['VCC', 'GND', 'DO', 'AO'], hdrZ: 5.3, compZ: 3.8 },
  rain_sensor:   { w: 1.6, d: 3.0,  pins: ['VCC', 'GND', 'DO', 'AO'], hdrZ: 4.85, compZ: 3.35 },
  sound_sensor:  { w: 1.5, d: 3.5,  pins: ['AO', 'GND', 'VCC', 'DO'], hdrZ: 1.75 },
  touch_sensor:  { w: 1.1, d: 1.5,  pins: ['GND', 'OUT', 'VCC'],      hdrZ: 0.75 },
  bmp280:        { w: 1.5, d: 1.15, pins: ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'], hdrZ: 0.575 },
  accelerometer: { w: 2.1, d: 1.6,  pins: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], hdrZ: 0.8 },
  gyroscope:     { w: 2.1, d: 1.6,  pins: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], hdrZ: 0.8 },
  hall_sensor:   { w: 1.5, d: 1.85, pins: ['GND', 'VCC', 'OUT'],      hdrZ: 0.925 },
}
const msPins = (type) => {
  const L = MODULE_SENSOR_LAYOUT[type]
  return moduleHeaderPins(L.pins, { z: L.hdrZ, style: L.style })
}
export const PIR_PINS    = msPins('pir_sensor')
export const FLAME_PINS  = msPins('flame_sensor')
export const SOIL_PINS   = msPins('soil_moisture')
export const RAIN_PINS   = msPins('rain_sensor')
export const SOUND_PINS  = msPins('sound_sensor')
export const TOUCH_PINS  = msPins('touch_sensor')
export const BMP280_PINS = msPins('bmp280')
export const MPU6050_PINS = msPins('accelerometer')
export const HALL_PINS   = msPins('hall_sensor')

// SUBO board (custom ESP32-S3). Pin names + GPIO map come STRAIGHT from the official Subo
// library (Subo.h): the header exposes IO1..IO21 (the exact silk labels), plus 5V and GND.
// The simulator resolves IOn → GPIO via pinNameToNumber (SUBO_IO_TO_GPIO). ADC-capable IOs
// (per Subo.h //ADC comments) render blue, plain-GPIO IOs green; 5V = red, GND = black.
// MotorExpansion drives Motor 1 on IO20/IO21 and Motor 2 on IO19/IO18 — those pins are part
// of this same IO1..IO21 header, so a DC motor wired to them is driven by runMotor().
const SUBO_ADC = new Set(['IO1', 'IO5', 'IO8', 'IO11', 'IO12', 'IO17', 'IO19', 'IO20', 'IO21'])
const suboPinStyle = (io) => SUBO_ADC.has(io)
  ? { color: 0x3b82f6, type: 'analog' }    // ADC → Blue (Analog)
  : { color: 0x22cc55, type: 'digital' }   // GPIO → Green (Digital)

// The official Subo header (silk order): G · 5V · IO4 … IO21 · G, plus IO1–IO3.
export const SUBO_HEADER_A = ['GND1', '5V', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO11', 'IO12', 'IO13', 'IO14', 'IO15', 'IO16', 'IO17', 'IO18', 'IO19', 'IO20', 'IO21', 'GND2']
export const SUBO_HEADER_B = ['IO1', 'IO2', 'IO3']
// Wiring-panel order — the full official IO header, IO1..IO21 ascending, then the power rails.
export const SUBO_PIN_ORDER = [...Array.from({ length: 21 }, (_, i) => `IO${i + 1}`), '5V', 'GND1', 'GND2']
const suboPinDef = (name) => name.startsWith('IO')
  ? suboPinStyle(name)
  : name === '5V' ? { color: 0xff2222, type: 'power' } : { color: 0x111111, type: 'gnd' }
const suboPinLabel = (name) => name.startsWith('IO') ? name : name === '5V' ? '5V' : 'GND'

// SUBO connector spheres — smaller than the 0.17 default (per-pin `r`, honoured by
// addPinSpheresToGroup) so the dense IO header stays clean.
const SUBO_PIN_R = 0.11

// Lay the official IO header in two rows on the "bottom" of the board (Row A = the main
// 21-pin header, Row B = IO1–IO3), matching the physical silk. Center-anchored with
// ABSOLUTE-capped spacing so it stays compact on the board at any GLB size.
function placeSuboHeaders(pins, geo) {
  const { A, B, thinAxis, aCtr, bCtr, aSpan, bSpan, above } = geo
  const belowOff = Math.min(aSpan * 0.28, 1.8)     // header sits below the LED matrix (−A)
  const rowGap   = Math.min(aSpan * 0.10, 0.5)     // gap between the two header rows
  const place = (names, aRow) => {
    const span = Math.min(bSpan * 0.85, Math.max(names.length - 1, 1) * 0.32)   // capped row width
    const gap  = names.length > 1 ? span / (names.length - 1) : 0
    names.forEach((name, i) => {
      const pos = { x: 0, y: 0, z: 0 }
      pos[B] = bCtr - span / 2 + i * gap
      pos[A] = aCtr - belowOff + aRow
      pos[thinAxis] = above
      pins[name] = { ...pos, r: SUBO_PIN_R, ...suboPinDef(name), label: suboPinLabel(name) }
    })
  }
  place(SUBO_HEADER_A, +rowGap)   // main 21-pin header (rear row)
  place(SUBO_HEADER_B, -rowGap)   // IO1 · IO2 · IO3 (front row)
}

// Static fallback layout (only used if the GLB is missing; the GLB path auto-places the
// headers over the real board via buildSuboFromGLB → placeSuboHeaders).
export const SUBO_PINS = (() => {
  const pins = {}
  placeSuboHeaders(pins, { A: 'z', B: 'x', thinAxis: 'y', aCtr: 0, bCtr: 0, aSpan: 4.0, bSpan: 5.6, above: 0.18 })
  return pins
})()

// L298N dual motor driver (~4.3 units square like the real 43 mm module).
// Positions match the GLB (tools/models/l298n.model.js, L298N_LAYOUT): motor
// outputs at the wire entries of the side screw terminals (5 mm pitch), power
// at the front terminal, the 6 logic inputs on the 2.54 mm header tips (small
// spheres, labels staggered over two rows so they don't overlap).
const L298N_HDR = ['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB']
export const L298N_PINS = {
  OUT1:  { x: -2.3, y: 0.38, z: -0.25, color: 0xffcc00, type: 'power', label: 'OUT1' },
  OUT2:  { x: -2.3, y: 0.38, z:  0.25, color: 0xffcc00, type: 'power', label: 'OUT2' },
  OUT3:  { x:  2.3, y: 0.38, z:  0.25, color: 0xffcc00, type: 'power', label: 'OUT3' },
  OUT4:  { x:  2.3, y: 0.38, z: -0.25, color: 0xffcc00, type: 'power', label: 'OUT4' },
  '12V': { x: -1.55, y: 0.38, z: 2.3, color: 0xff2222, type: 'power', label: '12V' },
  GND:   { x: -1.05, y: 0.38, z: 2.3, color: 0x333333, type: 'gnd',   label: 'GND' },
  '5V':  { x: -0.55, y: 0.38, z: 2.3, color: 0xff6666, type: 'power', label: '5V'  },
  ...Object.fromEntries(L298N_HDR.map((name, i) => [name, {
    x: 0.35 + i * 0.254, y: 1.0, z: 1.85, r: 0.1,
    color: name.startsWith('EN') ? 0x22cc88 : 0xff8800, type: name.startsWith('EN') ? 'pwm' : 'digital',
    label: name, ldy: i % 2 ? 0.32 : 0,
  }])),
}

// 28BYJ-48 stepper: its five wires end in a JST plug — one pin per wire at the
// plug face (tools/models/stepper.model.js, STEPPER_LAYOUT.plug). Colours are
// the real wire colours, so the 3D pins read like the actual cable.
const STEPPER_WIRE_HEX = { BLUE: 0x2563eb, PINK: 0xec4899, YELLOW: 0xeab308, ORANGE: 0xf97316, RED: 0xdc2626 }
export const STEPPER_PINS = Object.fromEntries(Object.entries(STEPPER_WIRE_HEX).map(([name, color], i) => [name, {
  x: -0.5 + i * 0.25, y: 0.3, z: -4.3, r: 0.1, color, type: name === 'RED' ? 'power' : 'digital',
  label: name, ldy: i % 2 ? 0.3 : 0,
}]))

// ULN2003 board (tools/models/uln2003.model.js, ULN2003_LAYOUT): IN1–IN4 and
// − + on the front header tips; OUT1–OUT4 + COM over the motor socket pins.
export const ULN2003_PINS = {
  ...Object.fromEntries(['IN1', 'IN2', 'IN3', 'IN4'].map((name, i) => [name, {
    x: -1.45 + i * 0.254, y: 1.0, z: 1.35, r: 0.1, color: 0xff8800, type: 'digital', label: name, ldy: i % 2 ? 0.3 : 0,
  }])),
  GND: { x: 0.25,  y: 1.0, z: 1.35, r: 0.1, color: 0x333333, type: 'gnd',   label: 'GND' },
  VCC: { x: 0.504, y: 1.0, z: 1.35, r: 0.1, color: 0xff2222, type: 'power', label: 'VCC', ldy: 0.3 },
  ...Object.fromEntries(['OUT1', 'OUT2', 'OUT3', 'OUT4', 'COM'].map((name, i) => [name, {
    x: -0.8 + i * 0.25, y: 0.95, z: -1.15, r: 0.1,
    color: name === 'COM' ? 0xff2222 : 0xffcc00, type: 'power', label: name, ldy: i % 2 ? 0.3 : 0,
  }])),
}

// TT motor + Hall encoder: one 6-pin header on the encoder board at the back of
// the motor (createEncoderMotorGroup), in the real order M1 GND C1 C2 VCC M2.
// Motor power moves to M1/M2 on this header (it is routed through the board).
const ENC_HDR = [['TERM_A', 'M1', 0xff2222, 'power'], ['GND', 'GND', 0x333333, 'gnd'], ['ENC_A', 'A', 0x22c55e, 'digital'],
  ['ENC_B', 'B', 0x3b82f6, 'digital'], ['VCC', 'VCC', 0xff6666, 'power'], ['TERM_B', 'M2', 0x111111, 'gnd']]
export const ENC_MOTOR_PINS = Object.fromEntries(ENC_HDR.map(([name, label, color, type], i) => [name, {
  x: -2.62, y: 1.02, z: -0.635 + i * 0.254, r: 0.09, color, type, label, ldy: i % 2 ? 0.3 : 0,
}]))

// PCA9685 (tools/models/pca9685.model.js, PCA9685_LAYOUT): the 6-pin header on
// the left end, and each channel's PWM pin (the yellow row) along the front.
// Servo V+ / GND go to the header's V+ / GND (on the board they are the same
// rails as each channel's red and black pins).
const PCA_HDR = [['GND', 0x333333, 'gnd'], ['OE', 0xa855f7, 'digital'], ['SCL', 0x3b82f6, 'digital'],
  ['SDA', 0x22c55e, 'digital'], ['VCC', 0xff2222, 'power'], ['V+', 0xff6a00, 'power']]
const pcaChannelX = (ch) => -2.2 + ch * 0.254 + Math.floor(ch / 4) * 0.33
export const PCA9685_PINS = {
  ...Object.fromEntries(PCA_HDR.map(([name, color, type], i) => [name, {
    x: -2.86, y: 1.0, z: -0.635 + i * 0.254, r: 0.09, color, type, label: name, ldx: -0.45,
  }])),
  ...Object.fromEntries(Array.from({ length: 16 }, (_, ch) => [`PWM${ch}`, {
    x: pcaChannelX(ch), y: 1.0, z: 0.42, r: 0.085, color: 0xffcc00, type: 'pwm', label: String(ch), ldy: ch % 2 ? 0.28 : 0,
  }])),
}

// Servo gripper (createGripperGroup): its servo's 3-wire lead ends in a
// connector behind the claw — the same SIGNAL / VCC / GND as a servo.
export const GRIPPER_PINS = {
  GND:    { x: -0.704, y: 1.55, z: -2.95, r: 0.09, color: 0x8b5a2b, type: 'gnd',   label: 'GND' },
  VCC:    { x: -0.45,  y: 1.55, z: -2.95, r: 0.09, color: 0xff2222, type: 'power', label: 'VCC', ldy: 0.3 },
  SIGNAL: { x: -0.196, y: 1.55, z: -2.95, r: 0.09, color: 0xff8800, type: 'pwm',   label: 'SIG' },
}

export const PIN_DEFS = {
  gripper:  GRIPPER_PINS,
  pca9685:  PCA9685_PINS,
  l298n:    L298N_PINS,
  motor_enc: ENC_MOTOR_PINS,
  stepper:  STEPPER_PINS,
  uln2003:  ULN2003_PINS,
  arduino:  ARDUINO_PINS,
  subo:     SUBO_PINS,
  motor:    MOTOR_PINS,
  motor_bo: MOTOR_PINS,
  motor_dc: MOTOR_PINS,
  led:      LED_PINS,
  servo:    SERVO_PINS,
  servo_cr: SERVO_PINS,     // continuous servo: same 3-wire lead as a servo
  ir_sensor:  IR_PINS,
  ultrasonic: ULTRASONIC_PINS,
  buzzer:     BUZZER_PINS,
  oled:       OLED_PINS,
  gas_sensor: GAS_PINS,
  color_sensor: COLOR_PINS,
  ldr_sensor:   LDR_PINS,
  dht11:        DHT11_PINS,
  pir_sensor:    PIR_PINS,
  flame_sensor:  FLAME_PINS,
  soil_moisture: SOIL_PINS,
  rain_sensor:   RAIN_PINS,
  sound_sensor:  SOUND_PINS,
  touch_sensor:  TOUCH_PINS,
  bmp280:        BMP280_PINS,
  accelerometer: MPU6050_PINS,
  gyroscope:     MPU6050_PINS,
  hall_sensor:   HALL_PINS,
}

// Catalogue parts (src/parts) bring their own 3D pin tables.
onPartsRegistered((p) => { PIN_DEFS[p.type] = partPinDefs3D(p.type) })

const PIN_SPHERE_R = 0.17

// Label offset: above pin for Arduino, to the left for motor/led terminals
const LABEL_OFFSET = {
  arduino:  { dx: 0, dy: 0.55, dz: 0 },
  motor:    { dx: -0.85, dy: 0, dz: 0 },
  motor_bo: { dx: -0.85, dy: 0, dz: 0 },
  motor_enc: { dx: 0, dy: 0.42, dz: 0 },
  motor_dc: { dx: -0.85, dy: 0, dz: 0 },
  led:      { dx: -0.6,  dy: 0, dz: 0 },
  servo:    { dx: -0.85, dy: 0, dz: 0 },
  servo_cr: { dx: -0.85, dy: 0, dz: 0 },
  gripper:  { dx: 0, dy: 0.35, dz: 0 },
}

// Create a canvas-texture sprite label for a pin
function createPinLabelSprite(text, color) {
  const W = 128, H = 30, S = 2
  // No DOM / no 2D canvas (headless tests, a locked-down WebView): a blank label
  // keeps the pin itself working instead of throwing.
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = canvas?.getContext?.('2d')
  if (!ctx) return new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0 }))
  canvas.width  = W * S
  canvas.height = H * S

  ctx.fillStyle = 'rgba(5, 5, 18, 0.82)'
  const r = 7 * S, w = W * S, h = H * S
  ctx.beginPath()
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r)
  ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r)
  ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r)
  ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath(); ctx.fill()

  const tc = new THREE.Color(color)
  const brightness = tc.r * 0.299 + tc.g * 0.587 + tc.b * 0.114
  ctx.fillStyle = brightness < 0.25 ? '#aaaacc' : '#' + tc.getHexString()
  ctx.font = `bold ${11 * S}px "Courier New", monospace`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2)

  const tex = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, opacity: 0.65, depthWrite: false, sizeAttenuation: true,
  }))
  sprite.scale.set(1.05, 0.25, 1)
  sprite.userData.isPinLabel = true
  return sprite
}

export function addPinSpheresToGroup(group, componentId, type) {
  // GLB-loaded Arduino has dynamic pins computed from its actual geometry
  const defs = (group.userData.dynamicPins) ? group.userData.dynamicPins : PIN_DEFS[type]
  if (!defs) return
  const offset = group.userData.labelOffset ?? LABEL_OFFSET[type] ?? { dx: 0, dy: 0.55, dz: 0 }

  for (const [pinName, def] of Object.entries(defs)) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(def.r ?? PIN_SPHERE_R, 12, 12),
      new THREE.MeshStandardMaterial({
        color: def.color, emissive: new THREE.Color(0x000000),
        roughness: 0.3, metalness: 0.4,
        transparent: true, opacity: 0.55, depthWrite: false,
      })
    )
    sphere.position.set(def.x, def.y, def.z)
    sphere.userData.isPinSphere   = true
    sphere.userData.pinId         = `${componentId}:${pinName}`
    sphere.userData.rootId        = componentId
    sphere.userData.componentId   = componentId
    sphere.userData.pinName       = pinName
    sphere.userData.pinType       = def.type
    sphere.userData.pinLabel      = def.label
    sphere.userData.pinColor      = def.color
    group.add(sphere)
    // Dense grids (breadboard holes) skip the per-pin label sprite: hundreds of
    // canvas textures would cost far more than they help.
    if (def.noLabel) continue

    const label = createPinLabelSprite(def.label, def.color)
    // Optional per-component label shrink (dense boards like SUBO) so labels never overlap.
    const ls = group.userData.labelScale
    if (ls) { label.scale.x *= ls; label.scale.y *= ls }
    // def.ldy: per-pin extra label lift — lets a dense header stagger its labels
    // over two rows instead of overlapping (L298N control header).
    label.position.set(def.x + offset.dx + (def.ldx ?? 0), def.y + offset.dy + (def.ldy ?? 0), def.z + offset.dz)
    label.userData.isPinLabel = true
    label.userData.pinId      = `${componentId}:${pinName}`
    label.userData.rootId     = componentId
    group.add(label)
  }
}

// ─── Arduino Uno ─────────────────────────────────────────────────────────────

export function createArduinoGroup() {
  const glbScene = cloneModel('arduino')
  if (glbScene) return buildArduinoFromGLB(glbScene)
  return buildArduinoProcedural()
}

function buildArduinoFromGLB(scene) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })

  root.updateMatrixWorld(true)
  const box  = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())

  // Sort axes by dimension:
  //   thinAxis = board PCB thickness  (smallest)
  //   medAxis  = board width          (middle) — pin ROWS run parallel to this edge
  //   longAxis = board length         (largest) — pins are SPACED along this axis
  //
  // Arduino Uno pin layout:
  //   • Digital row  (D0-D13): one long edge  → medAxis = box.max[medAxis]
  //   • Power row (5V/GND):    other long edge → medAxis = box.min[medAxis]
  //   Both rows span the full board LENGTH (longAxis).
  const sorted = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])
  const thinAxis = sorted[0][0]
  const medAxis  = sorted[1][0]
  const longAxis = sorted[2][0]

  // Slightly above the top face of the board
  const above = box.max[thinAxis] + 0.32

  // Digital pin row sits at the MAX medAxis edge; power at MIN
  const digRow = box.max[medAxis] - 0.1
  const pwrRow = box.min[medAxis] + 0.1

  // Spread pins from ~12% to ~88% of the board's long dimension
  const longMin  = box.min[longAxis]
  const longSpan = size[longAxis]

  // Full Uno header (UNO_LAYOUT): digital row on the max-medAxis edge, power +
  // analog on the min edge, each at its real fraction of the board length.
  const pins = {}
  UNO_LAYOUT.forEach(({ name, row, t }, i) => {
    const p = { x: 0, y: 0, z: 0 }
    p[longAxis] = longMin + longSpan * t
    p[medAxis]  = row === 'dig' ? digRow : pwrRow
    p[thinAxis] = above
    pins[name] = { ...p, r: 0.1, ...unoPinStyle(name), ldy: i % 2 ? 0.3 : 0 }
  })

  root.userData.dynamicPins = pins

  // Labels float away from the board face (thinAxis direction)
  const lo = { dx: 0, dy: 0, dz: 0 }
  if (thinAxis === 'x') lo.dx = 0.55
  else if (thinAxis === 'z') lo.dz = 0.55
  else lo.dy = 0.55
  root.userData.labelOffset = lo

  return root
}

function buildArduinoProcedural() {
  const root = new THREE.Group()

  const board = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.22, 6.8), mat(0x006633, { roughness: 0.8 }))
  root.add(board)

  const silk = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.01, 6.2), mat(0xffffff, { roughness: 1, opacity: 0.12, transparent: true }))
  silk.position.y = 0.115
  root.add(silk)

  const chip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 1.4), mat(0x111111))
  chip.position.set(0.4, 0.2, 0.3)
  root.add(chip)

  const xtal = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 12), mat(0xccccaa, { metalness: 0.7 }))
  xtal.position.set(-0.7, 0.3, 0.3)
  root.add(xtal)

  const usb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), mat(0x999999, { metalness: 0.8, roughness: 0.2 }))
  usb.position.set(-1.2, 0.2, -3.4)
  root.add(usb)

  const dcJack = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.65, 16), mat(0x111111))
  dcJack.rotation.x = Math.PI / 2; dcJack.position.set(1.5, 0.22, -3.5)
  root.add(dcJack)

  const btn = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.28), mat(0x222222))
  btn.position.set(-2.2, 0.22, 1.5)
  root.add(btn)

  const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat(0x00ff44, { emissive: 0x00aa22, roughness: 0.3 }))
  led.position.set(1.8, 0.26, 2.3)
  root.add(led)

  const pinHeaderD = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.2, 0.3), mat(0x111111))
  pinHeaderD.position.set(0, 0.2, 3.1)
  root.add(pinHeaderD)
  for (let i = 0; i < 14; i++) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.45, 8), mat(0xcccccc, { metalness: 0.9 }))
    pin.position.set(-2.38 + i * 0.365, 0.38, 3.1)
    root.add(pin)
  }

  const pinHeaderP = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, 0.3), mat(0x111111))
  pinHeaderP.position.set(1.9, 0.2, -3.1)
  root.add(pinHeaderP)
  for (let i = 0; i < 6; i++) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.45, 8), mat(0xcccccc, { metalness: 0.9 }))
    pin.position.set(1.13 + i * 0.33, 0.38, -3.1)
    root.add(pin)
  }

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── SUBO board (custom ESP32) ───────────────────────────────────────────────

// ── ESP32 DevKit V1 ─────────────────────────────────────────────────────────
// Pins come from the ONE board table (utils/esp32Board.js) and are placed on the
// real GLB's two header edges, so the 3D board and the wiring UI can never drift
// apart. Same dynamic-placement approach as the Arduino board.
export function createEsp32Group() {
  const glbScene = cloneModel('esp32')
  if (!glbScene) return buildEsp32Procedural()

  const root = new THREE.Group()
  root.add(glbScene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  root.updateMatrixWorld(true)

  const box  = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  // thin = PCB thickness, med = board width (header rows sit on its two edges),
  // long = board length (pins are spaced along it).
  const sorted   = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])
  const thinAxis = sorted[0][0], medAxis = sorted[1][0], longAxis = sorted[2][0]
  const above    = box.max[thinAxis] + 0.3
  const rowFor   = (side) => (side === 'left' ? box.min[medAxis] + 0.1 : box.max[medAxis] - 0.1)
  const longMin  = box.min[longAxis], longSpan = size[longAxis]

  const COLOR = { power: 0xff2222, gnd: 0x333333, enable: 0x9b59b6, digital: 0xffcc00 }
  const perSide = Math.max(...ESP32_PINS.map(p => p.index)) + 1      // 15
  const pins = {}
  for (const p of ESP32_PINS) {
    const t = perSide > 1 ? p.index / (perSide - 1) : 0.5
    const pos = { x: 0, y: 0, z: 0 }
    pos[longAxis] = longMin + longSpan * (0.08 + t * 0.84)
    pos[medAxis]  = rowFor(p.side)
    pos[thinAxis] = above
    // ADC-capable GPIOs get the analog colour so the header reads at a glance.
    const color = p.kind !== 'digital' ? COLOR[p.kind]
      : p.adc ? 0x3aa3ff : (p.pwm ? 0xff8800 : COLOR.digital)
    pins[p.name] = {
      ...pos, color, label: p.label,
      type: p.kind === 'digital' ? (p.adc ? 'analog' : (p.pwm ? 'pwm' : 'digital')) : p.kind,
    }
  }
  root.userData.dynamicPins = pins
  root.userData.boardId = 'esp32'
  return root
}

// Fallback if the GLB is missing: a plain PCB slab so wiring still works.
function buildEsp32Procedural() {
  const root = new THREE.Group()
  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(5.1, 0.18, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x15503a, roughness: 0.8 }),
  )
  pcb.castShadow = pcb.receiveShadow = true
  root.add(pcb)
  const shield = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.22, 1.7),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.8, roughness: 0.35 }),
  )
  shield.position.set(-1.1, 0.2, 0)
  root.add(shield)
  const pins = {}
  const perSide = Math.max(...ESP32_PINS.map(p => p.index)) + 1
  for (const p of ESP32_PINS) {
    const t = perSide > 1 ? p.index / (perSide - 1) : 0.5
    pins[p.name] = {
      x: -2.1 + t * 4.2, y: 0.22, z: p.side === 'left' ? -1.15 : 1.15,
      color: p.kind === 'power' ? 0xff2222 : p.kind === 'gnd' ? 0x333333 : p.adc ? 0x3aa3ff : 0xffcc00,
      type: p.kind === 'digital' ? (p.adc ? 'analog' : 'digital') : p.kind,
      label: p.label,
    }
  }
  root.userData.dynamicPins = pins
  root.userData.boardId = 'esp32'
  return root
}

export function createSuboGroup() {
  const glbScene = cloneModel('subo')
  const root = glbScene ? buildSuboFromGLB(glbScene) : buildSuboProcedural()
  attachSuboMatrix(root)          // on-board 48-LED NeoPixel matrix
  return root
}

// HSV→RGB (0–255) helper for the matrix animations.
function _hsv(h, s, v) {
  h = (((h % 360) + 360) % 360) / 60
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c
  let r = 0, g = 0, b = 0
  if (h < 1) { r = c; g = x } else if (h < 2) { r = x; g = c } else if (h < 3) { g = c; b = x }
  else if (h < 4) { g = x; b = c } else if (h < 5) { r = x; b = c } else { r = c; b = x }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

// World-space bounding box of the actual SUBO board substrate.
// The SUBO GLB is a MIXED-UNIT hierarchy: several meshes are named *PCB* but only
// the board substrate spans the full footprint (~6.45 × 6.8 world units) while other
// /pcb/i sub-parts are tiny (down to ~0.3 units). Picking the *first* pcb mesh landed
// on one of those tiny parts, which clustered every pin at the board centre and shrank
// the LED-matrix panel to a speck. Pick the LARGEST pcb mesh (the real board) so pins
// and the matrix always span the true board footprint — robust to the unit mismatch.
function suboBoardBox(root) {
  root.updateMatrixWorld(true)
  const tmp = new THREE.Box3(), size = new THREE.Vector3()
  let best = null, bestDim = -1
  root.traverse(c => {
    if (!c.isMesh || !/pcb/i.test(c.name || '')) return
    tmp.setFromObject(c); tmp.getSize(size)
    const d = Math.max(size.x, size.y, size.z)
    if (d > bestDim) { bestDim = d; best = c }
  })
  const box = new THREE.Box3()
  return best ? box.setFromObject(best) : box.setFromObject(root)
}

// ─── SUBO on-board 48-LED NeoPixel matrix ────────────────────────────────────
// The LED matrix is the GLB's OWN geometry, rendered exactly as exported — we add
// NO procedural geometry here (no canvas panel, no PlaneGeometry). The matrix API
// instead drives the EMISSIVE of the GLB's LED material(s) so setAllLED / stripclear
// / playLEDSeq still light the real on-board LEDs. Exposes root.userData.suboMatrix
// { clear, all, one, seq }. If the GLB has no identifiable LED material the API is a
// safe no-op (simulation runtime still runs unchanged; only the glow is skipped).
function attachSuboMatrix(root) {
  const ledMats = new Set()
  root.traverse(c => {
    if (!c.isMesh || !c.material) return
    const mats = Array.isArray(c.material) ? c.material : [c.material]
    for (const m of mats) {
      if (m && m.emissive && /led|emiss|neopix|pixel|matrix/i.test(m.name || '')) ledMats.add(m)
    }
  })
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)))
  const setEmissive = (r, g, b) => {
    const on = (clamp(r) || clamp(g) || clamp(b))
    for (const m of ledMats) {
      m.emissive.setRGB(clamp(r) / 255, clamp(g) / 255, clamp(b) / 255)
      if ('emissiveIntensity' in m) m.emissiveIntensity = on ? 1.4 : 1
      m.needsUpdate = true
    }
  }
  // Merged single-mesh GLBs can't isolate one cell, so setSingleLED tints the matrix.
  root.userData.suboMatrix = {
    clear: () => setEmissive(0, 0, 0),
    all:   (r, g, b) => setEmissive(r, g, b),
    one:   (_n, r, g, b) => setEmissive(r, g, b),
    seq:   (id) => { const p = _hsv(((Math.round(id) || 1) * 53) % 360, 1, 1); setEmissive(p.r, p.g, p.b) },
  }
}

function buildSuboFromGLB(scene) {
  // subo_calibrated.glb is authored to its final size directly in Blender and loaded
  // WITHOUT rescale/normalisation (MODEL_SCALE_TARGET.subo = null). root stays at scale
  // 1 so pin spheres added to it land in true world coordinates.
  const root = new THREE.Group()
  root.add(scene)
  // The board is authored FLAT already (thin axis = Y up, PCB substrate resting on the
  // workplane, LED matrix facing up), so NO rotation is applied here — the old upright
  // GLB needed a -90° X flatten; the calibrated GLB does not. pins + matrix anchor to
  // the real board substrate via suboBoardBox, so they span the board in any orientation.
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  root.updateMatrixWorld(true)

  // Anchor pins to the true board substrate bounds (see suboBoardBox) — the largest
  // /pcb/i mesh — so the two header rows span the full board instead of collapsing
  // onto a tiny sub-part.
  const box  = suboBoardBox(root)
  const size = box.getSize(new THREE.Vector3())
  const sorted = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])
  const thinAxis = sorted[0][0]   // thickness
  const medAxis  = sorted[1][0]   // shorter dim (connectors spread along this)
  const longAxis = sorted[2][0]   // longer dim — headers on the left/right wings

  // Seat the pin spheres just above the PCB top face, but CAP the height so an oversized
  // GLB can't push the connector bank far off the workplane.
  const thinCtr  = (box.min[thinAxis] + box.max[thinAxis]) / 2
  const thinHalf = (box.max[thinAxis] - box.min[thinAxis]) / 2
  const above = thinCtr + Math.min(thinHalf + SUBO_PIN_R * 0.5, 0.55)
  const pins = {}

  // Eight 3-pin IO headers laid over the real PCB: IO1–IO4 on the LEFT of the LED matrix,
  // IO5–IO8 on the RIGHT (see placeSuboHeaders). longAxis = left↔right (matrix centred,
  // groups flank it); medAxis = the axis the 4 headers stack along. The GLB models no
  // header geometry, so anchors are derived from the measured PCB bbox with uniform spacing.
  placeSuboHeaders(pins, {
    A: medAxis, B: longAxis, thinAxis,
    aCtr: (box.min[medAxis] + box.max[medAxis]) / 2,
    bCtr: (box.min[longAxis] + box.max[longAxis]) / 2,
    aSpan: size[medAxis], bSpan: size[longAxis], above,
  })

  // Render the GLB's own LED-matrix geometry exactly as exported — the GLB is the
  // visual source of truth. (Previously the GLB LEDs were hidden and a procedural
  // canvas matrix panel replaced them; that procedural geometry has been removed, so
  // nothing hides or redraws the imported LEDs.)

  root.userData.dynamicPins = pins
  // Labels sit just ABOVE the pin along the board normal (thin axis) — readable,
  // never intersecting the PCB. Shrunk (labelScale) so the dense 3-pin headers never overlap.
  const lo = { dx: 0, dy: 0, dz: 0 }
  if (thinAxis === 'x') lo.dx = 0.28
  else if (thinAxis === 'z') lo.dz = 0.28
  else lo.dy = 0.28
  root.userData.labelOffset = lo
  root.userData.labelScale = 0.5

  return root
}

function buildSuboProcedural() {
  const root = new THREE.Group()
  const board = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.22, 4.0), mat(0x0b0b14, { roughness: 0.7 }))
  root.add(board)
  // 6×8 LED matrix hint
  const matrix = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.02, 1.8), mat(0x1a1a22, { roughness: 1 }))
  matrix.position.y = 0.12
  root.add(matrix)
  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── DC Motor ────────────────────────────────────────────────────────────────

export function createMotorGroup() {
  const glbScene = cloneModel('motor')
  if (glbScene) return buildMotorFromGLB(glbScene)
  return buildMotorProcedural()
}

// Confirmed default shaft mesh names per GLB model (set by the user after testing)
const DEFAULT_SHAFT = {
  motor_bo: 'Object_24',
  motor_dc: 'Object_9',
}

export function createMotorBOGroup() {
  const glbScene = cloneModel('motor_bo')
  if (glbScene) return buildMotorFromGLB(glbScene, DEFAULT_SHAFT.motor_bo)
  return buildMotorProcedural()
}

export function createMotorDCGroup() {
  const glbScene = cloneModel('motor_dc')
  if (glbScene) return buildMotorFromGLB(glbScene, DEFAULT_SHAFT.motor_dc)
  return buildMotorProcedural()
}

// Creates a world-aligned virtual Group at the shaft tip that props attach to.
// The shaft MESH spins directly (no reparenting = no GLB visual artifacts).
// The virtual GROUP also spins — props parented to it spin with no scale inheritance.
function setupRotorGroup(root, rotorNode, rotorAxis) {
  // Re-pivot the shaft geometry onto its own centre so it spins IN PLACE rather
  // than orbiting the motor centre (its GLB node origin usually isn't on the
  // shaft centreline). Clone first — GLB clones share geometry, so we must not
  // move every other motor's shaft.
  if (rotorNode.geometry && !rotorNode.userData._rePivoted) {
    rotorNode.geometry = rotorNode.geometry.clone()
    rotorNode.geometry.computeBoundingBox()
    const c = rotorNode.geometry.boundingBox.getCenter(new THREE.Vector3())
    rotorNode.geometry.translate(-c.x, -c.y, -c.z)
    rotorNode.position.add(
      new THREE.Vector3(c.x * rotorNode.scale.x, c.y * rotorNode.scale.y, c.z * rotorNode.scale.z)
        .applyQuaternion(rotorNode.quaternion),
    )
    rotorNode.userData._rePivoted = true
  }

  rotorNode.updateMatrixWorld(true)
  const box  = new THREE.Box3().setFromObject(rotorNode)
  const size = box.getSize(new THREE.Vector3())

  // Shaft tip = the extreme point of the shaft in its elongation direction
  const tipPos = box.getCenter(new THREE.Vector3())
  tipPos[rotorAxis] = box.max[rotorAxis]          // e.g. max.y for a vertical shaft

  // Virtual attachment group: direct child of root → no GLB scale inheritance
  // Remove any previously created virtual group first
  if (root.userData.rotorGroup && !root.userData.rotorGroup.isMesh) {
    root.remove(root.userData.rotorGroup)
  }
  const vGroup = new THREE.Group()
  vGroup.position.copy(tipPos)                    // world-space tip position
  root.add(vGroup)

  root.userData.rotorMesh        = rotorNode      // the shaft mesh to spin visually
  root.userData.rotorGroup       = vGroup         // virtual group for prop attachment
  root.userData.rotorAxis        = rotorAxis
  root.userData.currentRotorName = rotorNode.name
}

function buildMotorFromGLB(scene, defaultShaftName = null) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })

  root.updateMatrixWorld(true)

  // Collect all mesh names so the user can manually pick the shaft in the UI
  const motorMeshNames = []
  root.traverse(c => { if (c.isMesh && c.name) motorMeshNames.push(c.name) })
  root.userData.motorMeshNames = motorMeshNames

  // Use the confirmed default shaft name if provided, otherwise fall back to auto-detect
  let rotorNode = null
  if (defaultShaftName) {
    root.traverse(c => { if (c.isMesh && c.name === defaultShaftName) rotorNode = c })
  }
  if (!rotorNode) rotorNode = findRotorNode(root)

  if (rotorNode) {
    const rotorAxis = detectRotorAxis(rotorNode)
    setupRotorGroup(root, rotorNode, rotorAxis)
  } else {
    root.userData.rotorMesh        = null
    root.userData.rotorGroup       = null
    root.userData.currentRotorName = null
  }

  return root
}

function buildMotorProcedural() {
  const root = new THREE.Group()

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.8, 32), mat(0x445566, { metalness: 0.55, roughness: 0.4 }))
  body.rotation.z = Math.PI / 2
  root.add(body)

  for (const side of [-1, 1]) {
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 1.8), mat(0x334455, { metalness: 0.5 }))
    tab.position.set(0, side * 0.95, 0)
    root.add(tab)
  }

  const backCap = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.15, 32), mat(0x223344, { metalness: 0.6 }))
  backCap.rotation.z = Math.PI / 2; backCap.position.x = -1.42
  root.add(backCap)

  const frontBearing = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.35, 24), mat(0x778899, { metalness: 0.7 }))
  frontBearing.rotation.z = Math.PI / 2; frontBearing.position.x = 1.55
  root.add(frontBearing)

  for (let i = 0; i < 6; i++) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8), mat(0x111111))
    const angle = (i / 6) * Math.PI * 2
    vent.position.set(-1.52, Math.sin(angle) * 0.55, Math.cos(angle) * 0.55)
    vent.rotation.z = Math.PI / 2
    root.add(vent)
  }

  for (const [idx, color] of [[0, 0xff2222], [1, 0x111111]]) {
    const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.9, 8), mat(color))
    lead.rotation.z = Math.PI / 2; lead.position.set(-2.1, (idx - 0.5) * 0.5, 0)
    root.add(lead)
  }

  // ── Rotor group (shaft + indicator blades) ────────────────────────────────
  const rotorGroup = new THREE.Group()

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 12), mat(0xddddcc, { metalness: 0.9, roughness: 0.15 }))
  shaft.rotation.z = Math.PI / 2; shaft.position.x = 2.2
  rotorGroup.add(shaft)

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0x441100, roughness: 0.5, metalness: 0.1 })
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.18), bladeMat)
    blade.position.x = 2.95; blade.rotation.x = (i / 3) * Math.PI * 2
    rotorGroup.add(blade)
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 16), mat(0xcccccc, { metalness: 0.8 }))
  hub.rotation.z = Math.PI / 2; hub.position.x = 2.95
  rotorGroup.add(hub)

  root.add(rotorGroup)
  root.userData.rotorGroup = rotorGroup
  root.userData.rotorAxis  = 'x'   // shaft lies along X (rotation.z = π/2 above)

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── LED ─────────────────────────────────────────────────────────────────────

export function createLEDGroup(color = '#ff0000') {
  const glbScene = cloneModel('led')
  if (glbScene) return buildLEDFromGLB(glbScene, color)
  return buildLEDProcedural(color)
}

function buildLEDFromGLB(scene, color) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })

  const emissiveMeshes = findEmissiveMeshes(root)
  for (const mesh of emissiveMeshes) {
    if (mesh.material) {
      mesh.material.emissive = new THREE.Color(0x000000)
      mesh.material.emissiveIntensity = 0
    }
  }
  root.userData.emissiveMeshes = emissiveMeshes
  root.userData.ledColor = color
  return root
}

function buildLEDProcedural(color) {
  const root = new THREE.Group()

  // Body (metal base)
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.28, 0.65, 16),
    mat(0x999999, { metalness: 0.7, roughness: 0.3 })
  )
  body.position.y = 0.1
  root.add(body)

  // Dome (the glowing part)
  const domeMat = new THREE.MeshStandardMaterial({
    color, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85,
    emissive: new THREE.Color(0x000000), emissiveIntensity: 0,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat)
  dome.position.y = 0.425
  dome.name = 'dome'
  root.add(dome)

  // Anode lead (longer, +)
  const anode = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.65, 8),
    mat(0xcccccc, { metalness: 0.9 })
  )
  anode.position.set(0, -0.225, 0.12)
  root.add(anode)

  // Cathode lead (shorter, −)
  const cathode = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8),
    mat(0xcccccc, { metalness: 0.9 })
  )
  cathode.position.set(0, -0.15, -0.12)
  root.add(cathode)

  root.userData.emissiveMeshes = [dome]
  root.userData.ledColor = color

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── Servo ───────────────────────────────────────────────────────────────────

export function createServoGroup() {
  const glbScene = cloneModel('servo')
  if (glbScene) return buildServoFromGLB(glbScene)
  return buildServoProcedural()
}

function buildServoFromGLB(scene) {
  const root = new THREE.Group()
  root.add(scene)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  root.updateMatrixWorld(true)

  // Pass 1 — keyword match on mesh name
  let rotorNode = null
  root.traverse(c => {
    if (!rotorNode && c.isMesh) {
      const n = c.name.toLowerCase()
      if (['horn','arm','servo_horn','output_shaft','output','lever','rotor','shaft','gear'].some(k => n.includes(k)))
        rotorNode = c
    }
  })

  // Pass 2 — geometric: topmost non-body mesh (output shaft / horn sits on top)
  if (!rotorNode) {
    root.updateMatrixWorld(true)
    const meshes = []
    root.traverse(c => { if (c.isMesh) { c.updateMatrixWorld(true); meshes.push(c) } })

    if (meshes.length > 1) {
      // Body = largest-volume mesh
      let maxVol = 0, bodyMesh = null
      for (const c of meshes) {
        const s = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3())
        const vol = s.x * s.y * s.z
        if (vol > maxVol) { maxVol = vol; bodyMesh = c }
      }
      // Among the rest, take the one with the highest Y bounding-box center
      let topY = -Infinity
      for (const c of meshes) {
        if (c === bodyMesh) continue
        const cy = new THREE.Box3().setFromObject(c).getCenter(new THREE.Vector3()).y
        if (cy > topY) { topY = cy; rotorNode = c }
      }
    } else if (meshes.length === 1) {
      rotorNode = meshes[0]
    }
  }

  if (rotorNode) {
    // Servo output shaft always spins around Y.
    // Use a pivot wrapper so the horn rotates around its own bounding-box center
    // (not around some arbitrary mesh local origin from the GLB export).
    _setupServoPivot(root, rotorNode)
  } else {
    root.userData.rotorMesh  = null
    root.userData.rotorGroup = null
    root.userData.rotorAxis  = 'y'
  }
  root.userData.isServo = true
  return root
}

// Creates a pivot Group centred on the horn mesh and reparents the horn into it.
// Rotating pivotGroup.rotation.y spins the horn around the output shaft axis.
function _setupServoPivot(root, rotorNode) {
  root.updateMatrixWorld(true)
  rotorNode.updateMatrixWorld(true)

  // World-space bounding box centre of the horn → convert to root-local
  const worldCenter = new THREE.Box3().setFromObject(rotorNode).getCenter(new THREE.Vector3())
  const localCenter = worldCenter.clone().applyMatrix4(
    new THREE.Matrix4().copy(root.matrixWorld).invert()
  )

  // Snapshot the horn's world transform before reparenting
  const worldMat = rotorNode.matrixWorld.clone()
  rotorNode.removeFromParent()

  // Pivot group at horn centre (child of root)
  const pivot = new THREE.Group()
  pivot.position.copy(localCenter)
  root.add(pivot)
  pivot.add(rotorNode)
  pivot.updateMatrixWorld(true)

  // Restore horn's local transform relative to the new pivot
  const localMat = new THREE.Matrix4().copy(pivot.matrixWorld).invert().multiply(worldMat)
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  localMat.decompose(p, q, s)
  rotorNode.position.copy(p)
  rotorNode.quaternion.copy(q)
  rotorNode.scale.copy(s)

  // rotorMesh = null so animateServo only rotates the pivot group, not the mesh twice
  root.userData.rotorMesh        = null
  root.userData.rotorGroup       = pivot
  root.userData.rotorAxis        = 'y'
  root.userData.currentRotorName = rotorNode.name
}

function buildServoProcedural() {
  const root = new THREE.Group()

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.6, 3.0),
    mat(0x2a3540, { metalness: 0.3, roughness: 0.6 })
  )
  root.add(body)

  // Top mounting flange
  const flange = new THREE.Mesh(
    new THREE.BoxGeometry(2.9, 0.22, 1.1),
    mat(0x1e2830, { metalness: 0.4 })
  )
  flange.position.set(0, 0.9, 0.5)
  root.add(flange)

  // Output shaft housing
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 0.35, 16),
    mat(0x111111, { metalness: 0.6 })
  )
  housing.position.set(0, 1.0, 0.4)
  root.add(housing)

  // Horn group (rotates to servo angle)
  const hornGroup = new THREE.Group()
  hornGroup.position.set(0, 1.25, 0.4)

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16),
    mat(0xeeeeee, { metalness: 0.2 })
  )
  hornGroup.add(hub)

  // Cross arms
  const armH = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.2), mat(0xfafafa))
  hornGroup.add(armH)
  const armV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 1.6), mat(0xfafafa))
  hornGroup.add(armV)

  // Small circles at arm tips
  for (const [px, pz] of [[0.8,0],[-0.8,0],[0,0.8],[0,-0.8]]) {
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), mat(0xdddddd))
    dot.position.set(px, 0, pz)
    hornGroup.add(dot)
  }

  root.add(hornGroup)
  root.userData.rotorGroup = hornGroup
  root.userData.rotorMesh  = hornGroup
  root.userData.rotorAxis  = 'y'
  root.userData.isServo    = true

  // Wire connector block
  const conn = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.6, 1.4),
    mat(0x111111, { metalness: 0.4 })
  )
  conn.position.set(-1.6, 0.1, 0)
  root.add(conn)

  // Three wires: orange (signal), red (VCC), brown (GND)
  for (const [i, color] of [[0, 0xff6600], [1, 0xff2222], [2, 0x332200]]) {
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8),
      mat(color)
    )
    wire.rotation.z = Math.PI / 2
    wire.position.set(-2.05, 0.1, (i - 1) * 0.4)
    root.add(wire)
  }

  root.traverse(c => { c.castShadow = true; c.receiveShadow = true })
  return root
}

// ─── Wire helpers (unchanged) ─────────────────────────────────────────────────

export function buildWireControlPoints(from, to, _unused = 0, midOverride = null) {
  if (midOverride) return [from.clone(), midOverride.clone(), to.clone()]
  const mid = from.clone().lerp(to, 0.5)
  const d   = from.distanceTo(to)
  // Arch above the highest pin so wires never clip through geometry
  mid.y = Math.max(from.y, to.y) + Math.min(d * 0.14, 1.2) + 0.35
  return [from.clone(), mid, to.clone()]
}

const WIRE_RADIUS   = 0.045  // tube radius in scene units
const WIRE_RADSEGS  = 5      // polygon sides (pentagonal cross-section — cheap but round-looking)

export function buildWireLine(controlPoints, color, segments = 60) {
  const curve = new THREE.CatmullRomCurve3(controlPoints)
  const geo   = new THREE.TubeGeometry(curve, segments, WIRE_RADIUS, WIRE_RADSEGS, false)
  const mtr   = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
  const line  = new THREE.Mesh(geo, mtr)
  line.userData.isWire     = true
  line.userData.isWireLine = true
  return { line, curve }
}

export function rebuildWireLine(line, controlPoints, segments = 60) {
  // Skip degenerate curves (start === end or all points collapsed) — TubeGeometry
  // would compute zero-length tangents, producing NaN normals and potentially throwing.
  if (controlPoints[0].distanceTo(controlPoints[controlPoints.length - 1]) < 0.001) return
  const curve  = new THREE.CatmullRomCurve3(controlPoints)
  line.geometry.dispose()
  line.geometry = new THREE.TubeGeometry(curve, segments, WIRE_RADIUS, WIRE_RADSEGS, false)
  return curve
}

export function createWireLine(from, to) {
  const points   = [from.clone(), to.clone()]
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineBasicMaterial({ color: 0x44aaff, linewidth: 2 })
  const line     = new THREE.Line(geometry, material)
  line.userData.isWire = true
  return line
}

export function updateWireLine(line, from, to) {
  const pos = line.geometry.attributes.position
  pos.setXYZ(0, from.x, from.y, from.z)
  pos.setXYZ(1, to.x, to.y, to.z)
  pos.needsUpdate = true
}

// ─── Sensors & extra outputs (GLB-based) ──────────────────────────────────────
// All five use a preloaded GLB; pins come from the static PIN_DEFS above (added
// by wireManager.registerComponent → addPinSpheresToGroup). A simple box is used
// only if the GLB failed to load.
function buildModelComponent(name) {
  const root = new THREE.Group()
  const glb = cloneModel(name)
  if (glb) {
    root.add(glb)
  } else {
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1.4), mat(0x3a3a44)))
  }
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  return root
}

export function createIRSensorGroup()   { return buildModelComponent('ir_sensor') }
export function createUltrasonicGroup() { return buildModelComponent('ultrasonic') }
export function createBuzzerGroup()     { return buildModelComponent('buzzer') }
export function createGasSensorGroup()  { return buildModelComponent('gas_sensor') }
// Draw the OLED text buffer onto its canvas (black screen, cyan monospace text).
function drawOledCanvas(ctx, canvas, text) {
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = '#03060a'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#7ff0ff'
  ctx.textBaseline = 'top'
  const lines = String(text ?? '').split('\n')
  const n = Math.max(1, lines.length)
  // Fewer lines → bigger font (so an "eyes" face is large); centre the whole
  // block both horizontally and vertically for a clean look.
  const fontPx = n <= 2 ? 46 : n <= 4 ? 30 : 20
  const lineH  = Math.round(fontPx * 1.12)
  ctx.font = `bold ${fontPx}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let y = H / 2 - (n * lineH) / 2 + lineH / 2
  const charW = ctx.measureText('0').width || fontPx * 0.6
  for (const ln of lines) {
    if (/[●⬤]/.test(ln)) {
      // Draw "eye" circles as REAL filled arcs (always solid, never dependent on
      // a font glyph); every other character on the line renders as text.
      const startX = (W - ln.length * charW) / 2
      for (let i = 0; i < ln.length; i++) {
        const ch = ln[i]
        if (ch === ' ') continue
        const cx = startX + i * charW + charW / 2
        if (ch === '●' || ch === '⬤') {
          ctx.beginPath()
          ctx.arc(cx, y, charW * (ch === '⬤' ? 0.5 : 0.42), 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillText(ch, cx, y)
        }
      }
    } else {
      ctx.fillText(ln, W / 2, y, W - 10)
    }
    y += lineH
  }
}

// Add a glowing canvas "screen" plane over the OLED model's largest face and store
// an update(text) hook on userData.oledScreen so the simulation can write to it.
function attachOledScreen(root) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return
  const size   = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const thin   = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])[0][0]

  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 128
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  const planeMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false })
  const eps = 0.06
  let plane
  if (thin === 'z') {
    plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.84, size.y * 0.84), planeMat)
    plane.position.set(center.x, center.y, center.z + size.z / 2 + eps)
  } else if (thin === 'x') {
    plane = new THREE.Mesh(new THREE.PlaneGeometry(size.z * 0.84, size.y * 0.84), planeMat)
    plane.rotation.y = Math.PI / 2
    plane.position.set(center.x + size.x / 2 + eps, center.y, center.z)
  } else {
    plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.84, size.z * 0.84), planeMat)
    plane.rotation.x = -Math.PI / 2
    plane.position.set(center.x, center.y + size.y / 2 + eps, center.z)
  }
  plane.userData.isOledScreen = true
  root.add(plane)
  drawOledCanvas(ctx, canvas, '')
  tex.needsUpdate = true
  root.userData.oledScreen = { update: (t) => { drawOledCanvas(ctx, canvas, t); tex.needsUpdate = true } }
}

export function createOLEDGroup() {
  const r = buildModelComponent('oled')
  r.userData.isOled = true
  attachOledScreen(r)
  return r
}

// ─── New sensors (GLB when present, tailored procedural fallback otherwise) ────
// Same pattern as the Arduino/servo/motor builders: prefer the preloaded GLB;
// if it 404s, build a small distinctive module so the part still looks the part.
// Pins come from the static PIN_DEFS above via addPinSpheresToGroup.

// A small PCB base + a header strip, shared by the procedural sensor fallbacks.
function sensorBoard(root, w, d, color) {
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), mat(color, { roughness: 0.7 }))
  root.add(board)
  const header = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.18, 0.28), mat(0x111111))
  header.position.set(0, 0.16, d / 2 - 0.2)
  root.add(header)
  return board
}

export function createColorSensorGroup() {
  const glb = cloneModel('color_sensor')
  const root = new THREE.Group()
  if (glb) { root.add(glb) }
  else {
    sensorBoard(root, 4.0, 3.0, 0x1b3a6b)
    // Central photodiode lens
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 24), mat(0x0a0a0a, { roughness: 0.3 }))
    lens.position.y = 0.28
    root.add(lens)
    // Four white illumination LEDs at the corners
    for (const [x, z] of [[-1.2, -0.9], [1.2, -0.9], [-1.2, 0.9], [1.2, 0.9]]) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), mat(0xffffff, { emissive: 0x222222, roughness: 0.2 }))
      led.position.set(x, 0.22, z)
      root.add(led)
    }
  }
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  return root
}

export function createLDRGroup() {
  const glb = cloneModel('ldr_sensor')
  const root = new THREE.Group()
  if (glb) { root.add(glb) }
  else {
    sensorBoard(root, 2.4, 2.0, 0x0e5a3a)
    // The photoresistor: a light disc with a squiggle pattern hint
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 24), mat(0xd9b64a, { roughness: 0.5 }))
    cell.position.set(0, 0.22, -0.3)
    root.add(cell)
    const pot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), mat(0x2255aa))
    pot.position.set(0.6, 0.22, 0.4)
    root.add(pot)
  }
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  return root
}

// ─── TT motor with a Hall encoder ────────────────────────────────────────────
// The BO motor (motor_bo.glb, its can along −x) plus the encoder parts on its
// rear shaft: a ring magnet, the encoder board with its two Hall sensors, and
// the 6-pin header (ENC_MOTOR_PINS). Logic: utils/encoderMotor.js.
export function createEncoderMotorGroup() {
  const root = createMotorBOGroup()
  root.userData.labelScale = 0.55
  root.updateMatrixWorld(true)
  const x0 = new THREE.Box3().setFromObject(root).min.x        // rear end of the motor
  const enc = new THREE.Group(); enc.name = 'encoder'
  const magnet = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 28), mat(0x1c1c20, { roughness: 0.5, metalness: 0.2 }))
  magnet.rotation.z = Math.PI / 2; magnet.position.set(x0 + 0.02, 0, 0)
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.2, 1.75), mat(0x2357b8, { roughness: 0.6 }))
  pcb.position.set(x0 - 0.1, 0.03, 0)
  enc.add(magnet, pcb)
  for (const z of [-0.18, 0.18]) {                               // the two Hall sensors (A, B)
    const hall = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.12), mat(0x111111))
    hall.position.set(x0 - 0.04, 0.38, z); enc.add(hall)
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 6 * 0.254), mat(0x111111))
  strip.position.set(x0 - 0.12, 0.76, 0); enc.add(strip)
  for (let i = 0; i < 6; i++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.55, 0.064), mat(0xd4a017, { roughness: 0.3, metalness: 0.7 }))
    pin.position.set(x0 - 0.12, 0.92, -0.635 + i * 0.254); enc.add(pin)
  }
  enc.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.userData.noOutline = true } })
  root.add(enc)
  root.userData.hasEncoder = true
  return root
}

// ─── Continuous-rotation servo (FS90R-style) ─────────────────────────────────
// Same body, lead and horn pivot as the servo (servo.glb), so parts and wheels
// attach to the horn exactly as before. The case is darkened (the FS90R is a
// black servo) so it can't be mistaken for a positional one. The horn is
// spun by ObjectManager.animateMotor from simulationManager.motorSpeeds.
// Logic: utils/continuousServo.js.
const CR_CASE = new THREE.Color(0x2a2c31)
export function createContinuousServoGroup() {
  const root = createServoGroup()
  const horn = root.userData.rotorGroup
  const inHorn = (o) => { for (let n = o; n; n = n.parent) if (n === horn) return true; return false }
  root.traverse((c) => {
    if (!c.isMesh || inHorn(c) || !c.material) return
    const tint = (m) => { const k = m.clone(); if (k.color) k.color.lerp(CR_CASE, 0.8); return k }
    c.material = Array.isArray(c.material) ? c.material.map(tint) : tint(c.material)
  })
  root.userData.isServo = false              // not a positional joint
  root.userData.isContinuousServo = true
  return root
}

// ─── 28BYJ-48 stepper motor ──────────────────────────────────────────────────
// GLB first: public/models/stepper.glb, generated from tools/models/stepper.model.js
// (scene units, no rescale — STEPPER_PINS sit on its plug). The mesh named
// 'shaft' is wrapped in a pivot (rotorGroup) about its own axis (y), so
// SimulationManager can set the shaft angle and parts can be attached to it the
// same way as to a servo horn. Logic: utils/stepper.js.
export function createStepperGroup() {
  const root = new THREE.Group()
  root.userData.labelScale = 0.5
  const glb = cloneModel('stepper')
  let shaft = null
  if (glb) {
    root.add(glb)
    root.traverse(c => {
      if (!c.isMesh) return
      c.castShadow = true; c.receiveShadow = true
      if (c.name === 'shaft') shaft = c
      if (c.name !== 'can' && c.name !== 'flange') c.userData.noOutline = true   // outline the body, not every wire
    })
  } else {
    // Procedural stand-in: can + ears + brass shaft + wire box + plug.
    const can = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.9, 40), mat(0xc2c7ce, { metalness: 0.45, roughness: 0.35 }))
    can.position.y = 0.95; root.add(can)
    const ears = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.7), mat(0xb3b9c1, { metalness: 0.45, roughness: 0.4 }))
    ears.position.y = 1.94; root.add(ears)
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.46, 1.65, 0.78), mat(0x2c66d1))
    box.position.set(0, 0.92, -1.34); root.add(box)
    const plug = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.58, 0.62), mat(0xf1efe6))
    plug.position.set(0, 0.3, -3.84); root.add(plug)
    shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 20), mat(0xd2a64a, { metalness: 0.55, roughness: 0.3 }))
    shaft.position.set(0, 2.5, 0.8); shaft.name = 'shaft'; root.add(shaft)
    root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  }
  if (shaft) _setupServoPivot(root, shaft)          // rotorGroup = pivot on the shaft axis (y)
  root.userData.isStepper = true
  return root
}

// ─── Servo gripper (parallel claw) ───────────────────────────────────────────
// Frame (scene units = cm): fingers point +z, jaws open along ±x, the pads'
// middle at y = 0. Layout from utils/gripper.js (GRIP): two meshing gears at
// x = ±pivotX turn the links; each finger rides a parallelogram so the rubber
// pads stay parallel. The servo sits on top of the plate, its shaft driving the
// left gear. root.userData.setGap(gap) poses the jaws (ObjectManager.setGripperGap).
export function createGripperGroup() {
  const root = new THREE.Group()
  root.userData.labelScale = 0.5
  const acrylic = mat(0x23262d, { roughness: 0.35, metalness: 0.05 })
  const steel   = mat(0xb9bec6, { roughness: 0.3, metalness: 0.8 })
  const rubber  = mat(0x15161a, { roughness: 0.95 })
  const plateY = 0.42
  const PIVOT_X = GRIP.pivotX, PIVOT_Z = GRIP.pivotZ

  // top plate, with the servo above it
  const plate = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 3.7), acrylic)
  plate.position.set(0, plateY, -0.55); plate.name = 'plate'; root.add(plate)
  const servo = new THREE.Mesh(new THREE.BoxGeometry(1.22, 2.2, 2.3), mat(0x2563eb, { roughness: 0.5 }))
  servo.position.set(-PIVOT_X, plateY + 0.125 + 1.1, PIVOT_Z - 0.75); root.add(servo)
  const tabs = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.14, 3.2), mat(0x1e40af, { roughness: 0.5 }))
  tabs.position.set(-PIVOT_X, plateY + 0.125 + 1.55, PIVOT_Z - 0.75); root.add(tabs)
  const label = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.5, 1.2), mat(0xf8fafc, { roughness: 0.6 }))
  label.position.set(-PIVOT_X, plateY + 0.125 + 0.9, PIVOT_Z - 1.1); root.add(label)
  // its lead: cable to a 3-pin connector behind the claw (GRIPPER_PINS)
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.6), mat(0x8b5a2b, { roughness: 0.8 }))
  cable.position.set(-0.45, 1.05, -2.1); root.add(cable)
  const plug = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.35, 0.3), mat(0x111111))
  plug.position.set(-0.45, 1.1, -2.95); root.add(plug)
  for (const x of [-0.704, -0.45, -0.196]) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), mat(0xd4a017, { roughness: 0.3, metalness: 0.7 }))
    pin.position.set(x, 1.35, -2.95); root.add(pin)
  }
  // standoffs between plate and the link plane
  for (const [x, z] of [[-1.3, -2.1], [1.3, -2.1], [-1.3, 0.9], [1.3, 0.9]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 10), steel)
    st.position.set(x, plateY / 2, z); root.add(st)
  }

  // gears + links + fingers, mirrored
  const jaws = []
  for (const side of [-1, 1]) {
    const gear = new THREE.Group()
    gear.position.set(side * PIVOT_X, 0, PIVOT_Z)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.28, 20), acrylic)
    gear.add(disc)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.12), acrylic)
      tooth.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45); tooth.rotation.y = -a
      gear.add(tooth)
    }
    const link = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, GRIP.link), acrylic)
    link.position.set(0, 0, GRIP.link / 2); gear.add(link)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 10), steel)
    gear.add(hub)
    root.add(gear)
    // the parallel follower link (beside the main one, its own pivot)
    const follower = new THREE.Group()
    follower.position.set(side * (PIVOT_X + 0.75), 0.02, PIVOT_Z - 0.25)
    const fbar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, GRIP.link), acrylic)
    fbar.position.set(0, 0, GRIP.link / 2); follower.add(fbar)
    root.add(follower)
    // finger: plate + rubber pad on its inner face; it only translates
    const finger = new THREE.Group()
    const fplate = new THREE.Mesh(new THREE.BoxGeometry(0.17, 1.2, GRIP.padLen + 0.35), acrylic)
    fplate.position.set(-side * 0.085, 0, GRIP.padLen / 2 - 0.1); finger.add(fplate)
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, GRIP.padLen), rubber)
    pad.position.set(-side * (0.17 + 0.05), 0, GRIP.padLen / 2); finger.add(pad)
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.3), acrylic)   // where the follower link joins
    knuckle.position.set(side * 0.375, 0.02, -0.25); finger.add(knuckle)
    root.add(finger)
    jaws.push({ side, gear, follower, finger })
  }

  root.userData.isGripper = true
  root.userData.setGap = (gap) => {
    const { x, z, theta } = fingerRoot(gap)
    for (const { side, gear, follower, finger } of jaws) {
      gear.rotation.y = side * theta            // link swings outward on each side
      follower.rotation.y = side * theta
      finger.position.set(side * x, 0, z)
    }
  }
  root.userData.setGap(GRIP.maxGap)
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  return root
}

// ─── PCA9685 16-channel servo driver ─────────────────────────────────────────
// GLB first: public/models/pca9685.glb (tools/models/pca9685.model.js), same
// frame as PCA9685_PINS. Logic: utils/pca9685.js.
export function createPca9685Group() {
  const root = new THREE.Group()
  root.userData.labelScale = 0.45
  const glb = cloneModel('pca9685')
  if (glb) {
    root.add(glb)
    root.traverse(c => {
      if (!c.isMesh) return
      c.castShadow = true; c.receiveShadow = true
      if (c.name !== 'pcb') c.userData.noOutline = true
      if (c.name === 'pcb' || c.name === 'pcb_silkscreen') c.castShadow = false   // see createL298NGroup
    })
  } else {
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(6.25, 0.16, 2.54), mat(0x1d4fae, { roughness: 0.7 }))
    root.add(pcb)
    const chip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.44), mat(0x18181a))
    chip.position.set(0.75, 0.13, -0.55); root.add(chip)
    const term = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 0.8), mat(0x1f6fd1))
    term.position.set(-0.55, 0.455, -0.78); root.add(term)
    ;[[0xe2b31c, 0.42], [0xc0262d, 0.674], [0x151517, 0.928]].forEach(([c, z]) => {
      const row = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.25, 0.254), mat(c))
      row.position.set(0, 0.205, z); root.add(row)
    })
    const hdr = new THREE.Mesh(new THREE.BoxGeometry(0.254, 0.25, 1.52), mat(0x151517))
    hdr.position.set(-2.86, 0.205, 0); root.add(hdr)
    root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  }
  return root
}

// ─── ULN2003 stepper driver board ────────────────────────────────────────────
// GLB first: public/models/uln2003.glb (tools/models/uln2003.model.js), same
// frame as ULN2003_PINS. The four LEDs (led_A … led_D) get their own material
// so they light per coil (ObjectManager.setUlnLeds).
export function createUln2003Group() {
  const root = new THREE.Group()
  root.userData.labelScale = 0.5
  const leds = []
  const glb = cloneModel('uln2003')
  if (glb) {
    root.add(glb)
    root.traverse(c => {
      if (!c.isMesh) return
      c.castShadow = true; c.receiveShadow = true
      if (c.name !== 'pcb') c.userData.noOutline = true
      if (c.name === 'pcb' || c.name === 'pcb_silkscreen') c.castShadow = false   // see createL298NGroup
      const m = /^led_([ABCD])$/.exec(c.name)
      if (m) { c.material = c.material.clone(); leds['ABCD'.indexOf(m[1])] = c }
    })
  } else {
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.16, 3.2), mat(0x1f8a45, { roughness: 0.7 }))
    root.add(pcb)
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.32, 1.98), mat(0x18181a))
    chip.position.set(-0.3, 0.34, 0.2); root.add(chip)
    const sock = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.6), mat(0xf2f0e8))
    sock.position.set(-0.3, 0.43, -1.15); root.add(sock)
    const hdr = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.25, 0.25), mat(0x151517))
    hdr.position.set(-0.2, 0.2, 1.35); root.add(hdr)
    ;[-0.75, -0.3, 0.15, 0.6].forEach((z, i) => {
      const led = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0xd42a2a, emissive: 0x000000 }))
      led.position.set(1.2, 0.28, z); root.add(led); leds[i] = led
    })
    root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  }
  root.userData.ulnLeds = leds
  return root
}

// ─── L298N dual H-bridge motor driver ────────────────────────────────────────
// GLB first: public/models/l298n.glb, generated from tools/models/l298n.model.js
// in the same frame as L298N_PINS (no rescale). If it can't load, a simple
// procedural board stands in: red PCB, finned heatsink, blue screw terminals
// (OUT1/2 left, OUT3/4 right, 12V·GND·5V front), the logic header with ENA/ENB
// jumper caps, a regulator and two capacitors. Logic lives in utils/l298n.js.
export function createL298NGroup() {
  const root = new THREE.Group()
  root.userData.labelScale = 0.5                 // dense header → smaller pin labels
  const glb = cloneModel('l298n')
  if (glb) {
    root.add(glb)
    // Selection outline: the board's edge only. Its ~120 parts (heatsink fins,
    // terminals, legs, SMDs…) would bury it in cyan edges; selection already
    // tints the whole model. Node name 'pcb' comes from l298n.model.js.
    root.traverse(c => {
      if (!c.isMesh) return
      c.castShadow = true; c.receiveShadow = true
      if (c.name !== 'pcb') c.userData.noOutline = true
      // The silkscreen is a separate sheet 0.002 above the board — far thinner
      // than a shadow-map texel (~0.06). If the board/sheet CAST shadows they
      // shadow each other in blotches ("shadow acne"). They still RECEIVE the
      // real shadows of the heatsink, terminals and capacitors.
      if (c.name === 'pcb' || c.name === 'pcb_silkscreen') c.castShadow = false
    })
    return root
  }
  const S = 4.3, top = 0.08
  const pcb = new THREE.Mesh(new THREE.BoxGeometry(S, 0.16, S), mat(0xc81e1e, { roughness: 0.7 }))
  root.add(pcb)

  // Heatsink: base + vertical fins, at the back of the board.
  const sink = mat(0x18181b, { roughness: 0.45, metalness: 0.35 })
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 1.3), sink)
  base.position.set(0, top + 0.15, -1.15)
  root.add(base)
  for (let i = 0; i < 9; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 1.3), sink)
    fin.position.set(-1.2 + i * 0.3, top + 0.3 + 1.05, -1.15)
    root.add(fin)
  }

  // Blue screw terminals with silver screw heads.
  const blue = mat(0x1d4ed8, { roughness: 0.5 })
  const screw = mat(0xc0c4ca, { roughness: 0.3, metalness: 0.6 })
  const terminal = (nx, nz, along, x, z) => {
    const w = along === 'x' ? nx * 0.55 : 0.75, d = along === 'z' ? nz * 0.55 : 0.75
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), blue)
    body.position.set(x, top + 0.35, z)
    root.add(body)
    const n = along === 'x' ? nx : nz
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.55
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16), screw)
      head.position.set(x + (along === 'x' ? off : 0), top + 0.73, z + (along === 'z' ? off : 0))
      root.add(head)
    }
  }
  terminal(1, 2, 'z', -1.75, 0)        // OUT1 · OUT2
  terminal(1, 2, 'z',  1.75, 0)        // OUT3 · OUT4
  terminal(3, 1, 'x', -1.0, 1.75)      // 12V · GND · 5V

  // Logic header: black strip, gold pins, black jumper caps on ENA / ENB.
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.22, 0.28), mat(0x111111))
  strip.position.set(1.0, top + 0.11, 1.85)
  root.add(strip)
  const gold = mat(0xd4a017, { roughness: 0.3, metalness: 0.7 })
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), gold)
    p.position.set(0.35 + i * 0.254, top + 0.36, 1.85)
    root.add(p)
  }
  for (const i of [0, 5]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.5), mat(0x0a0a0a))
    cap.position.set(0.35 + i * 0.254, top + 0.5, 1.72)
    root.add(cap)
  }

  // 5 V regulator (black body + metal tab) and two electrolytic capacitors.
  const reg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.45), mat(0x111111))
  reg.position.set(-0.3, top + 0.13, 0.75)
  root.add(reg)
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.3), screw)
  tab.position.set(-0.3, top + 0.03, 0.4)
  root.add(tab)
  for (const [x, z] of [[0.75, 0.6], [1.45, 0.6]]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.75, 20), mat(0x1f2937, { roughness: 0.4 }))
    cap.position.set(x, top + 0.38, z)
    root.add(cap)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.06, 20), screw)
    ring.position.set(x, top + 0.76, z)
    root.add(ring)
  }

  // Dense header → smaller pin labels for this board.
  root.userData.labelScale = 0.5
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  return root
}

export function createDHT11Group() {
  const glb = cloneModel('dht11')
  const root = new THREE.Group()
  if (glb) { root.add(glb) }
  else {
    sensorBoard(root, 2.6, 2.0, 0x123a7a)
    // The classic blue perforated DHT11 housing
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.8), mat(0x2c6fe0, { roughness: 0.6 }))
    body.position.set(0, 0.7, -0.1)
    root.add(body)
    for (let i = 0; i < 4; i++) {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 8), mat(0x0a0a0a))
      hole.rotation.x = Math.PI / 2
      hole.position.set(-0.45 + i * 0.3, 0.85, 0.3)
      root.add(hole)
    }
  }
  root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  return root
}

// ─── Module sensors: procedural models ───────────────────────────────────────
// PIR HC-SR501 · flame (LM393) · YL-69 soil probe + YL-38 · FC-37 rain board +
// comparator · KY-038 sound · TTP223 touch · GY-BMP280 · GY-521 (MPU6050) ·
// KY-003 Hall (A3144). Drawn at their real sizes (1 unit = 1 cm) in the frame of
// MODULE_SENSOR_LAYOUT, so the header pins line up with the pin spheres. A GLB
// named after the type is used instead if one is ever added (same rule as the
// other sensors). The board mesh is named 'pcb'; the small parts skip the
// selection outline (see createL298NGroup) so a selected module stays readable.
const MS_GOLD   = () => mat(0xd4a017, { roughness: 0.3, metalness: 0.75 })
const MS_BLACK  = () => mat(0x111113, { roughness: 0.55 })
const MS_NICKEL = () => mat(0xcfd3d8, { roughness: 0.25, metalness: 0.85 })

function msBox(root, w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  root.add(m)
  return m
}
function msPcb(root, w, d, color, cz = 0) {
  const pcb = msBox(root, w, 0.16, d, 0, 0, cz, mat(color, { roughness: 0.75 }))
  pcb.name = 'pcb'
  return pcb
}
// Silkscreen: a canvas sheet just above (or below) the board. draw(ctx, P, text, sz)
// gets P(x, z) → canvas pixels, a text helper and pixels-per-unit, all in board units.
function msSilk(root, w, d, cz, draw, { bottom = false } = {}) {
  const S = 96, W = Math.min(1024, Math.round(w * S)), H = Math.min(1024, Math.round(d * S))
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  const sx = W / w, sz = H / d
  const P = (x, z) => [(x + w / 2) * sx, ((bottom ? -1 : 1) * (z - cz) + d / 2) * sz]
  const text = (s, x, z, size = 0.11, align = 'center') => {
    ctx.font = `bold ${Math.round(size * sz)}px Arial, sans-serif`
    ctx.textAlign = align; ctx.textBaseline = 'middle'
    const [px, py] = P(x, z)
    ctx.fillText(s, px, py)
  }
  ctx.fillStyle = '#f4f4f0'; ctx.strokeStyle = '#f4f4f0'; ctx.lineWidth = Math.max(1, 0.018 * sz)
  draw(ctx, P, text, sz)
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }))
  sheet.rotation.x = bottom ? Math.PI / 2 : -Math.PI / 2
  sheet.position.set(0, bottom ? -MS_TOP - 0.002 : MS_TOP + 0.002, cz)
  sheet.name = 'pcb_silkscreen'
  root.add(sheet)
  return sheet
}
// 2.54 mm header. 'out' = right-angle pins leaving the +Z edge at `edgeZ`;
// 'down' = straight pins under the board; 'up' = straight pins standing on top.
function msHeader(root, n, { edgeZ, cx = 0, style = 'out' }) {
  const span = n * MS_PITCH, x0 = cx - ((n - 1) * MS_PITCH) / 2
  const gold = MS_GOLD()
  if (style === 'out') {
    msBox(root, span, 0.25, 0.25, cx, MS_TOP + 0.125, edgeZ - 0.15, MS_BLACK())
    for (let i = 0; i < n; i++) {
      const x = x0 + i * MS_PITCH
      msBox(root, 0.064, 0.064, 0.86, x, MS_TOP + 0.125, edgeZ + 0.15, gold)          // horizontal pin
      msBox(root, 0.064, 0.3, 0.064, x, 0.0, edgeZ - 0.27, gold)                      // leg through the board
    }
  } else if (style === 'down') {
    msBox(root, span, 0.25, 0.25, cx, -MS_TOP - 0.125, edgeZ, MS_BLACK())
    for (let i = 0; i < n; i++) msBox(root, 0.064, 0.84, 0.064, x0 + i * MS_PITCH, -0.26, edgeZ, gold)
  } else {
    msBox(root, span, 0.25, 0.25, cx, MS_TOP + 0.125, edgeZ, MS_BLACK())
    for (let i = 0; i < n; i++) msBox(root, 0.064, 0.84, 0.064, x0 + i * MS_PITCH, MS_TOP + 0.3, edgeZ, gold)
  }
}
// 0805/0603 SMD resistor or capacitor (black/tan body, tinned ends).
function msSmd(root, x, z, { rot = 0, cap = false, under = false } = {}) {
  const g = new THREE.Group()
  const body = cap ? mat(0xb08d57, { roughness: 0.6 }) : mat(0x1b1b1b, { roughness: 0.5 })
  const tin = mat(0xcfd2d6, { roughness: 0.3, metalness: 0.8 })
  msBox(g, 0.12, 0.05, 0.08, 0, 0, 0, body)
  msBox(g, 0.03, 0.055, 0.085, -0.075, 0, 0, tin)
  msBox(g, 0.03, 0.055, 0.085, 0.075, 0, 0, tin)
  g.position.set(x, under ? -MS_TOP - 0.025 : MS_TOP + 0.025, z)
  g.rotation.y = rot
  root.add(g)
}
// 0805 LED; returns the lens mesh (own material) so the sim can light it.
function msLed(root, x, z, color, { under = false } = {}) {
  const sign = under ? -1 : 1
  msBox(root, 0.16, 0.04, 0.08, x, sign * (MS_TOP + 0.02), z, mat(0xe8e8e8, { roughness: 0.4 }))
  const lens = msBox(root, 0.12, 0.05, 0.075, x, sign * (MS_TOP + 0.06), z,
    new THREE.MeshStandardMaterial({ color, roughness: 0.25, transparent: true, opacity: 0.85, emissive: 0x000000 }))
  lens.userData.ledColor = color
  return lens
}
// SOIC / SOT IC body with gull-wing legs along its two long sides.
function msChip(root, x, z, { w = 0.5, d = 0.39, h = 0.15, legs = 4, under = false, rot = 0 } = {}) {
  const g = new THREE.Group()
  msBox(g, w, h, d, 0, h / 2, 0, mat(0x18181a, { roughness: 0.45 }))
  const leg = mat(0xb9bdc3, { roughness: 0.3, metalness: 0.8 })
  const pitch = w / legs
  for (let i = 0; i < legs; i++) for (const s of [-1, 1])
    msBox(g, 0.04, 0.03, 0.1, -w / 2 + pitch * (i + 0.5), 0.02, s * (d / 2 + 0.04), leg)
  if (under) { g.rotation.x = Math.PI; g.position.set(x, -MS_TOP, z) } else g.position.set(x, MS_TOP, z)
  g.rotation.y = rot
  root.add(g)
}
// Blue 3296 multi-turn trim-pot (the threshold adjuster on comparator modules).
function msTrimpot(root, x, z, { rot = 0 } = {}) {
  const g = new THREE.Group()
  msBox(g, 0.48, 0.95, 0.95, 0, 0.475, 0, mat(0x2563eb, { roughness: 0.55 }))
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16), mat(0xd6b45a, { roughness: 0.3, metalness: 0.8 }))
  screw.position.set(0, 0.975, -0.3)
  g.add(screw)
  msBox(g, 0.18, 0.012, 0.03, 0, 1.0, -0.3, MS_BLACK())                               // screw slot
  g.position.set(x, MS_TOP, z)
  g.rotation.y = rot
  root.add(g)
}
// Plated mounting hole (gold annulus over a dark drill).
function msHole(root, x, z, r = 0.15) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r, 24), mat(0xd4a017, { roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide }))
  ring.rotation.x = -Math.PI / 2
  ring.position.set(x, MS_TOP + 0.004, z)
  root.add(ring)
  const drill = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.17, 20), mat(0x050505, { roughness: 0.9 }))
  drill.position.set(x, 0, z)
  root.add(drill)
}
const msLabelRow = (names, edgeZ, cx = 0, map = {}) => (ctx, P, text) => {
  const x0 = cx - ((names.length - 1) * MS_PITCH) / 2
  names.forEach((n, i) => text(map[n] ?? n, x0 + i * MS_PITCH, edgeZ - 0.42, 0.075))
}
function msFinish(root, leds) {
  root.userData.labelScale = 0.5                       // dense 2.54 mm headers → small pin labels
  root.userData.moduleLeds = leds
  root.traverse(c => {
    if (!c.isMesh) return
    c.castShadow = true; c.receiveShadow = true
    if (c.name !== 'pcb') c.userData.noOutline = true
    if (c.name === 'pcb' || c.name === 'pcb_silkscreen') c.castShadow = false
  })
  return root
}

// LM393 comparator module body (flame / sound / YL-38): chip, trim-pot,
// PWR + DO LEDs and the passives. Returns { pwr, sig } LEDs.
function msComparatorParts(root, { cz = 0, potX = -0.35, potZ = -0.3, chipX = 0.32, chipZ = 0.35, ledX = 0.5, ledZ = -0.7 }) {
  msTrimpot(root, potX, cz + potZ)
  msChip(root, chipX, cz + chipZ, { rot: Math.PI / 2 })
  const pwr = msLed(root, ledX, cz + ledZ, 0xff2a1a)
  const sig = msLed(root, ledX, cz + ledZ - 0.3, 0x22ff55)
  msSmd(root, -0.45, cz + 0.55, { rot: Math.PI / 2 })
  msSmd(root, -0.2, cz + 0.6, { rot: Math.PI / 2 })
  msSmd(root, 0.05, cz + 0.85, { cap: true })
  msSmd(root, ledX - 0.25, cz + ledZ - 0.15, { rot: Math.PI / 2 })
  return { pwr, sig }
}

function buildPir() {
  const L = MODULE_SENSOR_LAYOUT.pir_sensor, root = new THREE.Group()
  msPcb(root, L.w, L.d, 0x23733a)
  // Fresnel lens: white square flange + faceted dome over the pyro sensor.
  const lensMat = mat(0xf2f2ec, { roughness: 0.92, flatShading: true })
  msBox(root, 2.4, 0.18, 2.4, 0, MS_TOP + 0.09, 0, lensMat)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lensMat)
  dome.position.y = MS_TOP + 0.18
  root.add(dome)
  msHole(root, -1.43, 0); msHole(root, 1.43, 0)
  // Underside: BISS0001 controller, the two orange trim-pots (sensitivity, time),
  // the trigger-mode jumper and the header pointing down.
  msChip(root, 0.25, -0.2, { w: 0.98, d: 0.39, legs: 8, under: true })
  for (const z of [-0.6, 0.15]) {
    msBox(root, 0.6, 0.22, 0.6, -1.0, -MS_TOP - 0.11, z, mat(0xf08a1c, { roughness: 0.5 }))
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), mat(0xf6f6f6))
    rotor.position.set(-1.0, -MS_TOP - 0.245, z)
    root.add(rotor)
  }
  msHeader(root, 3, { edgeZ: -0.55, cx: 1.15, style: 'down' })                            // H / L jumper
  msBox(root, 0.25, 0.3, 0.5, 1.15 - MS_PITCH / 2, -0.55, -0.55, mat(0xf5c518, { roughness: 0.5 }))
  msHeader(root, 3, { edgeZ: L.hdrZ, style: 'down' })
  for (const [x, z] of [[0.9, 0.6], [0.6, 0.65], [-0.3, 0.55], [-0.55, 0.6]]) msSmd(root, x, z, { under: true, rot: Math.PI / 2 })
  msSilk(root, L.w, L.d, 0, (ctx, P, text) => {
    msLabelRow(L.pins, L.hdrZ + 0.1)(ctx, P, text)
    text('HC-SR501', 0.25, -0.75, 0.13)
    text('SX', -1.0, -0.98, 0.08); text('TX', -1.0, 0.53, 0.08)
  }, { bottom: true })
  return msFinish(root, { pwr: null, sig: null })
}

function buildFlame() {
  const L = MODULE_SENSOR_LAYOUT.flame_sensor, root = new THREE.Group()
  msPcb(root, L.w, L.d, 0x1d4fb0)
  const leds = msComparatorParts(root, {})
  msHole(root, 0, 0.95, 0.14)
  // 5 mm IR receiver (black) on bent leads, looking out of the −Z end.
  const black = mat(0x0b0b0d, { roughness: 0.18 })
  const ledZ = -L.d / 2 - 0.35, ledY = MS_TOP + 0.3
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 24), black)
  body.rotation.x = Math.PI / 2; body.position.set(0, ledY, ledZ)
  root.add(body)
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), black)
  tip.rotation.x = -Math.PI / 2; tip.position.set(0, ledY, ledZ - 0.25)
  root.add(tip)
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 24), black)
  flange.rotation.x = Math.PI / 2; flange.position.set(0, ledY, ledZ + 0.27)
  root.add(flange)
  const gold = MS_GOLD()
  for (const x of [-0.1, 0.1]) {
    msBox(root, 0.04, 0.04, 0.42, x, ledY, -L.d / 2 + 0.0, gold)
    msBox(root, 0.04, ledY - MS_TOP + 0.02, 0.04, x, (ledY + MS_TOP) / 2, -L.d / 2 + 0.2, gold)
  }
  msHeader(root, 4, { edgeZ: L.hdrZ })
  msSilk(root, L.w, L.d, 0, (ctx, P, text) => {
    msLabelRow(L.pins, L.hdrZ, 0, { AO: 'A0', DO: 'D0' })(ctx, P, text)
    text('PWR', 0.22, -0.7, 0.07, 'right'); text('D0', 0.22, -1.0, 0.07, 'right')
  })
  return msFinish(root, leds)
}

// YL-38 style comparator + the 2-wire lead to its probe (soil / rain).
function buildComparatorWithLead(root, L, probeHdrZ, wires = [0xef4444, 0x1f2937]) {
  const cz = L.compZ
  msPcb(root, L.w, L.d, 0x1d4fb0, cz)
  const leds = msComparatorParts(root, { cz })
  msHeader(root, 2, { edgeZ: cz - L.d / 2 + 0.25, style: 'up' })                           // to the probe
  msHeader(root, 4, { edgeZ: L.hdrZ })
  msSilk(root, L.w, L.d, cz, (ctx, P, text) => {
    msLabelRow(L.pins, L.hdrZ, 0, { AO: 'A0', DO: 'D0' })(ctx, P, text)
    text('+  −', 0, cz - L.d / 2 + 0.55, 0.08)
    text('PWR', 0.22, cz - 0.7, 0.07, 'right'); text('D0', 0.22, cz - 1.0, 0.07, 'right')
  })
  // Dupont lead: female housings on both 2-pin headers, wires arcing between.
  const from = cz - L.d / 2 + 0.25
  wires.forEach((c, i) => {
    const x = (i - 0.5) * MS_PITCH
    msBox(root, 0.24, 0.6, 0.24, x, MS_TOP + 0.62, from, MS_BLACK())
    msBox(root, 0.24, 0.6, 0.24, x, MS_TOP + 0.62, probeHdrZ, MS_BLACK())
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, MS_TOP + 0.92, from), new THREE.Vector3(x * 1.6, MS_TOP + 1.35, (from * 2 + probeHdrZ) / 3),
      new THREE.Vector3(x * 1.6, MS_TOP + 1.35, (from + probeHdrZ * 2) / 3), new THREE.Vector3(x, MS_TOP + 0.92, probeHdrZ),
    ])
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 6, false), mat(c, { roughness: 0.6 })))
  })
  return leds
}

function buildSoil() {
  const L = MODULE_SENSOR_LAYOUT.soil_moisture, root = new THREE.Group()
  // YL-69 fork (60 × 20 mm): head at +Z, two pointed prongs towards −Z.
  // Shape y = −z (the extrude is rotated −90° about X).
  const head = 0.7, prongEnd = -4.9, tip = -5.3
  const s = new THREE.Shape()
  s.moveTo(-1, -head); s.lineTo(1, -head); s.lineTo(1, -prongEnd); s.lineTo(0.69, -tip); s.lineTo(0.38, -prongEnd)
  s.lineTo(0.38, 1.1); s.lineTo(-0.38, 1.1); s.lineTo(-0.38, -prongEnd); s.lineTo(-0.69, -tip); s.lineTo(-1, -prongEnd); s.lineTo(-1, -head)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2); geo.translate(0, -0.08, 0)
  const fork = new THREE.Mesh(geo, mat(0x2a2d33, { roughness: 0.7 }))
  fork.name = 'pcb'
  root.add(fork)
  // Nickel-plated electrodes down each prong + the pads in the head.
  const ni = MS_NICKEL()
  for (const x of [-0.69, 0.69]) msBox(root, 0.46, 0.012, 3.7, x, MS_TOP + 0.006, -2.95, ni)
  for (const x of [-0.69, 0.69]) msBox(root, 0.46, 0.012, 1.0, x, MS_TOP + 0.006, -0.55, ni)
  msHeader(root, 2, { edgeZ: 0.35, style: 'up' })
  msSilk(root, 2.0, 1.8, -0.2, (ctx, P, text) => { text('YL-69', 0, -0.55, 0.2) })
  const leds = buildComparatorWithLead(root, L, 0.35)
  return msFinish(root, leds)
}

function buildRain() {
  const L = MODULE_SENSOR_LAYOUT.rain_sensor, root = new THREE.Group()
  // FC-37 rain plate (54 × 40 mm) with an interleaved nickel comb.
  const pw = 4.0, pd = 5.4, pz = -2.55
  msPcb(root, pw, pd, 0x14253f, pz)
  const ni = MS_NICKEL()
  msBox(root, 0.2, 0.012, 4.7, -1.75, MS_TOP + 0.006, pz - 0.15, ni)
  msBox(root, 0.2, 0.012, 4.7, 1.75, MS_TOP + 0.006, pz - 0.15, ni)
  for (let i = 0; i < 14; i++) {
    const z = pz - 2.3 + i * 0.33, left = i % 2 === 0
    msBox(root, 3.25, 0.012, 0.14, left ? -0.075 : 0.075, MS_TOP + 0.006, z, ni)
  }
  msHole(root, -1.6, pz + pd / 2 - 0.35); msHole(root, 1.6, pz + pd / 2 - 0.35)
  msHeader(root, 2, { edgeZ: pz + pd / 2 - 0.25, style: 'up' })
  msSilk(root, pw, pd, pz, (ctx, P, text) => { text('FC-37', 0, pz + pd / 2 - 0.62, 0.18) })
  const leds = buildComparatorWithLead(root, L, pz + pd / 2 - 0.25, [0xf59e0b, 0x1f2937])
  return msFinish(root, leds)
}

function buildSound() {
  const L = MODULE_SENSOR_LAYOUT.sound_sensor, root = new THREE.Group()
  msPcb(root, L.w, L.d, 0xb3201e)
  const leds = msComparatorParts(root, { potX: 0.25, potZ: -0.25, chipX: -0.3, chipZ: 0.45, ledX: -0.45, ledZ: -0.55 })
  // Electret capsule (9.7 mm) lying at the −Z end, felt face outwards.
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.485, 0.485, 0.67, 32), mat(0xc4c7cc, { roughness: 0.3, metalness: 0.8 }))
  can.rotation.x = Math.PI / 2; can.position.set(0, MS_TOP + 0.49, -L.d / 2 - 0.05)
  root.add(can)
  const felt = new THREE.Mesh(new THREE.CircleGeometry(0.44, 32), mat(0x141414, { roughness: 1 }))
  felt.rotation.y = Math.PI; felt.position.set(0, MS_TOP + 0.49, -L.d / 2 - 0.385)
  root.add(felt)
  msHole(root, 0, 0.95, 0.14)
  msHeader(root, 4, { edgeZ: L.hdrZ })
  msSilk(root, L.w, L.d, 0, (ctx, P, text) => {
    msLabelRow(L.pins, L.hdrZ, 0, { AO: 'A0', GND: 'G', VCC: '+', DO: 'D0' })(ctx, P, text)
    text('L1', -0.2, -0.55, 0.07, 'left'); text('L2', -0.2, -0.85, 0.07, 'left')
  })
  return msFinish(root, leds)
}

function buildTouch() {
  const L = MODULE_SENSOR_LAYOUT.touch_sensor, root = new THREE.Group()
  msPcb(root, L.w, L.d, 0xc0262d)
  const sig = msLed(root, 0.36, 0.38, 0xff2a1a)
  msChip(root, 0, 0, { w: 0.29, d: 0.16, h: 0.11, legs: 3, under: true })                  // TTP223 (SOT-23-6)
  msSmd(root, 0.3, 0.2, { under: true, cap: true }); msSmd(root, -0.3, 0.2, { under: true })
  msHeader(root, 3, { edgeZ: L.hdrZ })
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.39, 32), mat(0xd9483e, { roughness: 0.4, metalness: 0.3 }))
  pad.rotation.x = -Math.PI / 2; pad.position.set(0, MS_TOP + 0.001, -0.2)
  root.add(pad)
  msSilk(root, L.w, L.d, 0, (ctx, P, text, sz) => {
    // The copper touch pad under the mask, outlined in silk.
    const [cx, cy] = P(0, -0.2)
    ctx.beginPath(); ctx.arc(cx, cy, 0.4 * sz, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, 0.3 * sz, 0, Math.PI * 2); ctx.stroke()
    msLabelRow(L.pins, L.hdrZ, 0, { OUT: 'I/O' })(ctx, P, text)
  })
  return msFinish(root, { pwr: null, sig })
}

function buildBmp280() {
  const L = MODULE_SENSOR_LAYOUT.bmp280, root = new THREE.Group()
  msPcb(root, L.w, L.d, 0x5b2a86)
  // The BMP280 itself: a 2.0 × 2.5 mm metal-lid LGA with its vent hole.
  msBox(root, 0.2, 0.09, 0.25, 0.15, MS_TOP + 0.045, -0.12, mat(0xd7d9dd, { roughness: 0.25, metalness: 0.85 }))
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 12), MS_BLACK())
  vent.position.set(0.2, MS_TOP + 0.095, -0.18)
  root.add(vent)
  msSmd(root, -0.15, -0.15, { cap: true, rot: Math.PI / 2 }); msSmd(root, 0.45, -0.1, { rot: Math.PI / 2 })
  msSmd(root, 0.45, 0.12, { rot: Math.PI / 2 }); msSmd(root, -0.15, 0.1, { cap: true, rot: Math.PI / 2 })
  msHole(root, -0.5, -0.25, 0.15)
  msHeader(root, 6, { edgeZ: L.hdrZ })
  msSilk(root, L.w, L.d, 0, (ctx, P, text) => {
    msLabelRow(L.pins, L.hdrZ)(ctx, P, text)
    text('GY-BMP280', 0.15, -0.42, 0.1)
  })
  return msFinish(root, { pwr: null, sig: null })
}

function buildMpu6050() {
  const L = MODULE_SENSOR_LAYOUT.accelerometer, root = new THREE.Group()
  msPcb(root, L.w, L.d, 0x1d4fb0)
  msBox(root, 0.4, 0.09, 0.4, 0, MS_TOP + 0.045, -0.15, mat(0x161618, { roughness: 0.4 }))    // MPU-6050 (4 × 4 mm QFN)
  msBox(root, 0.04, 0.005, 0.04, -0.15, MS_TOP + 0.092, -0.3, mat(0x8a8a8a))                 // pin-1 dot
  msChip(root, -0.62, -0.38, { w: 0.29, d: 0.16, h: 0.1, legs: 3 })                          // 3.3 V regulator
  const pwr = msLed(root, 0.68, -0.05, 0x22ff55)
  for (const [x, z, cap] of [[0.42, -0.35, true], [-0.4, 0.15, false], [0.42, 0.15, false], [-0.35, -0.12, true], [0.6, -0.35, false]])
    msSmd(root, x, z, { cap, rot: Math.PI / 2 })
  msHole(root, -0.8, -0.55); msHole(root, 0.8, -0.55)
  msHeader(root, 8, { edgeZ: L.hdrZ })
  msSilk(root, L.w, L.d, 0, (ctx, P, text, sz) => {
    msLabelRow(L.pins, L.hdrZ)(ctx, P, text)
    text('GY-521', 0, -0.62, 0.11)
    // Axis arrows: chip X → +X, chip Y → −Z (see arduino/motionSim.js).
    const arrow = (x1, z1, x2, z2) => {
      const [a, b] = P(x1, z1), [c, d] = P(x2, z2)
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke()
      const ang = Math.atan2(d - b, c - a), h = 0.06 * sz
      ctx.beginPath(); ctx.moveTo(c, d)
      ctx.lineTo(c - h * Math.cos(ang - 0.5), d - h * Math.sin(ang - 0.5))
      ctx.lineTo(c - h * Math.cos(ang + 0.5), d - h * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill()
    }
    arrow(0.3, 0.3, 0.62, 0.3); text('X', 0.72, 0.3, 0.08)
    arrow(0.3, 0.3, 0.3, -0.02); text('Y', 0.3, -0.1, 0.08)
  })
  return msFinish(root, { pwr, sig: null })
}

function buildHall() {
  const L = MODULE_SENSOR_LAYOUT.hall_sensor, root = new THREE.Group()
  msPcb(root, L.w, L.d, 0x18181b)
  // A3144 in its TO-92S package, standing on three legs at the −Z end.
  const legY = 0.4
  msBox(root, 0.4, 0.3, 0.15, 0, MS_TOP + legY + 0.15, -0.72, mat(0x141416, { roughness: 0.35 }))
  const gold = MS_GOLD()
  for (const x of [-0.127, 0, 0.127]) msBox(root, 0.04, legY, 0.03, x, MS_TOP + legY / 2, -0.72, gold)
  const sig = msLed(root, 0.45, 0.15, 0xff2a1a)
  msSmd(root, 0.45, -0.15, { rot: Math.PI / 2 }); msSmd(root, -0.4, 0.15, { rot: Math.PI / 2 })
  msHole(root, -0.45, -0.3, 0.15)
  msHeader(root, 3, { edgeZ: L.hdrZ })
  msSilk(root, L.w, L.d, 0, (ctx, P, text) => {
    msLabelRow(L.pins, L.hdrZ, 0, { GND: '−', VCC: '+', OUT: 'S' })(ctx, P, text)
    text('KY-003', 0, 0.15, 0.1)
  })
  return msFinish(root, { pwr: null, sig })
}

const MODULE_SENSOR_BUILDERS = {
  pir_sensor: buildPir, flame_sensor: buildFlame, soil_moisture: buildSoil, rain_sensor: buildRain,
  sound_sensor: buildSound, touch_sensor: buildTouch, bmp280: buildBmp280,
  accelerometer: buildMpu6050, gyroscope: buildMpu6050, hall_sensor: buildHall,
}
/** True for the module sensors built by createModuleSensorGroup. */
export const isModuleSensorType = (type) => type in MODULE_SENSOR_BUILDERS

export function createModuleSensorGroup(type) {
  const glb = cloneModel(type)
  if (glb) {
    const root = new THREE.Group()
    root.add(glb)
    root.userData.labelScale = 0.5
    root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
    return root
  }
  return MODULE_SENSOR_BUILDERS[type]()
}

// ─── Gear motors: N20 micro and JGA25-370 metal (± Hall encoder) ─────────────
// Variants of the existing motor types (utils/componentVariants.js): a plain
// gear motor is a `motor_bo` (TERM_A / TERM_B), an encoder gear motor is a
// `motor_enc` (the same 6-pin M1 GND A B VCC M2 header as the TT encoder
// motor). So wiring, driving, gearbox, encoder pulses and code all work as for
// those types; only the model differs. Unlike the TT, these have the output
// shaft IN LINE with the motor: it runs along +X (rotorAxis 'x', like the
// procedural motor), and wheels / props attach at its tip. Real sizes, 1 unit = 1 cm.
// The pins sit on the parts' real terminals and connector contacts, so they are
// per-object (userData.dynamicPins, as the GLB boards use).
const GM_STEEL  = () => mat(0xc9ccd1, { roughness: 0.35, metalness: 0.45 })
const GM_BRASS  = () => mat(0xc8a24a, { roughness: 0.4, metalness: 0.5 })
const GM_COPPER = () => mat(0xc77b42, { roughness: 0.4, metalness: 0.5 })
const GM_BLACK  = () => mat(0x161618, { roughness: 0.6 })

function gmMesh(root, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material)
  m.position.set(x, y, z)
  root.add(m)
  return m
}
// A solid of revolution along X from x0 to x1 (cylinder turned onto the X axis).
function gmCyl(root, r, x0, x1, material, segs = 32, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r, r, x1 - x0, segs)
  g.rotateZ(Math.PI / 2)
  return gmMesh(root, g, material, (x0 + x1) / 2, y, z)
}
// Extrude a 2D profile (in the YZ plane: shape x → −z, shape y → y) along X.
function gmExtrudeX(shape, x0, x1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 24 })
  g.rotateY(Math.PI / 2)
  g.translate(x0, 0, 0)
  return g
}
// Round profile with two flats at |y| = h/2 (the N20's flattened can).
function gmFlatRound(r, h) {
  const t = Math.asin(Math.min(1, h / 2 / r))
  const s = new THREE.Shape()
  s.absarc(0, 0, r, -t, t, false)
  s.absarc(0, 0, r, Math.PI - t, Math.PI + t, false)
  s.closePath()
  return s
}
// D-profile output shaft (diameter d, one flat) from x0 to x1 — spins about X.
function gmDShaft(root, d, x0, x1) {
  const r = d / 2, flat = r * 0.6, t = Math.acos(flat / r)
  const s = new THREE.Shape()
  s.absarc(0, 0, r, t, 2 * Math.PI - t, false)   // the round part …
  s.closePath()                                  // … closed by the flat at x = flat
  const shaft = gmMesh(root, gmExtrudeX(s, x0, x1), GM_STEEL())
  shaft.name = 'shaft'
  return shaft
}
// The two brush terminals at the rear: copper tabs with a solder hole.
function gmTerminals(root, x, zs, { y = 0, len = 0.3, w = 0.16 } = {}) {
  for (const z of zs) {
    gmMesh(root, new THREE.BoxGeometry(len, 0.03, w), GM_COPPER(), x - len / 2, y, z)
    gmMesh(root, new THREE.CylinderGeometry(w * 0.22, w * 0.22, 0.035, 12), GM_BLACK(), x - len * 0.62, y, z)
  }
}
// Encoder at the rear end (x = rear face): magnet disc, PCB in the YZ plane,
// two Hall sensors and a 6-way 2.0 mm connector whose contacts face −X.
// Returns the connector contact positions (pin order M1 GND A B VCC M2).
function gmEncoder(root, x, { pcbW, pcbH, round = false, magnetR, connY, pcbColor = 0x1f7a3a }) {
  gmCyl(root, magnetR, x - 0.06, x, mat(0x2b2b30, { roughness: 0.5, metalness: 0.3 }), 28)
  const pcbMat = mat(pcbColor, { roughness: 0.7 })
  const px0 = x - 0.2, px1 = x - 0.08
  const pcb = round ? gmCyl(root, pcbW / 2, px0, px1, pcbMat, 40)
    : gmMesh(root, new THREE.BoxGeometry(px1 - px0, pcbH, pcbW), pcbMat, (px0 + px1) / 2)
  pcb.name = 'encoder_pcb'
  for (const z of [-0.18, 0.18])                                               // Hall A / B (SOT-23) on the inner face
    gmMesh(root, new THREE.BoxGeometry(0.06, 0.13, 0.1), GM_BLACK(), x - 0.05, magnetR + 0.1, z)
  for (const [dy, dz] of [[-0.25, 0.3], [-0.25, -0.3]])                       // pull-up resistors on the outer face
    gmMesh(root, new THREE.BoxGeometry(0.04, 0.05, 0.1), GM_BLACK(), px0 - 0.02, dy, dz)
  // White 6-way connector housing on the outer face, gold contacts pointing −X.
  const n = 6, pitch = 0.2, span = n * pitch
  gmMesh(root, new THREE.BoxGeometry(0.45, 0.45, span + 0.1), mat(0xf1efe8, { roughness: 0.6 }), px0 - 0.225, connY, 0)
  const pins = []
  for (let i = 0; i < n; i++) {
    const z = -((n - 1) * pitch) / 2 + i * pitch
    gmMesh(root, new THREE.BoxGeometry(0.5, 0.05, 0.05), MS_GOLD(), px0 - 0.25, connY, z)
    pins.push({ x: px0 - 0.5, y: connY, z })
  }
  return pins
}
const GM_ENC_PINS = [['TERM_A', 'M1', 0xff2222, 'power'], ['GND', 'GND', 0x333333, 'gnd'], ['ENC_A', 'A', 0x22c55e, 'digital'],
  ['ENC_B', 'B', 0x3b82f6, 'digital'], ['VCC', 'VCC', 0xff6666, 'power'], ['TERM_B', 'M2', 0x111111, 'gnd']]
const gmEncPinDefs = (pts) => Object.fromEntries(GM_ENC_PINS.map(([name, label, color, type], i) =>
  [name, { ...pts[i], r: 0.07, color, type, label, ldy: i % 2 ? 0.28 : 0 }]))
const gmTermPinDefs = (x, y, zs) => ({
  TERM_A: { x, y, z: zs[0], r: 0.09, color: 0xff2222, type: 'power', label: '+' },
  TERM_B: { x, y, z: zs[1], r: 0.09, color: 0x111111, type: 'gnd',   label: '−' },
})
function gmFinish(root, shaft, pins, encoder) {
  setupRotorGroup(root, shaft, 'x')
  root.userData.motorMeshNames = [shaft.name]
  root.userData.dynamicPins = pins
  root.userData.labelScale = encoder ? 0.42 : 0.5
  root.userData.labelOffset = encoder ? { dx: -0.3, dy: 0.32, dz: 0 } : { dx: -0.45, dy: 0.2, dz: 0 }
  if (encoder) root.userData.hasEncoder = true
  root.traverse(c => {
    if (!c.isMesh) return
    c.castShadow = true; c.receiveShadow = true
    if (c.name !== 'body') c.userData.noOutline = true
  })
  return root
}

// N20 micro gear motor: 12 × 10 mm flattened can (15 mm) + 9 mm metal gearbox,
// Ø3 mm D-shaft (10 mm). The encoder version adds a magnet disc, a 12 mm
// square PCB with two Hall sensors and the 6-way connector.
function buildN20(encoder) {
  const root = new THREE.Group()
  const prof = gmFlatRound(0.6, 1.0)
  const can = gmMesh(root, gmExtrudeX(prof, -1.15, 0.38), GM_STEEL())
  can.name = 'body'
  gmMesh(root, gmExtrudeX(gmFlatRound(0.58, 0.96), -1.35, -1.15), mat(0x1d1d20, { roughness: 0.55 }))      // brush end cap
  // Gearbox: two plates on four posts, the gear stack visible between them.
  gmMesh(root, new THREE.BoxGeometry(0.1, 1.0, 1.2), GM_STEEL(), 0.43)
  gmMesh(root, new THREE.BoxGeometry(0.1, 1.0, 1.2), GM_STEEL(), 1.25)
  for (const [y, z] of [[0.4, 0.5], [-0.4, 0.5], [0.4, -0.5], [-0.4, -0.5]])
    gmCyl(root, 0.05, 0.48, 1.2, GM_STEEL(), 10, y, z)
  for (const [x, r, y, z] of [[0.6, 0.42, 0.05, 0.05], [0.78, 0.3, -0.12, -0.15], [0.94, 0.4, 0.1, -0.05], [1.1, 0.33, -0.05, 0.12]])
    gmCyl(root, r, x - 0.05, x + 0.05, GM_BRASS(), 18, y, z)
  gmCyl(root, 0.2, 1.3, 1.42, GM_BRASS(), 20)                                  // shaft bushing
  const shaft = gmDShaft(root, 0.3, 1.42, 2.42)
  if (encoder) {
    gmTerminals(root, -1.35, [0.35, -0.35], { len: 0.12 })
    const pts = gmEncoder(root, -1.38, { pcbW: 1.2, pcbH: 1.05, magnetR: 0.42, connY: -0.2 })
    return gmFinish(root, shaft, gmEncPinDefs(pts), true)
  }
  gmTerminals(root, -1.35, [0.35, -0.35])
  return gmFinish(root, shaft, gmTermPinDefs(-1.62, 0, [0.35, -0.35]), false)
}

// JGA25-370 metal gear motor: Ø25 mm steel gearbox (21 mm) on a Ø24.4 mm
// 370 can (31 mm), Ø4 mm D-shaft (12 mm), two M3 mounting holes in the front.
// The encoder version: magnet ring + round Ø25 mm Hall encoder board and the
// 6-way connector (M1 GND C1 C2 VCC M2).
function buildMetalGear(encoder) {
  const root = new THREE.Group()
  const can = gmCyl(root, 1.22, -2.75, 0.3, mat(0xb7bbc2, { roughness: 0.3, metalness: 0.45 }), 40)
  can.name = 'body'
  for (const x of [-2.2, -0.2]) gmCyl(root, 1.235, x, x + 0.08, mat(0x8d9299, { roughness: 0.35, metalness: 0.45 }), 40)   // crimp rings
  gmCyl(root, 1.0, -2.95, -2.75, mat(0x2a2a2e, { roughness: 0.5 }), 36)       // brush holder
  gmCyl(root, 1.27, 0.3, 2.4, mat(0xd7d9dc, { roughness: 0.45, metalness: 0.4 }), 44)   // gearbox
  for (const x of [0.9, 1.5]) gmCyl(root, 1.28, x, x + 0.04, mat(0x9ea3a9, { roughness: 0.4, metalness: 0.45 }), 44)     // stage seams
  for (const z of [-0.85, 0.85]) {                                            // M3 holes on the front face
    gmCyl(root, 0.17, 2.39, 2.42, mat(0x0b0b0c), 16, 0, z)
  }
  gmCyl(root, 0.35, 2.4, 2.55, GM_BRASS(), 24)                                 // bearing boss
  const shaft = gmDShaft(root, 0.4, 2.55, 3.75)
  if (encoder) {
    gmTerminals(root, -2.95, [0.55, -0.55], { y: 0.2, len: 0.14, w: 0.2 })
    const pts = gmEncoder(root, -3.02, { pcbW: 2.5, round: true, magnetR: 0.62, connY: 0.75, pcbColor: 0x1d4fb0 })
    return gmFinish(root, shaft, gmEncPinDefs(pts), true)
  }
  gmTerminals(root, -2.95, [0.55, -0.55], { y: 0.2, w: 0.2 })
  return gmFinish(root, shaft, gmTermPinDefs(-3.25, 0.2, [0.55, -0.55]), false)
}

const GEAR_MOTOR_BUILDERS = {
  n20: () => buildN20(false), n20_enc: () => buildN20(true),
  metal_gear: () => buildMetalGear(false), metal_gear_enc: () => buildMetalGear(true),
}
/** True when a scene object is a gear-motor variant with its own model. */
export const isGearMotorModel = (obj) => !!obj?.variant && obj.variant in GEAR_MOTOR_BUILDERS
  && (obj.type === 'motor_bo' || obj.type === 'motor_enc')
export function createGearMotorGroup(variant) { return GEAR_MOTOR_BUILDERS[variant]() }
