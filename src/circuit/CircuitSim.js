// ─────────────────────────────────────────────────────────────────────────────
// CircuitSim — turns the scene's parts + wires into an MNA circuit and runs it.
//
//   nets      union-find over electronicsStore.connections ('compId:PIN' pairs)
//             plus each part's INTERNAL joins (breadboard rows, the two legs of
//             a pushbutton that are always connected, a board's GND pins …)
//   ground    the net of any board GND pin is node 0 (a sketch's 0 V)
//   boards    5V / 3V3 are supply sources; every IO pin is a live element whose
//             behaviour follows the sketch: OUTPUT drives Vlogic·duty through
//             the pin's ~25 Ω output resistance, INPUT is high impedance,
//             INPUT_PULLUP is a 35 kΩ resistor to Vlogic (the AVR's real
//             20–50 kΩ pull-up). analogWrite is PWM; the solver sees its average.
//   parts     each catalogue part with sim.circuit stamps its elements; the
//             legacy LED / motors / buzzer get circuit models from
//             legacyAdapters.js so they also work behind a resistor/transistor.
//
// It is ACTIVE only when the scene holds at least one circuit-modelled part
// that is not just a legacy part wired straight to a pin; otherwise every call
// is a no-op and the older direct pin→component path behaves exactly as before.
// ─────────────────────────────────────────────────────────────────────────────
import { Circuit, vsource, resistor } from './mna.js'
import { getPart } from '../parts/registry.js'
import { internalOf, propOf } from '../parts/definePart.js'
import { LEGACY_ADAPTERS } from './legacyAdapters.js'
import { boardModel } from './boards.js'

const PIN_R_OUT = 25            // Ω  ATmega328P output resistance (≈ (5−4.2 V)/20 mA … 40 Ω)
const PULLUP_R = 35000          // Ω  ATmega328P internal pull-up (datasheet 20–50 kΩ)
const MAX_SUBSTEPS = 1200        // ≈14 µs steps at 60 fps: enough points per period for a 1–2 kHz source
const DEFAULT_MAX_DT = 1e-4     // s  transient step when reactive / time-varying parts exist
const PWM_PHASES = 16           // DC circuits with PWM: solves per frame across one PWM cycle

/**
 * Averages parts' solved() states over several solves: numbers are averaged,
 * booleans become true when true for at least half the samples, anything else
 * keeps its last value. Nested objects are averaged field by field.
 */
class StateAverager {
  constructor() { this.n = 0; this.sum = null }
  add(states) { this.n++; this.sum = merge(this.sum, states) }
  result() { return finish(this.sum, this.n) ?? {} }
}
// Tally nodes: { num: sum } · { bool: trueCount } · { obj: {field: node} } · { last: value }.
function merge(acc, v) {
  if (typeof v === 'number') return { num: (acc?.num ?? 0) + v }
  if (typeof v === 'boolean') return { bool: (acc?.bool ?? 0) + (v ? 1 : 0) }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = acc?.obj ?? {}
    for (const [k, x] of Object.entries(v)) o[k] = merge(o[k], x)
    return { obj: o }
  }
  return { last: v }
}
function finish(node, n) {
  if (!node) return node
  if ('num' in node) return node.num / n
  if ('bool' in node) return node.bool * 2 >= n
  if ('obj' in node) return Object.fromEntries(Object.entries(node.obj).map(([k, x]) => [k, finish(x, n)]))
  return node.last
}

class UnionFind {
  constructor() { this.p = new Map() }
  find(a) {
    if (!this.p.has(a)) this.p.set(a, a)
    let r = a
    while (this.p.get(r) !== r) r = this.p.get(r)
    let x = a
    while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n }
    return r
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb) }
}

/** Nets of a wiring: Map(pinId → netRoot). Exported for the breadboard / net tests. */
export function buildNets(objects, connections) {
  const uf = new UnionFind()
  for (const { fromPinId, toPinId } of Object.values(connections ?? {})) {
    if (fromPinId && toPinId) uf.union(fromPinId, toPinId)
  }
  for (const o of objects) {
    const part = getPart(o.type)
    const groups = part ? internalOf(part, o) : (boardModel(o)?.internal ?? [])
    for (const g of groups) for (let i = 1; i < g.length; i++) uf.union(`${o.id}:${g[0]}`, `${o.id}:${g[i]}`)
  }
  return uf
}

