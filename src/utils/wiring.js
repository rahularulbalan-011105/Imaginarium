// Shared wiring vocabulary for every wiring view (Pick a Pin, Workbench, 3D).
//
// There is ONE connection list — electronicsStore.connections:
//   connId → { fromPinId: 'compId:PIN', toPinId: 'compId:PIN', color? }
// Every view reads and writes that list; nothing keeps its own copy. `color` is
// optional — without it a wire is coloured by its electrical role.
import { ESP32_PIN_NAMES } from './esp32Board.js'
import { L298N_PIN_ORDER } from './l298n.js'
import { ULN2003_PIN_ORDER, STEPPER_WIRES } from './stepper.js'
import { ENC_MOTOR_PIN_ORDER } from './encoderMotor.js'
import { PCA_PIN_ORDER } from './pca9685.js'
import { ELECTRONICS_TYPES } from './elecTypes.js'
import { partPinNames, onPartsRegistered } from '../parts/registry.js'

export const ELEC_TYPES = ELECTRONICS_TYPES   // utils/elecTypes.js

export const PIN_DEFS = {
  // L298N motor driver: motor outputs, power terminal, logic header (utils/l298n.js).
  l298n:    L298N_PIN_ORDER,
  // 28BYJ-48 stepper (wires by colour) and its ULN2003 driver (utils/stepper.js).
  stepper:  STEPPER_WIRES,
  uln2003:  ULN2003_PIN_ORDER,
  // PCA9685 servo driver: header (GND OE SCL SDA VCC V+) + PWM0…PWM15 (utils/pca9685.js).
  pca9685:  PCA_PIN_ORDER,
  // ESP32 pin names are derived from the board table (utils/esp32Board.js) so the
  // wiring UI and the 3D board can never drift apart.
  esp32:    ESP32_PIN_NAMES,
  // Full Uno R3 header (real silk order): digital D0–D13 + GND + SDA/SCL on top;
  // power (3V3 5V GND GND VIN) and analog A0–A5 along the bottom. SDA/SCL are
  // the same copper as A4/A5 (circuit/boards.js joins them).
  arduino:  [...Array.from({ length: 14 }, (_, i) => `D${i}`), 'GND3', 'SDA', 'SCL', '3V3', '5V', 'GND1', 'GND2', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
  // Official Subo IO header (Subo.h): IO1..IO21 + power rails. Matches SUBO_PIN_ORDER in
  // electronicsFactory so these map to the same pinIds as the 3D pin spheres.
  subo:     ['IO1','IO2','IO3','IO4','IO5','IO6','IO7','IO8','IO9','IO10','IO11','IO12','IO13','IO14','IO15','IO16','IO17','IO18','IO19','IO20','IO21','5V','GND1','GND2'],
  motor:    ['TERM_A','TERM_B'],
  motor_bo: ['TERM_A','TERM_B'],
  motor_dc: ['TERM_A','TERM_B'],
  motor_enc: ENC_MOTOR_PIN_ORDER,     // TT motor + Hall encoder (utils/encoderMotor.js)
  led:      ['ANODE','CATHODE'],
  servo:    ['SIGNAL','VCC','GND'],
  servo_cr: ['SIGNAL','VCC','GND'],   // continuous servo: same lead
  gripper:  ['SIGNAL','VCC','GND'],   // the gripper's servo lead
  ir_sensor:  ['OUT','GND','VCC'],
  ultrasonic: ['VCC','TRIG','ECHO','GND'],
  buzzer:     ['SIGNAL','GND'],
  oled:       ['GND','VCC','SCL','SDA'],
  gas_sensor: ['VCC','GND','DO','AO'],
  color_sensor: ['VCC','GND','S0','S1','S2','S3','OUT'],
  ldr_sensor:   ['VCC','GND','AO','DO'],
  dht11:        ['VCC','GND','DATA'],
  // Module sensors — header order as on the real boards (electronicsFactory MODULE_SENSOR_LAYOUT).
  pir_sensor:    ['VCC','OUT','GND'],
  flame_sensor:  ['VCC','GND','DO','AO'],
  soil_moisture: ['VCC','GND','DO','AO'],
  rain_sensor:   ['VCC','GND','DO','AO'],
  sound_sensor:  ['AO','GND','VCC','DO'],
  touch_sensor:  ['GND','OUT','VCC'],
  bmp280:        ['VCC','GND','SCL','SDA','CSB','SDO'],
  accelerometer: ['VCC','GND','SCL','SDA','XDA','XCL','AD0','INT'],
  gyroscope:     ['VCC','GND','SCL','SDA','XDA','XCL','AD0','INT'],
  hall_sensor:   ['GND','VCC','OUT'],
}

// Catalogue parts (src/parts) bring their own pin lists.
onPartsRegistered((p) => { PIN_DEFS[p.type] = partPinNames(p.type) })
/** Pin names for one scene object (catalogue parts may vary with their props). */
export function pinNamesFor(obj) { return (obj && partPinNames(obj.type, obj)) ?? PIN_DEFS[obj?.type] ?? [] }

/** 'power' | 'gnd' | 'signal' for a pin name. */
export function pinRole(pin) {
  if (/^(5V|3V3|3V|12V|VCC|VIN|V\+|ANODE|COM|RED|POS)$/i.test(pin)) return 'power'
  if (/^(GND\d*|CATHODE|NEG)$/i.test(pin)) return 'gnd'
  return 'signal'
}

export const ROLE_COLORS = { power: '#ef4444', gnd: '#1f2937' }
// Distinct signal colours (no red / near-black so they never read as power/ground).
export const SIGNAL_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#06b6d4', '#ec4899', '#eab308', '#14b8a6']
export const ROLE_LABEL = { power: 'Power', gnd: 'GND', signal: 'Signal' }

const pinOf = (pinId) => (pinId ?? '').split(':')[1] ?? ''
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

/** Electrical role of a connection: GND wins, then power, else signal. */
export function connectionRole(conn) {
  const roles = [pinRole(pinOf(conn.fromPinId)), pinRole(pinOf(conn.toPinId))]
  if (roles.includes('gnd')) return 'gnd'
  if (roles.includes('power')) return 'power'
  return 'signal'
}

/** { role, color, label } for a connection — the same answer in every view. */
export function wireStyle(connId, conn) {
  const role = connectionRole(conn)
  const color = conn.color || ROLE_COLORS[role] || SIGNAL_COLORS[hash(connId) % SIGNAL_COLORS.length]
  return { role, color, label: ROLE_LABEL[role] }
}

/** 'Arduino_1 · D9' for a pin id. */
export function friendlyPin(pinId, objects) {
  if (!pinId) return '?'
  const [compId, pin] = pinId.split(':')
  const comp = objects.find(o => o.id === compId)
  return `${comp?.name ?? compId} · ${pin}`
}

/** True if this exact pair is already wired (either direction). */
export function isDuplicate(connections, a, b) {
  return Object.values(connections).some(c =>
    (c.fromPinId === a && c.toPinId === b) || (c.fromPinId === b && c.toPinId === a))
}
