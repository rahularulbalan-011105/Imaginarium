// 28BYJ-48 stepper + ULN2003 driver: coil-field logic, wiring maps, and the
// sandboxed Arduino Stepper library driving it end to end.
import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import {
  fieldAngle, createRotor, driveRotor, shaftAngle, uln2003Outputs, buildStepperWiring, isUln2003Powered,
  STEPS_PER_REV, MIN_STEP_MS, STEPPER_PLUG, STEPPER_WIRES, ULN2003_PIN_ORDER, STEPPER_EXAMPLE_SKETCH,
} from '../../src/utils/stepper.js'
import { buildPinToComponentMap } from '../../src/stores/electronicsStore.js'
import { bootstrapHtml } from '../../src/managers/sketchSandbox.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { PIN_DEFS as WIRING_PINS } from '../../src/utils/wiring.js'
import { PIN_DEFS as FACTORY_PINS } from '../../src/utils/electronicsFactory.js'

const COIL_OF = { OUT1: 'BLUE', OUT2: 'PINK', OUT3: 'YELLOW', OUT4: 'ORANGE' }
const on = (...wires) => Object.fromEntries(wires.map((w) => [w, true]))

// Arduino Stepper.cpp's 4-step sequence on (pin1, pin2, pin3, pin4).
const SEQ = [[1, 0, 1, 0], [0, 1, 1, 0], [0, 1, 0, 1], [1, 0, 0, 1]]
/** Coils energised when the library's 4 pins map to these ULN2003 inputs. */
function coilsFor(step, inputOrder) {
  const levels = {}
  SEQ[step % 4].forEach((v, i) => { levels[inputOrder[i]] = v ? 255 : 0 })
  const outs = uln2003Outputs(levels)
  return Object.fromEntries(Object.entries(COIL_OF).map(([o, w]) => [w, outs[o]]))
}

describe('coil field', () => {
  it('points at single coils and between adjacent pairs', () => {
    expect(fieldAngle(on('BLUE'))).toBe(0)
    expect(fieldAngle(on('PINK'))).toBe(90)
    expect(fieldAngle(on('BLUE', 'PINK'))).toBe(45)
    expect(fieldAngle(on('ORANGE', 'BLUE'))).toBe(-45)
  })
  it('has no field when nothing is on or opposite coils cancel', () => {
    expect(fieldAngle({})).toBeNull()
    expect(fieldAngle(on('BLUE', 'YELLOW'))).toBeNull()
    expect(fieldAngle(on('BLUE', 'PINK', 'YELLOW', 'ORANGE'))).toBeNull()
  })
})