export class CircuitSim {
  /**
   * @param {object} o
   * @param {object[]} o.objects      scene objects
   * @param {object}   o.connections  electronicsStore.connections
   * @param {(id:string,key:string)=>any} [o.control]   live UI control value (button pressed …)
   * @param {Set<string>} [o.directIds]  legacy parts already driven straight from a pin
   */
  constructor({ objects, connections, control = () => undefined, directIds = new Set() }) {
    this.objects = objects
    this.connections = connections
    this.control = control
    this.directIds = directIds
    this.pins = new Map()           // pinNum → { mode, duty, wroteWithoutMode, el, node, board }
    this.parts = []                 // { obj, part, handles, adapter }
    this.states = {}                // objId → last solved() state
    this.issues = new Map()         // key → { severity, title, detail }
    this.time = 0
    this.active = false
    this._build()
  }

  // ── construction ───────────────────────────────────────────────────────────
  _build() {
    const { objects, connections } = this
    const circuitObjs = objects.filter(o => getPart(o.type)?.sim?.circuit || LEGACY_ADAPTERS[o.type])
    // Any catalogue part (even a breadboard, which only joins nets) turns the
    // solver on; a legacy-only scene keeps the direct pin path untouched.
    const anyCatalog = objects.some(o => getPart(o.type))
    if (!anyCatalog) return
    this.active = true

    const uf = buildNets(objects, connections)
    this.uf = uf
    const c = this.circuit = new Circuit()
    const nodeOfRoot = new Map()

    // Ground: every board GND net (and, with no board, a power part's − terminal).
    const boards = objects.map(o => ({ o, m: boardModel(o) })).filter(b => b.m)
    const groundRoots = new Set()
    for (const { o, m } of boards) for (const g of m.ground) groundRoots.add(uf.find(`${o.id}:${g}`))
    if (!groundRoots.size) {
      for (const o of circuitObjs) {
        const gp = getPart(o.type)?.groundPin
        if (gp) { groundRoots.add(uf.find(`${o.id}:${gp}`)); break }
      }
    }
    this.groundRoots = groundRoots
    const nodeOf = (pinId) => {
      const r = uf.find(pinId)
      if (groundRoots.has(r)) return 0
      if (!nodeOfRoot.has(r)) nodeOfRoot.set(r, c.node())
      return nodeOfRoot.get(r)
    }
    this.nodeOf = nodeOf

    // Boards: supply pins + live IO pins.
    for (const { o, m } of boards) {
      for (const [pinName, volts] of Object.entries(m.supplies)) c.add(vsource(nodeOf(`${o.id}:${pinName}`), 0, volts, 0.05))
      for (const [pinName, pinNum] of Object.entries(m.io)) {
        const node = nodeOf(`${o.id}:${pinName}`)
        if (this.pins.has(pinNum)) continue
        const st = { pinNum, node, mode: 'input', duty: 0, vlogic: m.vlogic, wroteWithoutMode: false, board: o.id, boardType: o.type, pinName,
          vccNode: m.vccPin ? nodeOf(`${o.id}:${m.vccPin}`) : null }
        this.pins.set(pinNum, st)
        st.el = c.add(this._pinElement(st))
      }
    }

    // Parts.
    for (const o of circuitObjs) {
      const part = getPart(o.type)
      const adapter = part ? null : LEGACY_ADAPTERS[o.type]
      const def = part?.sim ?? adapter
      const api = this._buildApi(o, part, nodeOf)
      let handles = null
      try { handles = def.circuit(api) ?? {} } catch (e) {
        this._issue(`build:${o.id}`, 'error', `${o.name || o.type} could not be simulated`, String(e?.message ?? e))
        continue
      }
      this.parts.push({ obj: o, part, def, api, handles, adapter: !!adapter })
    }
    // A part may set its step per object (handles.maxDt, e.g. from a generator's frequency) or per type.
    this.maxDt = Math.min(DEFAULT_MAX_DT, ...this.parts.map(p => p.handles?.maxDt ?? p.def.maxDt ?? Infinity))
    this.transient = this.parts.some(p => p.def.transient || p.handles?.transient) ||
      c.elements.some(e => e.kind === 'C' || e.kind === 'L')
    this._solveDC()
  }

