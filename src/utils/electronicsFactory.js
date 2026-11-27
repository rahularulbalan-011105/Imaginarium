import * as THREE from 'three'
import { GRIP, fingerRoot } from './gripper.js'
import { cloneModel, findRotorNode, detectRotorAxis, findEmissiveMeshes } from './modelLoader.js'
import { ESP32_PINS } from './esp32Board.js'
import { TFT28_PINS_TABLE, TFT28_GH } from './tft28.js'

// ─── shared material helper ───────────────────────────────────────────────────
const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...opts })

// ─── Pin definitions (local-space positions) ─────────────────────────────────
// type: 'pwm' | 'digital' | 'analog' | 'gnd' | 'power'
// Positions are tuned to match the scaled GLB / procedural models

export const ARDUINO_PINS = {
  D2:   { x: -2.38 + 2*0.365, y: 0.62, z: 3.1,  color: 0xffcc00, type: 'digital', label: '~2'  },
  D3:   { x: -2.38 + 3*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~3'  },
  D4:   { x: -2.38 + 4*0.365, y: 0.62, z: 3.1,  color: 0xffcc00, type: 'digital', label: '4'   },
  D5:   { x: -2.38 + 5*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~5'  },
  D6:   { x: -2.38 + 6*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~6'  },
  D9:   { x: -2.38 + 9*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~9'  },
  D10:  { x: -2.38 +10*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~10' },
  D11:  { x: -2.38 +11*0.365, y: 0.62, z: 3.1,  color: 0xff8800, type: 'pwm',     label: '~11' },
  '5V': { x: 2.12,            y: 0.62, z: -3.1, color: 0xff2222, type: 'power',   label: '5V'  },
  GND1: { x: 2.45,            y: 0.62, z: -3.1, color: 0x333333, type: 'gnd',     label: 'GND' },
  GND2: { x: 2.78,            y: 0.62, z: -3.1, color: 0x333333, type: 'gnd',     label: 'GND' },
  SDA:  { x: -1.0,            y: 0.62, z: -3.1, color: 0x22c55e, type: 'digital', label: 'SDA' },
  SCL:  { x: -0.67,           y: 0.62, z: -3.1, color: 0x3b82f6, type: 'digital', label: 'SCL' },
}

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

// Waveshare 2.8" capacitive touch LCD (tools/models/tft28.model.js, utils/tft28.js):
// the 13 pins sit in the mouth of the GH1.25 connector on the rear, which faces
// the thick-bezel (+z) edge. 1.25 mm pitch, so the labels stagger over 3 rows and
// sit just past the glass edge where the module does not hide them.
const TFT_ROLE_COLOR = { power: 0xff2222, gnd: 0x333333, pwm: 0xff8800 }
const TFT_SIG_COLOR = { MISO: 0x64748b, MOSI: 0x3b82f6, SCLK: 0x06b6d4, LCD_CS: 0xa855f7, LCD_DC: 0xec4899, LCD_RST: 0xeab308, TP_SDA: 0x22c55e, TP_SCL: 0x14b8a6, TP_INT: 0xf97316, TP_RST: 0xfacc15 }
export const TFT28_PINS = Object.fromEntries(TFT28_PINS_TABLE.map(({ name, role }, i) => [name, {
  x: (TFT28_GH.x0 - i * TFT28_GH.pitch) / 10, y: TFT28_GH.mouthY / 10, z: TFT28_GH.mouthZ / 10 + 0.04, r: 0.05,
  color: TFT_ROLE_COLOR[role] ?? TFT_SIG_COLOR[name] ?? 0x66aaff, type: role, label: name, ldy: (i % 3) * 0.11,
}]))

export const PIN_DEFS = {
  tft28:    TFT28_PINS,
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
}

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
  const canvas = document.createElement('canvas')
  canvas.width  = W * S
  canvas.height = H * S
  const ctx = canvas.getContext('2d')

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

  const PWM = new Set([3, 5, 6, 9, 10, 11])
  const pins = {}

  // D2–D11 (10 pins) spaced along the long edge
  for (let i = 2; i <= 11; i++) {
    const t = (i - 2) / 9                          // 0 → 1
    const p = { x: 0, y: 0, z: 0 }
    p[longAxis] = longMin + longSpan * (0.12 + t * 0.76)
    p[medAxis]  = digRow
    p[thinAxis] = above
    pins[`D${i}`] = {
      ...p,
      color: PWM.has(i) ? 0xff8800 : 0xffcc00,
      type:  PWM.has(i) ? 'pwm' : 'digital',
      label: PWM.has(i) ? `~${i}` : `${i}`,
    }
  }

  // 5V + two GND pins along the opposite long edge
  const pwrDefs = [
    { name: '5V',   t: 0.20, color: 0xff2222, type: 'power', label: '5V'  },
    { name: 'GND1', t: 0.40, color: 0x444444, type: 'gnd',   label: 'GND' },
    { name: 'GND2', t: 0.60, color: 0x444444, type: 'gnd',   label: 'GND' },
    // I2C: A4 = SDA, A5 = SCL on the analog header (same end as the real board)
    { name: 'SDA',  t: 0.80, color: 0x22c55e, type: 'digital', label: 'SDA' },
    { name: 'SCL',  t: 0.88, color: 0x3b82f6, type: 'digital', label: 'SCL' },
  ]
  for (const { name, t, color, type, label } of pwrDefs) {
    const p = { x: 0, y: 0, z: 0 }
    p[longAxis] = longMin + longSpan * t
    p[medAxis]  = pwrRow
    p[thinAxis] = above
    pins[name] = { ...p, color, type, label }
  }

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

// ─── Waveshare 2.8" capacitive touch LCD (240×320, ST7789 + CST328) ─────────
// GLB first: public/models/tft28.glb (tools/models/tft28.model.js), authored in
// scene units in the same frame as TFT28_PINS — screen up, resting on its four
// standoffs at y = 0. The powered-off active area is the mesh 'lcd_active_area'.
export function createTft28Group() {
  const root = new THREE.Group()
  root.userData.labelScale = 0.36
  root.userData.labelOffset = { dx: 0, dy: 0.02, dz: 0.75 }
  root.userData.isTft = true
  const glb = cloneModel('tft28')
  if (glb) {
    root.add(glb)
    root.traverse(c => {
      if (!c.isMesh) return
      c.castShadow = true; c.receiveShadow = true
      // Outline only the big shells, not every resistor and solder joint.
      if (c.name !== 'pcb' && c.name !== 'touch_glass') c.userData.noOutline = true
    })
  } else {
    // Procedural stand-in with the real stack: glass 0.7 mm · LCD 2.9 · PCB 1.6 · rear parts 4.
    const glass = new THREE.Mesh(new THREE.BoxGeometry(5.054, 0.07, 7.306), mat(0x0b0c0e, { roughness: 0.06 }))
    glass.position.set(0, 0.965, 0); root.add(glass)
    const lcd = new THREE.Mesh(new THREE.BoxGeometry(4.94, 0.29, 6.98), mat(0x26272b))
    lcd.position.set(0, 0.785, -0.04); root.add(lcd)
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(4.99, 0.16, 6.9), mat(0x2457ac, { roughness: 0.65 }))
    pcb.position.set(0, 0.48, 0); root.add(pcb)
    const gh = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.39, 0.44), mat(0xece6d6))
    gh.position.set(0.095, 0.205, 2.8); root.add(gh)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 16), mat(0xd3d6db, { metalness: 0.8, roughness: 0.3 }))
      so.position.set(sx * 2.045, 0.2, sz * 3.0); root.add(so)
    }
    root.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
  }
  return root
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
