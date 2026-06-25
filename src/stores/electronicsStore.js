import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

const DEFAULT_CODE = `// Arduino Code
// Motor TERM_A connected to Pin ~3 (PWM)
// Motor TERM_B connected to GND

int motorPin = 3;

void setup() {
  pinMode(motorPin, OUTPUT);
}

void loop() {
  // Ramp up
  analogWrite(motorPin, 220);
  delay(2000);

  // Slow
  analogWrite(motorPin, 80);
  delay(1000);

  // Stop
  analogWrite(motorPin, 0);
  delay(1000);
}`

export const useElectronicsStore = create((set, get) => ({
  // connId → { fromPinId, toPinId }
  // e.g. "compA:D3→compB:TERM_A"
  connections: {},

  code: DEFAULT_CODE,

  // Serialized Blockly workspace (JSON) for the visual code editor
  blocksJson: null,

  simulation: {
    running: false,
    motorSpeeds: {},   // motorComponentId → 0-255
    servoAngles: {},   // servoComponentId → 0-180
  },

  // objectId → motorId  (geometry objects physically attached to a motor's rotor shaft)
  attachments: {},

  // Live sensor input values, set by the Sensor panel during simulation and read
  // by digitalRead / analogRead / pulseIn. Meaning depends on component type:
  //   ir_sensor → 0|1 (object detected) · gas_sensor → 0-1023 (analog) · ultrasonic → distance (cm)
  sensorValues: {},
  setSensorValue: (id, value) =>
    set(s => ({ sensorValues: { ...s.sensorValues, [id]: value } })),

  // Auto = IR/ultrasonic read the live distance to the nearest scene shape.
  // Manual = values come from the Sensor panel sliders/toggles.
  autoSense: true,
  setAutoSense: (v) => set({ autoSense: v }),

  // ── connections ──────────────────────────────────────────────────────────
  addWireConnection: (fromPinId, toPinId, connId) => {
    set(s => ({
      connections: { ...s.connections, [connId]: { fromPinId, toPinId } },
    }))
  },

  removeWireConnection: (connId) => {
    set(s => {
      const next = { ...s.connections }
      delete next[connId]
      return { connections: next }
    })
  },

  removeConnectionsFor: (componentId) => {
    set(s => {
      const next = {}
      for (const [id, c] of Object.entries(s.connections)) {
        if (!c.fromPinId.startsWith(componentId) && !c.toPinId.startsWith(componentId)) {
          next[id] = c
        }
      }
      return { connections: next }
    })
  },

  // ── attachments ───────────────────────────────────────────────────────────
  attachToMotor: (objectId, motorId) =>
    set(s => ({ attachments: { ...s.attachments, [objectId]: motorId } })),

  detachFromMotor: (objectId) => {
    if (!get().attachments[objectId]) return
    set(s => {
      const next = { ...s.attachments }
      delete next[objectId]
      return { attachments: next }
    })
  },

  detachAllForMotor: (motorId) =>
    set(s => {
      const next = {}
      for (const [id, mid] of Object.entries(s.attachments)) {
        if (mid !== motorId) next[id] = mid
      }
      return { attachments: next }
    }),

  clearAttachments: () => set({ attachments: {} }),

  // ── bulk restore (used when loading a saved project) ─────────────────────
  setConnections: (connections) => set({ connections }),
  setAttachments: (attachments) => set({ attachments }),

  // ── code ─────────────────────────────────────────────────────────────────
  setCode: (code) => set({ code }),
  setBlocksJson: (blocksJson) => set({ blocksJson }),

  // ── simulation ───────────────────────────────────────────────────────────
  setMotorSpeed: (motorId, speed) =>
    set(s => ({
      simulation: {
        ...s.simulation,
        motorSpeeds: { ...s.simulation.motorSpeeds, [motorId]: speed },
      },
    })),

  setServoAngle: (servoId, angle) =>
    set(s => ({
      simulation: {
        ...s.simulation,
        servoAngles: { ...s.simulation.servoAngles, [servoId]: angle },
      },
    })),

  startSimulation: () =>
    set(s => ({ simulation: { ...s.simulation, running: true } })),

  stopSimulation: () =>
    set(() => ({ simulation: { running: false, motorSpeeds: {}, servoAngles: {} } })),
}))

// ── Helpers for SimulationManager ────────────────────────────────────────────