  _buildApi(o, part, nodeOf) {
    const self = this, c = this.circuit
    return {
      obj: o,
      prop: (k) => (part ? propOf(part, o, k) : o[k]),
      pin: (name) => nodeOf(`${o.id}:${name}`),
      node: () => c.node(),
      add: (el) => c.add(el),
      control: (k) => self.control(o.id, k),
      get t() { return self.circuit.t },
      v: (node) => self.circuit.voltageOf(node),
      vpin: (name) => self.circuit.voltageOf(nodeOf(`${o.id}:${name}`)),
      cur: (el) => (el?.currentOf ? el.currentOf({ v: (n) => self.circuit.voltageOf(n), brI: (e, k = 0) => self.circuit.branchCurrent(e.branchBase + k), dt: self._dt ?? 0 }, el) : 0),
      issue: (key, severity, title, detail) => self._issue(`${o.id}:${key}`, severity, title, detail),
      clearIssue: (key) => self.issues.delete(`${o.id}:${key}`),
      connected: (name) => self._pinConnected(o.id, name),
      /** PWM duty (0…1) of the board OUTPUT pin driving this part pin's net, else null. */
      duty: (name) => {
        const root = self.uf.find(`${o.id}:${name}`)
        for (const st of self.pins.values()) if (st.mode === 'output' && self.uf.find(`${st.board}:${st.pinName}`) === root) return st.duty
        return null
      },
      /** Board pin number this part pin is wired to (directly or through a breadboard), else null. */
      boardPin: (name) => {
        const root = self.uf.find(`${o.id}:${name}`)
        for (const st of self.pins.values()) if (self.uf.find(`${st.board}:${st.pinName}`) === root) return st.pinNum
        return null
      },
    }
  }

  _pinConnected(objId, pinName) {
    const id = `${objId}:${pinName}`
    for (const { fromPinId, toPinId } of Object.values(this.connections ?? {})) if (fromPinId === id || toPinId === id) return true
    // joined to something through an internal group (breadboard hole → row)
    return false
  }

  /** A board IO pin as an element whose stamp follows the pin's live mode. */
  _pinElement(st) {
    const sim = this
    return {
      kind: 'PIN', nodes: [st.node],
      // A chip powered from its own VCC pin (ATtiny85) drives its outputs from
      // that rail, so the pin depends on another node: solve it iteratively.
      nonlinear: st.vccNode != null,
      stamp(sys, ctx) {
        if (st.vccNode != null) st.vlogic = Math.max(0, ctx.v(st.vccNode))
        if (st.mode === 'output') {
          const g = 1 / PIN_R_OUT
          sys.conductance(st.node, 0, g)
          sys.current(0, st.node, st.vlogic * sim._pwmLevel(st) * g)
        } else if (st.mode === 'pullup') {
          const g = 1 / PULLUP_R
          sys.conductance(st.node, 0, g)
          sys.current(0, st.node, st.vlogic * g)
        } else if (st.mode === 'pulldown') {
          sys.conductance(st.node, 0, 1 / 45000)
        } else {
          // 'input': high impedance. The ATmega's input leakage (≤1 µA) is
          // modelled as 10 MΩ to ground, so a truly floating pin settles LOW
          // instead of following whatever an open switch's leakage reaches.
          sys.conductance(st.node, 0, 1e-7)
        }
      },
      currentOf(ctx) {     // current OUT of the pin into the circuit
        const v = ctx.v(st.node)
        if (st.mode === 'output') return (st.vlogic * sim._pwmLevel(st) - v) / PIN_R_OUT
        if (st.mode === 'pullup') return (st.vlogic - v) / PULLUP_R
        return 0
      },
    }
  }

