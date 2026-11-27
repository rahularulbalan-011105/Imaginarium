// ─────────────────────────────────────────────────────────────────────────────
// simBridge — connects CircuitSim and catalogue parts to SimulationManager.
//
// SimulationManager stays the owner of the run; this module adds exactly five
// hooks to it (see the calls marked "circuit bridge" there):
//   writePin / pinMode      sketch → board pins
//   readDigital / readAnalog board pins → sketch (null = not a circuit pin)
//   frame(dt)               once per animation frame: step the solver, push the
//                           solved state into each part's 3D model, report issues
//   partCall                a catalogue part's sandbox library → its handler
//   stop                    reset every part's model to its powered-off look
// ─────────────────────────────────────────────────────────────────────────────
import { CircuitSim } from './CircuitSim.js'
import { getPart, allParts } from '../parts/registry.js'
import { propOf } from '../parts/definePart.js'
import { BOARD_TYPES } from './boards.js'

// pinMode() mode numbers as the sketch's constants define them, per board.
const MODE_OF = {
  arduino: { 0: 'input', 1: 'output', 2: 'pullup' },
  subo:    { 0: 'input', 1: 'output', 2: 'pullup' },
  esp32:   { 0: 'input', 1: 'output', 5: 'pullup', 9: 'pulldown', 2: 'pullup' },
  attiny85: { 0: 'input', 1: 'output', 2: 'pullup' },
  microbit: { 0: 'input', 1: 'output', 2: 'pullup' },
}

export class CircuitBridge {
  /**
   * @param {object} o
   * @param {object[]} o.objects  @param {object} o.connections
   * @param {object} o.pinMap     SimulationManager's direct pin→component map
   * @param {string} o.board      'arduino' | 'esp32' | 'subo'
   * @param {(id,key)=>any} o.control  UI control values (sensorValues)
   * @param {object} o.hooks      { meshOf(id), led(id,b), motor(id,speed), beep(id,on), issue(key,i), clearIssues(), serial(text) }
   */
  constructor({ objects, connections, pinMap, board, control, hooks }) {
    this.objects = objects
    this.board = board
    this.hooks = hooks
    this.control = control
    const directIds = new Set()
    for (const comps of Object.values(pinMap ?? {})) for (const c of comps) directIds.add(c.id)
    this.sim = new CircuitSim({ objects, connections, control, directIds })
    this.directIds = directIds
    this.partState = {}                  // objId → per-run part state (library calls write here)
    this.catalog = objects.filter(o => getPart(o.type))
    this._reported = new Set()
    for (const o of this.catalog) {
      const part = getPart(o.type)
      this.partState[o.id] = part.sim.initState?.(o) ?? {}
    }
  }
  get active() { return this.sim.active || this.catalog.length > 0 }

  // ── sketch → pins ──────────────────────────────────────────────────────────
  pinMode(pin, modeNum) {
    const mode = MODE_OF[this.board]?.[Number(modeNum)] ?? 'input'
    this.sim.setPinMode(pin, mode)
  }
  writePin(pin, value, isDigital) {
    if (!this.sim.hasPin(pin)) return
    const duty = isDigital ? (value ? 1 : 0) : Math.max(0, Math.min(255, Number(value) || 0)) / 255
    this.sim.writePin(pin, duty, { analog: !isDigital })
    // Digital ICs react to the EDGE immediately (latch, clock, enable) — not a
    // frame later, when the sketch may already have toggled the pin back.
    const level = duty >= 0.5 ? 1 : 0
    const st = this.sim.pins.get(Number(pin))
    if (st && st.lastLevel !== level) { st.lastLevel = level; this.pinEvent(Number(pin), level) }
  }

  /** Every catalogue part with sim.onPin sees the edge; all sample, then all commit. */
  pinEvent(pin, level) {
    const commits = []
    for (const o of this.catalog) {
      const part = getPart(o.type)
      if (!part.sim.onPin) continue
      const c = part.sim.onPin(this._partApi(o), { pin, level })
      if (typeof c === 'function') commits.push(c)
    }
    for (const c of commits) c()
  }
  /** shiftOut(data, clock, order, value) from the sketch — 8 clocked bits at once. */
  shiftOut(data, clock, order, value) {
    const bits = []
    for (let i = 0; i < 8; i++) bits.push(Number(order) === 1 ? (value >> (7 - i)) & 1 : (value >> i) & 1)
    for (const b of bits) {
      // Each bit: data settles, then a rising clock edge (two-phase across chips).
      const commits = []
      for (const o of this.catalog) {
        const part = getPart(o.type)
        if (!part.sim.onClockBit) continue
        const c = part.sim.onClockBit(this._partApi(o), { data: Number(data), clock: Number(clock), bit: b })
        if (typeof c === 'function') commits.push(c)
      }
      for (const c of commits) c()
    }
  }

