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

  simulation: {
    running: false,
    motorSpeeds: {},   // motorComponentId → 0-255
    servoAngles: {},   // servoComponentId → 0-180
  },

  // objectId → motorId  (geometry objects physically attached to a motor's rotor shaft)
  attachments: {},

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
export function pinNameToNumber(pinName) {
  const m = pinName.match(/^D(\d+)$/)
  return m ? parseInt(m[1], 10) : null
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