describe('rotor', () => {
  it('full-steps with the library and the right pin order (IN1, IN3, IN2, IN4)', () => {
    const r = createRotor()
    const order = ['IN1', 'IN3', 'IN2', 'IN4']
    for (let s = 1; s <= STEPS_PER_REV; s++) driveRotor(r, coilsFor(s, order), s * MIN_STEP_MS * 2)
    // First step snaps from rest (135° electrical), then exactly +1 per step.
    expect(r.pos).toBeCloseTo(STEPS_PER_REV + 0.5, 6)
    expect(shaftAngle(r) / (2 * Math.PI)).toBeCloseTo(1, 2)
    expect(r.missed).toBe(0)
  })
  it('runs backwards when the steps count down', () => {
    const r = createRotor()
    const order = ['IN1', 'IN3', 'IN2', 'IN4']
    for (let s = 400; s >= 0; s--) driveRotor(r, coilsFor(s, order), (400 - s) * MIN_STEP_MS * 2)
    expect(r.pos).toBeLessThan(-390)
  })
  it('only jitters with the naive pin order (IN1, IN2, IN3, IN4)', () => {
    const r = createRotor()
    const order = ['IN1', 'IN2', 'IN3', 'IN4']
    let maxAbs = 0
    for (let s = 1; s <= 400; s++) { driveRotor(r, coilsFor(s, order), s * MIN_STEP_MS * 2); maxAbs = Math.max(maxAbs, Math.abs(r.pos)) }
    expect(maxAbs).toBeLessThan(2.5)       // hums back and forth, never gets anywhere
  })
  it('half-steps through the 8-state sequence', () => {
    const r = createRotor()
    const half = [['BLUE'], ['BLUE', 'PINK'], ['PINK'], ['PINK', 'YELLOW'], ['YELLOW'], ['YELLOW', 'ORANGE'], ['ORANGE'], ['ORANGE', 'BLUE']]
    for (let i = 1; i <= 80; i++) driveRotor(r, on(...half[i % 8]), null)
    expect(r.pos).toBeCloseTo(40, 6)
  })
  it('misses steps and stalls when stepped faster than it can follow', () => {
    const r = createRotor()
    const order = ['IN1', 'IN3', 'IN2', 'IN4']
    for (let s = 1; s <= 400; s++) driveRotor(r, coilsFor(s, order), s * MIN_STEP_MS * 0.4)   // 2.5× too fast
    expect(r.missed).toBeGreaterThan(300)
    expect(Math.abs(r.pos)).toBeLessThan(3)          // stalls: hums in place, doesn't creep either way
  })
  it('picks up again once the steps slow down', () => {
    const r = createRotor()
    const order = ['IN1', 'IN3', 'IN2', 'IN4']
    let t = 0
    for (let s = 1; s <= 100; s++) driveRotor(r, coilsFor(s, order), (t += MIN_STEP_MS * 0.4))
    const stalledAt = r.pos
    for (let s = 101; s <= 300; s++) driveRotor(r, coilsFor(s, order), (t += MIN_STEP_MS * 1.5))
    expect(r.pos - stalledAt).toBeGreaterThan(190)
  })
})

describe('ULN2003', () => {
  it('switches outputs only when powered and grounded', () => {
    expect(uln2003Outputs({ IN1: 255, IN3: 255 })).toEqual({ OUT1: true, OUT2: false, OUT3: true, OUT4: false })
    expect(Object.values(uln2003Outputs({ IN1: 255 }, false, true)).some(Boolean)).toBe(false)
    expect(Object.values(uln2003Outputs({ IN1: 255 }, true, false)).some(Boolean)).toBe(false)
  })

  const objects = [{ id: 'b', type: 'arduino' }, { id: 'u', type: 'uln2003' }, { id: 'm', type: 'stepper' }]
  const plug = Object.fromEntries(STEPPER_PLUG.map(([out, wire], i) => [`p${i}`, { fromPinId: `u:${out}`, toPinId: `m:${wire}` }]))
  const ctrl = {
    c1: { fromPinId: 'b:D8', toPinId: 'u:IN1' }, c2: { fromPinId: 'b:D9', toPinId: 'u:IN2' },
    c3: { fromPinId: 'u:IN3', toPinId: 'b:D10' }, c4: { fromPinId: 'b:D11', toPinId: 'u:IN4' },
    v: { fromPinId: 'u:VCC', toPinId: 'b:5V' },
  }

  it('maps board pins to its IN terminals', () => {
    const map = buildPinToComponentMap(ctrl, objects)
    expect(map[8]).toEqual([{ id: 'u', type: 'uln2003', terminal: 'IN1' }])
    expect(map[10][0].terminal).toBe('IN3')
  })
  it('maps its socket to the stepper coils and finds the common wire', () => {
    const w = buildStepperWiring(plug, objects)
    expect(w.outMap.u.OUT1).toEqual([{ id: 'm', wire: 'BLUE' }])
    expect(w.outMap.u.OUT4).toEqual([{ id: 'm', wire: 'ORANGE' }])
    expect(w.common.has('m')).toBe(true)
    const noRed = Object.fromEntries(Object.entries(plug).filter(([, c]) => c.toPinId !== 'm:RED'))
    expect(buildStepperWiring(noRed, objects).common.has('m')).toBe(false)
  })
  it('knows when its VCC reaches a supply', () => {
    expect(isUln2003Powered(ctrl, 'u')).toBe(true)
    expect(isUln2003Powered({}, 'u')).toBe(false)
  })
})