  /**
   * Output level (0…1) of a pin right now. A PWM pin (0 < duty < 1) is either
   * fully HIGH or LOW, as on hardware:
   *   • transient circuits: switched by simulated time at the pin's real PWM
   *     frequency (Uno: 980 Hz on pins 5/6, 490 Hz elsewhere), so filters,
   *     motors and LEDs see the actual waveform;
   *   • DC circuits: by the sampling phase set in step() (the frame is solved at
   *     PWM_PHASES phases and the parts' results averaged).
   * Averaging the VOLTAGE instead would be wrong for any nonlinear load — an LED
   * at 50 % duty would see 2.5 V and stay nearly dark instead of half-lit.
   */
  _pwmLevel(st) {
    const d = st.duty
    if (!(d > 0)) return 0
    if (d >= 1) return 1
    if (this._phase != null) return this._phase < d ? 1 : 0
    if (this._tNow != null) {
      const hz = st.boardType === 'arduino' && (st.pinNum === 5 || st.pinNum === 6) ? 980 : 490
      const ph = (this._tNow * hz) % 1
      return ph < d ? 1 : 0
    }
    return d
  }
  _pwmActive() {
    for (const st of this.pins.values()) if (st.mode === 'output' && st.duty > 0 && st.duty < 1) return true
    return false
  }

  _issue(key, severity, title, detail) { this.issues.set(key, { severity, title, detail }) }

  // ── sketch → pins ──────────────────────────────────────────────────────────
  /** pinMode(pin, mode): mode is 'output' | 'input' | 'pullup' | 'pulldown'. */
  setPinMode(pinNum, mode) {
    const st = this.pins.get(Number(pinNum))
    if (!st) return
    st.mode = mode
    st.explicit = true
  }
  /** digitalWrite / analogWrite: duty 0…1. */
  writePin(pinNum, duty, { analog = false } = {}) {
    const st = this.pins.get(Number(pinNum))
    if (!st) return
    if (analog) st.mode = 'output'                       // analogWrite() sets OUTPUT itself
    if (st.mode === 'output') st.duty = Math.max(0, Math.min(1, duty))
    else if (!analog) {
      // digitalWrite on an INPUT pin toggles the internal pull-up — real AVR
      // behaviour, and the classic "my LED is very dim" bug.
      st.mode = duty > 0 ? 'pullup' : 'input'
      if (duty > 0 && !st.warned) {
        st.warned = true
        this._issue(`pin:${pinNum}:nomode`, 'warning', `Pin ${st.pinName} is written without pinMode(${st.pinName.replace(/^D/, '')}, OUTPUT)`,
          'The pin is still an INPUT, so digitalWrite(HIGH) only turns on its weak internal pull-up (≈35 kΩ). Anything it powers gets almost no current. Add pinMode(pin, OUTPUT) in setup().')
      }
    }
  }

