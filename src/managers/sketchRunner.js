// The ONE "Run ▶" path for C++ sketches: compile-check → enter the simulator if
// the robot has actuators → start the sketch. Used by the Code panel and by the
// MCP bridge (src/mcp/), so a sketch Claude runs behaves exactly like one the
// user runs, and both see the same Serial output.
//
// Serial output and runtime errors go to a small bus instead of React state, so
// whoever is listening (the Code panel's monitor, the MCP get_serial tool) gets
// them no matter who pressed Run.
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { simulationManager } from './SimulationManager.js'
import { objectManager } from './ObjectManager.js'
import { analyzeArduino } from '../utils/arduinoDiagnostics.js'
import { enterSimForCode } from './simForCode.js'

const SERIAL_CAP = 8000
let serial = ''
let runtimeError = null
const listeners = new Set()
const emit = () => { for (const fn of listeners) fn({ serial, runtimeError }) }

/** Subscribe to { serial, runtimeError } changes. Returns an unsubscribe. */
export function onSketchOutput(fn) { listeners.add(fn); return () => listeners.delete(fn) }
export function getSketchOutput() { return { serial, runtimeError } }
export function clearSketchOutput() { serial = ''; runtimeError = null; emit() }

/** The board a sketch is compiled for: ESP32 › SUBO › Arduino (as the Code panel picks it). */
export function currentBoard(objects = useSceneStore.getState().objects) {
  if (objects.some((o) => o.type === 'esp32')) return 'esp32'
  if (objects.some((o) => o.type === 'subo')) return 'subo'
  return 'arduino'
}

let starting = false

/**
 * Compile-check and run `code` (default: the code in the editor).
 * Resolves to { ok, report, error? }. When the analyzer finds blocking errors
 * nothing runs and ok is false — the report carries the diagnostics.
 */
export async function runSketch(code = useElectronicsStore.getState().code) {
  if (starting) return { ok: false, error: 'A run is already starting.' }
  serial = ''; runtimeError = null; emit()
  window.dispatchEvent(new Event('constructa:code-run'))   // → community popup + code_run analytics (App listener)

  const report = analyzeArduino(code, { board: currentBoard() })
  if (!report.ok) return { ok: false, report }

  // A robot only moves under the simulator — enter it first (no-op when it's
  // already on, or when the scene has no servos/motors).
  starting = true
  try { await enterSimForCode() } finally { starting = false }

  const es = useElectronicsStore.getState()
  simulationManager.configure(
    es.connections,
    useSceneStore.getState().objects,
    es.setMotorSpeed,
    (errMsg) => { runtimeError = errMsg; emit(); useElectronicsStore.getState().stopSimulation() },
    (output) => {
      serial += output
      if (serial.length > SERIAL_CAP) serial = serial.slice(serial.length - SERIAL_CAP)
      emit()
    },
    (ledId, brightness) => objectManager.animateLed(ledId, brightness),
    (servoId, angle) => useElectronicsStore.getState().setServoAngle(servoId, angle),
  )

  const err = simulationManager.start(code)
  if (err) return { ok: false, report, error: err.error }
  useElectronicsStore.getState().startSimulation()
  return { ok: true, report }
}

/** Stop the running sketch (the simulator itself stays as it is, like the Stop button). */
export function stopSketch() {
  simulationManager.stop()
  objectManager.resetAllLeds()
  useElectronicsStore.getState().stopSimulation()
  runtimeError = null; emit()
}
