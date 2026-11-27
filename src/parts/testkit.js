// ─────────────────────────────────────────────────────────────────────────────
// Part test kit — runs a part's `tests` scenarios against the REAL simulation
// path (CircuitBridge → CircuitSim → MNA solver, the same objects the app uses
// while a sketch runs). A scenario builds a scene from part ids + wires, drives
// board pins the way a sketch would, steps time and checks what comes back.
//
//   kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 1000 } },
//             [['R:1', 'U:D13'], ['R:2', 'U:GND1']])
//   kit.pinMode(13, 'output'); kit.write(13, 1); kit.step(0.02)
//   kit.near(kit.state('R').current, 0.005, 1e-4)
//
// Assertions throw, so a scenario fails exactly when the behaviour is wrong.
// ─────────────────────────────────────────────────────────────────────────────
import { CircuitBridge } from '../circuit/simBridge.js'
import { buildPinToComponentMap } from '../stores/electronicsStore.js'
import { getPart, partDefaults } from './registry.js'
import { buildPartObject } from './buildPart.js'

export function createKit({ board = 'arduino' } = {}) {
  let objects = [], connections = {}, bridge = null
  const controls = {}, meshes = {}, issues = new Map(), serial = [], led = {}, motor = {}, beep = {}

  const kit = {
    get bridge() { return bridge },
    board,
    get objects() { return objects },
    serial, issues, led, motor, beep,
    servo: {},             // pin → last Servo.write() angle (sketchRunner)

    /** Build a scene: spec = { id: type | { type, ...props } }, wires = [['id:PIN', 'id:PIN'], …]. */
    scene(spec, wires = []) {
      objects = Object.entries(spec).map(([id, t]) => {
        const def = typeof t === 'string' ? { type: t } : t
        return { id, name: id, ...partDefaults(def.type), ...def }
      })
      connections = Object.fromEntries(wires.map(([a, b], i) => [`w${i}`, { fromPinId: a, toPinId: b }]))
      for (const o of objects) if (getPart(o.type)) meshes[o.id] = buildPartObject(getPart(o.type), o)
      bridge = new CircuitBridge({
        objects, connections, board,
        pinMap: buildPinToComponentMap(connections, objects),
        control: (id, key) => controls[`${id}:${key}`],
        hooks: {
          meshOf: (id) => meshes[id],
          led: (id, b) => { led[id] = b }, motor: (id, v) => { motor[id] = v }, beep: (id, on) => { beep[id] = on },
          issue: (k, i) => issues.set(k, i), resolve: (k) => issues.delete(k),
          serial: (t) => serial.push(t),
        },
      })
      return Object.fromEntries(objects.map(o => [o.id, o.id]))
    },
    mesh: (id) => meshes[id],
    pinMode(pin, mode) { bridge.sim.setPinMode(pin, mode) },
    write(pin, v) { bridge.writePin(pin, v ? 1 : 0, true) },
    analogWrite(pin, v) { bridge.writePin(pin, v, false) },
    shiftOut(data, clock, order, value) { bridge.shiftOut(data, clock, order === 'MSB' || order === 1 ? 1 : 0, value) },
    call(type, fn, args = []) { bridge.partCall(type, fn, args) },
    control(id, key, value) { controls[`${id}:${key}`] = value },
    /** Advance simulated time in ≤1/60 s frames (what the app does per animation frame). */
    step(seconds = 1 / 60) {
      let left = seconds
      do { const dt = Math.min(1 / 60, left); bridge.frame(dt); left -= dt } while (left > 1e-9)
    },
    digitalRead: (pin) => bridge.readDigital(pin),
    analogRead: (pin, full = 1023) => bridge.readAnalog(pin, full),
    pinVoltage: (pin) => bridge.sim.pinVoltage(pin),
    vpin: (id, pin) => bridge.sim.circuit.voltageOf(bridge.sim.nodeOf(`${id}:${pin}`)),
    state: (id) => bridge.sim.stateOf(id),
    partState: (id) => bridge.partState[id],
    input: () => bridge.input(),
    hasIssue: (fragment) => [...issues.keys()].some(k => k.includes(fragment)),

    // ── assertions ──────────────────────────────────────────────────────────
    ok(cond, msg = 'expected condition to hold') { if (!cond) throw new Error(msg) },
    equal(a, b, msg = '') { if (a !== b) throw new Error(`${msg ? msg + ': ' : ''}expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) },
    near(a, b, tol, msg = '') {
      if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg ? msg + ': ' : ''}expected ${b} ± ${tol}, got ${a}`)
    },
    between(a, lo, hi, msg = '') {
      if (!(a >= lo && a <= hi)) throw new Error(`${msg ? msg + ': ' : ''}expected ${lo} … ${hi}, got ${a}`)
    },
  }
  return kit
}