// Extract pin number from a pinId like "compId:D3" → 3, "compId:GND1" → null
// SUBO board: silk label IOn → actual ESP32-S3 GPIO (from the Subo Arduino library)
export const SUBO_IO_TO_GPIO = {
  IO1: 4,  IO2: 39, IO3: 13, IO4: 38, IO5: 14, IO6: 48, IO7: 42,
  IO8: 5,  IO9: 41, IO10: 40, IO11: 6, IO12: 7, IO13: 15, IO14: 16,
  IO15: 17, IO16: 18, IO17: 8, IO18: 11, IO19: 10, IO20: 9, IO21: 3,
}
export const SUBO_ADC_IOS = new Set(['IO1', 'IO5', 'IO8', 'IO11', 'IO12', 'IO17', 'IO19', 'IO20', 'IO21'])

export function pinNameToNumber(pinName) {
  if (!pinName) return null
  const d = pinName.match(/^D(\d+)$/)
  if (d) return parseInt(d[1], 10)
  // SUBO IOn label → its GPIO number, so wiring to IOn maps the same as the code's pins
  if (pinName in SUBO_IO_TO_GPIO) return SUBO_IO_TO_GPIO[pinName]
  return null
}

// Terminals that indicate the component receives a signal (not GND/power returns)
const SIGNAL_TERMINALS = ['TERM', 'ANODE', 'SIGNAL']

// Given connections + scene objects, build pin-number → component lookup.
// For motors, `terminal` is 'A' (TERM_A) or 'B' (TERM_B).
// Net motor speed = TERM_A_value − TERM_B_value, so swapping connections reverses direction.
// Returns pin → [{ id, type, terminal }, ...] so multiple components on the same pin all fire.
export function buildPinToComponentMap(connections, objects) {
  const byId = {}
  for (const o of objects) byId[o.id] = o

  const map = {}   // pin → [{ id, type, terminal }]
  for (const { fromPinId, toPinId } of Object.values(connections)) {
    const pairs = [[fromPinId, toPinId], [toPinId, fromPinId]]
    for (const [a, b] of pairs) {
      const [, aPin] = a.split(':')
      const [bComp, bPin] = b.split(':')
      const pinNum = pinNameToNumber(aPin)
      if (pinNum === null) continue
      if (!SIGNAL_TERMINALS.some(t => bPin?.startsWith(t))) continue
      const bObj = byId[bComp]
      if (!bObj) continue
      // For motors, track which terminal so direction is determined by polarity.
      // TERM_A → positive contribution; TERM_B → negative contribution.
      const terminal = bPin === 'TERM_B' ? 'B' : 'A'
      if (!map[pinNum]) map[pinNum] = []
      if (!map[pinNum].some(c => c.id === bComp && c.terminal === terminal))
        map[pinNum].push({ id: bComp, type: bObj.type, terminal })
    }
  }
  return map
}

// Sensor components whose output pins feed a value back to the controller.
export const SENSOR_TYPES = new Set(['ir_sensor', 'ultrasonic', 'gas_sensor'])
const SENSOR_OUTPUT_PINS = ['OUT', 'DO', 'AO', 'ECHO', 'SIGNAL']

// pinNum → { id, type, pin } for any MCU pin wired to a SENSOR's output pin, so
// digitalRead/analogRead/pulseIn(pin) can return that sensor's live value.
export function buildSensorInputMap(connections, objects) {
  const byId = {}
  for (const o of objects) byId[o.id] = o
  const map = {}
  for (const { fromPinId, toPinId } of Object.values(connections)) {
    for (const [a, b] of [[fromPinId, toPinId], [toPinId, fromPinId]]) {
      const [, aPin] = a.split(':')
      const [bComp, bPin] = b.split(':')
      const pinNum = pinNameToNumber(aPin)
      if (pinNum === null) continue
      const bObj = byId[bComp]
      if (!bObj || !SENSOR_TYPES.has(bObj.type)) continue
      if (!SENSOR_OUTPUT_PINS.includes(bPin)) continue
      map[pinNum] = { id: bComp, type: bObj.type, pin: bPin }
    }
  }
  return map
}

// Legacy: motor-only map (kept for backward compat)
export function buildPinToMotorMap(connections) {
  const map = {}
  for (const { fromPinId, toPinId } of Object.values(connections)) {
    const pairs = [[fromPinId, toPinId], [toPinId, fromPinId]]
    for (const [a, b] of pairs) {
      const [, aPin] = a.split(':')
      const [bComp, bPin] = b.split(':')
      const pinNum = pinNameToNumber(aPin)
      if (pinNum !== null && bPin?.startsWith('TERM')) map[pinNum] = bComp
    }
  }
  return map
}