  // ── stepping ───────────────────────────────────────────────────────────────
  _beforeStep(dt) {
    for (const p of this.parts) p.def.beforeStep?.(p.handles, p.api, dt)
  }
  _solveDC() {
    this._dt = 0
    this._beforeStep(0)
    // Source-stepping fallback: if Newton fails from cold, ramp the circuit up.
    if (!this.circuit.step(0)) {
      this._issue('solver:dc', 'warning', 'The circuit is hard to solve', 'Newton iterations did not converge at start-up; check for a supply shorted straight to ground.')
    }
    this._afterSolve()
  }
  /** Advance the circuit by one animation frame of `frameDt` seconds. */
  step(frameDt) {
    if (!this.active) return
    const dt = Math.max(0, Math.min(0.1, frameDt || 0))
    // With PWM running, every part's result is averaged over the PWM cycle
    // (what an eye, a meter or a motor's inertia integrates).
    const pwm = this._pwmActive()
    const acc = pwm ? new StateAverager() : null
    if (this.transient && dt > 0) {
      const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / this.maxDt)))
      const h = dt / n
      this._dt = h
      for (let i = 0; i < n; i++) {
        this._tNow = this.circuit.t + h
        this._beforeStep(h); this.circuit.step(h); for (const p of this.parts) p.def.afterStep?.(p.handles, p.api, h)
        if (acc) acc.add(this._solvedStates())
      }
      this._tNow = null
    } else if (pwm) {
      this._dt = 0
      for (let k = 0; k < PWM_PHASES; k++) {
        this._phase = (k + 0.5) / PWM_PHASES
        this._beforeStep(dt); this.circuit.step(0)
        acc.add(this._solvedStates())
      }
      this._phase = null
      this.circuit.t += dt
    } else {
      this._dt = 0
      this._beforeStep(dt)
      this.circuit.step(0)
      this.circuit.t += dt
    }
    this.time += dt
    if (!this.circuit.converged) this._issue('solver:nc', 'warning', 'The circuit did not settle this frame', 'The solver could not converge; results may lag by a frame.')
    else this.issues.delete('solver:nc')
    this._afterSolve(acc ? acc.result() : null)
  }
  /** Every part's solved() state now (legacy parts driven straight from a pin skipped). */
  _solvedStates() {
    const out = {}
    for (const p of this.parts) {
      if (p.adapter && this.directIds.has(p.obj.id)) continue
      try { out[p.obj.id] = p.def.solved?.(p.handles, p.api) ?? null }
      catch (e) { this._issue(`solve:${p.obj.id}`, 'error', `${p.obj.name || p.obj.type} failed in simulation`, String(e?.message ?? e)) }
    }
    return out
  }
  _afterSolve(averaged = null) {
    Object.assign(this.states, averaged ?? this._solvedStates())
    // A chip powered through its own VCC pin (ATtiny85) must see 2.7–5.5 V.
    const checked = new Set()
    for (const st of this.pins.values()) {
      if (st.vccNode == null || checked.has(st.board)) continue
      checked.add(st.board)
      const v = this.circuit.voltageOf(st.vccNode), key = `board:${st.board}:vcc`
      if (v < 2.7) this._issue(key, 'error', `ATtiny85 is not powered (VCC ${v.toFixed(2)} V)`,
        'The ATtiny85 has no USB power: wire its VCC pin (8) to a 2.7–5.5 V supply and GND (4) to the supply’s negative. Below 2.7 V it does not run reliably.')
      else if (v > 5.5) this._issue(key, 'error', `ATtiny85 VCC is ${v.toFixed(2)} V — above its 5.5 V limit`,
        'The datasheet maximum operating voltage is 5.5 V (6 V absolute). Use 3 × AA (4.5 V) or a 5 V supply, not 4 × AA or 9 V.')
      else this.issues.delete(key)
    }
    // Board pin over-current: an ATmega328P pin is rated 40 mA absolute maximum.
    for (const st of this.pins.values()) {
      const i = Math.abs(st.el.currentOf({ v: (n) => this.circuit.voltageOf(n) }))
      const key = `pin:${st.pinNum}:overcurrent`
      if (i > 0.040) this._issue(key, 'error', `Pin ${st.pinName} is supplying ${(i * 1000).toFixed(0)} mA`,
        'An Arduino pin can supply at most 40 mA (20 mA recommended). Add a series resistor (220 Ω for an LED) or drive the load through a transistor.')
      else this.issues.delete(key)
    }
  }

  // ── pins → sketch ──────────────────────────────────────────────────────────
  hasPin(pinNum) { return this.active && this.pins.has(Number(pinNum)) }
  /** Voltage on a board pin (V), or null when that pin is not part of the circuit. */
  pinVoltage(pinNum) {
    const st = this.pins.get(Number(pinNum))
    return st ? this.circuit.voltageOf(st.node) : null
  }
  /** digitalRead with real CMOS thresholds (≤0.3·Vcc LOW, ≥0.6·Vcc HIGH, hysteresis between). */
  digitalRead(pinNum) {
    const st = this.pins.get(Number(pinNum))
    if (!st) return null
    const v = this.circuit.voltageOf(st.node)
    if (v >= 0.6 * st.vlogic) st.last = 1
    else if (v <= 0.3 * st.vlogic) st.last = 0
    return st.last ?? 0
  }
  /** analogRead: 10-bit (AVR) or 12-bit (ESP32) of the pin voltage against Vref = Vlogic. */
  analogRead(pinNum, full = 1023) {
    const st = this.pins.get(Number(pinNum))
    if (!st) return null
    const v = this.circuit.voltageOf(st.node)
    return Math.max(0, Math.min(full, Math.round((v / st.vlogic) * full)))
  }
  /** Voltage between two arbitrary pin ids ('id:PIN'), for instruments. */
  voltageBetween(a, b) {
    if (!this.active) return 0
    return this.circuit.voltageOf(this.nodeOf(a)) - this.circuit.voltageOf(this.nodeOf(b))
  }
  stateOf(id) { return this.states[id] ?? null }
}