  // ── pins → sketch ──────────────────────────────────────────────────────────
  readDigital(pin) { return this.sim.hasPin(pin) ? this.sim.digitalRead(pin) : null }
  readAnalog(pin, full) { return this.sim.hasPin(pin) ? this.sim.analogRead(pin, full) : null }
  circuitPins() { return this.sim.active ? [...this.sim.pins.keys()] : [] }

  // ── a catalogue part's library call from the sandbox ───────────────────────
  partCall(type, fn, args) {
    if (type === '*i2c') { this._i2cWrite(args); return }
    const part = getPart(type)
    const handler = part?.sim?.calls?.[fn]
    if (!handler) return
    // A library call targets every part of that type it is wired to; the
    // handler gets each candidate and decides (e.g. LCD by its RS/EN pins).
    for (const o of this.catalog) {
      if (o.type !== type) continue
      handler(args, this._partApi(o))
    }
  }
  _partApi(o) {
    const part = getPart(o.type), self = this
    return {
      obj: o, state: this.partState[o.id], prop: (k) => propOf(part, o, k),
      control: (k) => self.control(o.id, k),
      solved: () => self.sim.stateOf(o.id),
      vpin: (name) => (self.sim.active ? self.sim.circuit.voltageOf(self.sim.nodeOf(`${o.id}:${name}`)) : 0),
      /** Board pin number a part pin is wired to (direct wire or via breadboard), else null. */
      boardPin: (name) => self._boardPinOf(o.id, name),
      /** Logic level (0/1) on the net of this part's pin. */
      level: (name) => self.netLevel(o.id, name),
      /** Other catalogue parts whose pin `theirPin` shares a net with our `name`. */
      peers: (name, type, theirPin) => self._peers(o.id, name, type, theirPin),
      serial: (t) => self.hooks.serial?.(t),
      // Library-level parts can raise / clear their own simulation issues too.
      issue: (key, severity, title, detail) => self.sim._issue(`${o.id}:${key}`, severity, title, detail),
      clearIssue: (key) => self.sim.issues.delete(`${o.id}:${key}`),
    }
  }
  /**
   * Logic level on the net of a part pin. Priority: a board pin driving it as
   * OUTPUT → another part that DRIVES that net (sim.drives) → the solved voltage
   * against half its supply. Floating CMOS inputs read LOW.
   */
  netLevel(objId, pinName) {
    if (!this.sim.active) return 0
    const root = this.sim.uf.find(`${objId}:${pinName}`)
    for (const st of this.sim.pins.values()) {
      if (st.mode === 'output' && this.sim.uf.find(`${st.board}:${st.pinName}`) === root) return st.duty >= 0.5 ? 1 : 0
    }
    for (const o of this.catalog) {
      const part = getPart(o.type)
      const drv = part.sim.drives?.(this.partState[o.id], o)
      if (!drv) continue
      for (const [pn, lv] of Object.entries(drv)) if (lv != null && this.sim.uf.find(`${o.id}:${pn}`) === root) return lv ? 1 : 0
    }
    const v = this.sim.circuit.voltageOf(this.sim.nodeOf(`${objId}:${pinName}`))
    return v >= 2.0 ? 1 : 0
  }
  _peers(objId, pinName, type, theirPin) {
    if (!this.sim.active) return []
    const root = this.sim.uf.find(`${objId}:${pinName}`)
    return this.catalog.filter(o => o.id !== objId && (!type || o.type === type) && this.sim.uf.find(`${o.id}:${theirPin}`) === root)
  }
  _boardPinOf(objId, pinName) {
    if (!this.sim.active) return null
    const root = this.sim.uf.find(`${objId}:${pinName}`)
    for (const st of this.sim.pins.values()) if (this.sim.uf.find(`${st.board}:${st.pinName}`) === root) return st.pinNum
    return null
  }