describe('pins stay consistent', () => {
  it('3D pins and wiring pins name the same set', () => {
    expect(Object.keys(FACTORY_PINS.stepper).sort()).toEqual([...WIRING_PINS.stepper].sort())
    expect(Object.keys(FACTORY_PINS.uln2003).sort()).toEqual([...WIRING_PINS.uln2003].sort())
    expect(WIRING_PINS.stepper).toEqual(STEPPER_WIRES)
    expect(WIRING_PINS.uln2003).toEqual(ULN2003_PIN_ORDER)
  })
})

describe('example sketch', () => {
  it('compiles cleanly and awaits step()', () => {
    const diag = analyzeArduino(STEPPER_EXAMPLE_SKETCH, { board: 'arduino' })
    expect(diag.errors, JSON.stringify(diag.errors)).toEqual([])
    const { code, error } = parseAndTranspile(STEPPER_EXAMPLE_SKETCH, new Set(['Stepper']))
    expect(error).toBeFalsy()
    expect(code).toMatch(/new Stepper\(/)
    expect(code).toMatch(/await stepper\.step\(/)
  })
})

// Run the REAL sandbox runtime (the Stepper class inside the frame) in a VM and
// decode its pin messages exactly as SimulationManager does.
function sandboxRuntime() {
  const html = bootstrapHtml('', '')
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1]
  const msgs = []
  let onMsg = null
  const ctx = vm.createContext({
    parent: { postMessage: (m) => { if (m && m.t === 'out') msgs.push(m) } },
    addEventListener: (_t, fn) => { onMsg = fn },
    performance, setTimeout, console,
  })
  vm.runInContext(js, ctx)
  return { ctx, msgs, stop: () => onMsg?.({ data: { t: 'stop' } }) }
}

function decode(msgs) {
  const IN_OF = { 8: 'IN1', 9: 'IN2', 10: 'IN3', 11: 'IN4' }
  const levels = {}, r = createRotor()
  for (const m of msgs) {
    if (m.f !== 'pinsWrite') continue
    for (const [p, v] of m.a[0]) levels[IN_OF[p]] = v ? 255 : 0
    const outs = uln2003Outputs(levels)
    driveRotor(r, Object.fromEntries(Object.entries(COIL_OF).map(([o, w]) => [w, outs[o]])), m.a[1])
  }
  return r
}

describe('sandboxed Stepper library', () => {
  it('step(n) at a sane speed turns the rotor n steps, one atomic update per step', async () => {
    const { ctx, msgs, stop } = sandboxRuntime()
    ctx.s = vm.runInContext('new Stepper(2048, 8, 10, 9, 11)', ctx)
    ctx.s.setSpeed(15)
    const t0 = performance.now()
    await ctx.s.step(120)
    const ms = performance.now() - t0
    await ctx.s.step(-20)
    stop()
    const steps = msgs.filter((m) => m.f === 'pinsWrite')
    expect(steps.length).toBe(140)
    expect(ms).toBeGreaterThan(120 * (60000 / 2048 / 15) * 0.8)    // it really takes the time
    const r = decode(msgs)
    expect(r.missed).toBe(0)
    expect(r.pos).toBeCloseTo(100.5, 6)
  })
  it('without setSpeed() it steps instantly and the motor cannot follow', async () => {
    const { ctx, msgs, stop } = sandboxRuntime()
    const s = vm.runInContext('new Stepper(2048, 8, 10, 9, 11)', ctx)
    await s.step(200)
    stop()
    const r = decode(msgs)
    expect(r.missed).toBeGreaterThan(150)
    expect(Math.abs(r.pos)).toBeLessThan(3)
  })
})
