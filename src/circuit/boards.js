// Electrical model of each controller board for the circuit solver: which
// header pins are supplies, which are ground, which are GPIO (and their number
// as the sketch sees it), and which pins are the same copper inside the board.
import { ESP32_PINS } from '../utils/esp32Board.js'
import { SUBO_IO_TO_GPIO } from '../stores/electronicsStore.js'

// Arduino Uno R3 (ATmega328P). Header names match PIN_DEFS.arduino.
export const UNO_DIGITAL = Array.from({ length: 14 }, (_, i) => `D${i}`)
export const UNO_ANALOG = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']
const UNO = {
  vlogic: 5,
  supplies: { '5V': 5, '3V3': 3.3 },
  ground: ['GND1', 'GND2', 'GND3'],
  // SDA/SCL beside AREF are wired to A4/A5 on the board; the three GND pins are one plane.
  internal: [['GND1', 'GND2', 'GND3'], ['SDA', 'A4'], ['SCL', 'A5']],
  io: { ...Object.fromEntries(UNO_DIGITAL.map((n, i) => [n, i])), ...Object.fromEntries(UNO_ANALOG.map((n, i) => [n, 14 + i])) },
}

const ESP32 = (() => {
  const io = {}, ground = []
  for (const p of ESP32_PINS) {
    if (p.gpio != null && p.kind !== 'power') io[p.name] = p.gpio
    if (p.kind === 'gnd') ground.push(p.name)
  }
  return { vlogic: 3.3, supplies: { '3V3': 3.3, VIN: 5 }, ground, internal: [ground], io }
})()

const SUBO = {
  vlogic: 3.3,
  supplies: { '5V': 5 },
  ground: ['GND1', 'GND2'],
  internal: [['GND1', 'GND2']],
  io: { ...SUBO_IO_TO_GPIO },
}

// ATtiny85 (DIP-8, catalogue part src/parts/catalog/mcu/attiny85.part.js). It
// has no regulator or USB: its logic level IS whatever its VCC pin receives
// (2.7–5.5 V), so `vccPin` makes every output and threshold follow that net.
const ATTINY85 = {
  vlogic: 5,
  vccPin: 'VCC',
  supplies: {},
  ground: ['GND'],
  internal: [],
  io: { PB0: 0, PB1: 1, PB2: 2, PB3: 3, PB4: 4, PB5: 5 },
}

// BBC micro:bit V2 (nRF52833) as an Arduino-nRF5 board (docs/MICROBIT_RUNTIME.md,
// option A). USB-powered: the 3V pad is the on-board 3.3 V regulator output.
// Arduino pin n = edge-connector Pn (the nRF5 core's micro:bit variant).
const MICROBIT = {
  vlogic: 3.3,
  supplies: { '3V': 3.3 },
  ground: ['GND'],
  internal: [],
  io: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`P${i}`, i])),
}

const MODELS = { arduino: UNO, esp32: ESP32, subo: SUBO, attiny85: ATTINY85, microbit: MICROBIT }
export function boardModel(obj) { return MODELS[obj?.type] ?? null }
export const BOARD_TYPES = new Set(Object.keys(MODELS))