  // ── I2C bus (sketchSandbox Wire) ───────────────────────────────────────────
  // A part on the bus declares sim.i2c = { address(api) → 7-bit addr | null
  // (null = not answering: unpowered, SDA/SCL not wired), write(bytes, api),
  // read(api) → bytes it presents to requestFrom() }.
  _i2cDevices() {
    const out = []
    for (const o of this.catalog) {
      const part = getPart(o.type)
      if (!part.sim.i2c) continue
      const api = this._partApi(o)
      const addr = part.sim.i2c.address(api)
      if (addr != null) out.push({ o, part, api, addr })
    }
    return out
  }
  _i2cWrite([addr, bytes]) {
    for (const d of this._i2cDevices()) if (d.addr === Number(addr)) d.part.sim.i2c.write(Array.isArray(bytes) ? bytes : [], d.api)
  }
  /** IN.i2cBus: { addr: [bytes] } for every device answering this frame. */
  i2cBus() {
    const bus = {}
    for (const d of this._i2cDevices()) bus[d.addr] = (d.part.sim.i2c.read?.(d.api) ?? []).map(b => Number(b) & 255)
    return bus
  }

  /** pulseIn() values parts provide: { boardPin: µs } (e.g. a PING))) sensor's echo). */
  pulses() {
    const out = {}
    for (const o of this.catalog) {
      const part = getPart(o.type)
      if (!part.sim.pulse) continue
      Object.assign(out, part.sim.pulse(this._partApi(o)) ?? {})
    }
    return out
  }

  /** Extra data for the sandbox snapshot: IN.parts[type][objId] = part.sim.input(api). */
  input() {
    const out = {}
    for (const o of this.catalog) {
      const part = getPart(o.type)
      if (!part.sim.input) continue
      ;(out[o.type] ??= {})[o.id] = part.sim.input(this._partApi(o))
    }
    return out
  }

  // ── per frame ──────────────────────────────────────────────────────────────
  frame(dt) {
    if (this.sim.active) this.sim.step(dt)
    for (const o of this.catalog) {
      const part = getPart(o.type)
      const solved = this.sim.stateOf(o.id)
      const look = part.sim.visual ? { solved, state: this.partState[o.id] } : null
      const mesh = this.hooks.meshOf(o.id)
      if (look && mesh) { try { part.sim.visual(mesh, look, o) } catch (e) { /* a bad visual never stops the run */ } }
    }
    // Legacy parts driven THROUGH the circuit (not straight from a pin).
    for (const p of this.sim.parts) {
      if (!p.adapter || this.directIds.has(p.obj.id)) continue
      const s = this.sim.stateOf(p.obj.id)
      if (!s) continue
      if (p.obj.type === 'led') this.hooks.led?.(p.obj.id, s.brightness)
      else if (p.obj.type === 'buzzer') this.hooks.beep?.(p.obj.id, s.on)
      else this.hooks.motor?.(p.obj.id, s.speed)
    }
    this._syncIssues()
  }
  _syncIssues() {
    const now = new Set()
    for (const [k, i] of this.sim.issues) {
      const key = `elec:circuit:${k}`
      now.add(key)
      if (!this._reported.has(key)) this.hooks.issue?.(key, i)
    }
    for (const k of this._reported) if (!now.has(k)) this.hooks.resolve?.(k)
    this._reported = now
  }

  stop() {
    for (const o of this.catalog) {
      const part = getPart(o.type)
      const mesh = this.hooks.meshOf(o.id)
      if (mesh && part.sim.visual) { try { part.sim.visual(mesh, { solved: null, state: part.sim.initState?.(o) ?? {}, off: true }, o) } catch { /* ignore */ } }
    }
    for (const k of this._reported) this.hooks.resolve?.(k)
    this._reported.clear()
  }
}

/** Sandbox runtime source contributed by every catalogue part (libraries). */
export function partSandboxRuntime() {
  return allParts().map(p => p.code?.sandbox).filter(Boolean).join('\n')
}
/** Constants every sketch can use, contributed by parts (e.g. keypad / IR codes). */
export function partSandboxConsts() {
  return allParts().map(p => p.code?.sandboxConsts).filter(Boolean).join('\n')
}
export function isBoardType(t) { return BOARD_TYPES.has(t) }
