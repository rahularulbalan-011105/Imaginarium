// TT motor + Hall encoder: quadrature model, wiring, and the sandbox replaying
// counts as A/B edges into attachInterrupt() handlers / the Encoder library.
import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import {
  ENC_PPR, ENC_MOTOR_PIN_ORDER, pulsesPerWheelTurn, outputRpm, stepRpm, quadCount, quadLevels,
  encoderWiring, ENCODER_EXAMPLE_SKETCH,
} from '../../src/utils/encoderMotor.js'
import { gearSpecs, hasGearbox } from '../../src/utils/gearMotor.js'
import { pinNameToNumber, isSupplyPinName, isGroundPinName, buildPinToComponentMap } from '../../src/stores/electronicsStore.js'
import { bootstrapHtml } from '../../src/managers/sketchSandbox.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { PIN_DEFS as WIRING_PINS } from '../../src/utils/wiring.js'
import { PIN_DEFS as FACTORY_PINS } from '../../src/utils/electronicsFactory.js'

describe('encoder model', () => {
  it('pulses per wheel turn = 11 × gear ratio', () => {
    expect(pulsesPerWheelTurn(48)).toBe(528)
    expect(pulsesPerWheelTurn(120)).toBe(1320)
  })
  it('quadrature: A leads B going forward', () => {
    const seq = [0, 1, 2, 3, 4].map(quadLevels).map(({ A, B }) => `${A}${B}`)
    expect(seq).toEqual(['00', '10', '11', '01', '00'])
    expect(quadLevels(-1)).toEqual({ A: 0, B: 1 })       // backward from 00 → 01
  })
  it('4 counts per pulse, signed', () => {
    expect(quadCount(1)).toBe(ENC_PPR * 4)
    expect(quadCount(-0.5)).toBe(-22)
  })
  it('output speed follows PWM, gearbox and load; the motor spins up with a lag', () => {
    expect(outputRpm(255, 48)).toBeCloseTo(gearSpecs(48).rpm, 9)
    expect(outputRpm(-127.5, 48)).toBeCloseTo(-gearSpecs(48).rpm / 2, 9)
    expect(outputRpm(255, 220)).toBeLessThan(outputRpm(255, 48))
    expect(outputRpm(255, 48, 0.5)).toBeCloseTo(gearSpecs(48).rpm / 2, 9)
    const after = stepRpm(0, 100, 0.06)
    expect(after).toBeGreaterThan(60); expect(after).toBeLessThan(65)    // 1 − e⁻¹ ≈ 63 %
  })
  it('has the gearbox', () => expect(hasGearbox({ type: 'motor_enc' })).toBe(true))
})

describe('wiring', () => {
  const objects = [{ id: 'b', type: 'arduino' }, { id: 'm', type: 'motor_enc' }]
  const conns = {
    a: { fromPinId: 'm:ENC_A', toPinId: 'b:D2' }, bb: { fromPinId: 'b:D4', toPinId: 'm:ENC_B' },
    v: { fromPinId: 'm:VCC', toPinId: 'b:5V' }, g: { fromPinId: 'm:GND', toPinId: 'b:GND1' },
    p: { fromPinId: 'b:D5', toPinId: 'm:TERM_A' },
  }
  const deps = { pinNum: pinNameToNumber, isSupply: isSupplyPinName, isGround: isGroundPinName }
  it('finds A/B pins and power', () => {
    expect(encoderWiring(conns, objects, deps).m).toEqual({ pinA: 2, pinB: 4, powered: true })
    const { v, ...noVcc } = conns
    expect(encoderWiring(noVcc, objects, deps).m.powered).toBe(false)
  })
  it('the motor is still driven through TERM_A (M1)', () => {
    expect(buildPinToComponentMap(conns, objects)[5]).toEqual([{ id: 'm', type: 'motor_enc', terminal: 'A' }])
    expect(buildPinToComponentMap(conns, objects)[2]).toBeUndefined()     // ENC_A is an output, never written
  })
  it('3D pins and wiring pins agree', () => {
    expect(WIRING_PINS.motor_enc).toEqual(ENC_MOTOR_PIN_ORDER)
    expect(Object.keys(FACTORY_PINS.motor_enc).sort()).toEqual([...ENC_MOTOR_PIN_ORDER].sort())
  })
})

describe('parser + diagnostics', () => {
  it('volatile is accepted (every interrupt sketch uses it)', () => {
    const { code, error } = parseAndTranspile('volatile long ticks = 0;\nstatic volatile int n = 1;\nvoid loop(){ ticks++; }', new Set())
    expect(error).toBeFalsy()
    expect(code).not.toMatch(/volatile/)
    expect(code).toMatch(/let ticks = 0/)
  })
  it('the example sketch compiles cleanly', () => {
    const diag = analyzeArduino(ENCODER_EXAMPLE_SKETCH, { board: 'arduino' })
    expect(diag.errors, JSON.stringify(diag.errors)).toEqual([])
    expect(parseAndTranspile(ENCODER_EXAMPLE_SKETCH, new Set(['attachInterrupt'])).error).toBeFalsy()
  })
})

// ── the real sandbox runtime ────────────────────────────────────────────────
// The sketch's own code runs inside a try block (not global), so test handlers
// are defined straight in the VM context instead.
function sandbox(handlers = '') {
  const html = bootstrapHtml('', '')
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1]
  const sent = []
  let onMsg = null
  const ctx = vm.createContext({
    parent: { postMessage: (m) => { if (m?.t === 'out') sent.push(m) } },
    addEventListener: (_t, fn) => { onMsg = fn }, performance, setTimeout, console,
  })
  vm.runInContext(js, ctx)
  if (handlers) vm.runInContext(handlers, ctx)
  const push = (quad, uno = true) => onMsg({ data: { t: 'in', s: { dread: {}, aread: {}, quad, uno } } })
  return { ctx, sent, push, stop: () => onMsg({ data: { t: 'stop' } }) }
}
const ISR = `var ticks = 0, changes = 0;
function onA() { if (digitalRead(4) == LOW) ticks++; else ticks--; }
function onAny() { changes++; }`

describe('sandbox: interrupts + encoder edges', () => {
  it('RISING on A counts pulses with direction, like on hardware', () => {
    const { ctx, push, stop } = sandbox(ISR)
    vm.runInContext('attachInterrupt(digitalPinToInterrupt(2), onA, RISING)', ctx)
    push({ m: { a: 2, b: 4, count: 0 } })                 // first snapshot = reference, no edges
    push({ m: { a: 2, b: 4, count: 400 } })               // 100 pulses forward
    expect(vm.runInContext('ticks', ctx)).toBe(100)
    push({ m: { a: 2, b: 4, count: 240 } })               // 40 pulses back
    expect(vm.runInContext('ticks', ctx)).toBe(60)
    stop()
  })
  it('CHANGE fires on both edges', () => {
    const { ctx, push, stop } = sandbox(ISR)
    vm.runInContext('attachInterrupt(digitalPinToInterrupt(2), onAny, CHANGE)', ctx)
    push({ m: { a: 2, b: 4, count: 0 } }); push({ m: { a: 2, b: 4, count: 40 } })
    expect(vm.runInContext('changes', ctx)).toBe(20)
    stop()
  })
  it('old-style attachInterrupt(0, …) means pin 2 on an Uno', () => {
    const { ctx, push, stop } = sandbox(ISR)
    vm.runInContext('attachInterrupt(0, onA, RISING)', ctx)
    push({ m: { a: 2, b: 4, count: 0 } }); push({ m: { a: 2, b: 4, count: 40 } })
    expect(vm.runInContext('ticks', ctx)).toBe(10)
    stop()
  })
  it('an Uno cannot interrupt on pin 4; an ESP32 can', () => {
    const uno = sandbox(ISR)
    vm.runInContext('attachInterrupt(4, onAny, CHANGE)', uno.ctx)
    uno.push({ m: { a: 2, b: 4, count: 0 } }); uno.push({ m: { a: 2, b: 4, count: 40 } })
    expect(vm.runInContext('changes', uno.ctx)).toBe(0)
    expect(uno.sent.some((m) => m.f === 'irqAttach')).toBe(true)   // parent reports the bad pin
    uno.stop()
    const esp = sandbox(ISR)
    vm.runInContext('attachInterrupt(4, onAny, CHANGE)', esp.ctx)
    esp.push({ m: { a: 2, b: 4, count: 0 } }, false); esp.push({ m: { a: 2, b: 4, count: 40 } }, false)
    expect(vm.runInContext('changes', esp.ctx)).toBe(20)
    esp.stop()
  })
  it('noInterrupts() masks handlers; digitalRead still sees the levels', () => {
    const { ctx, push, stop } = sandbox(ISR)
    vm.runInContext('attachInterrupt(2, onA, RISING); noInterrupts()', ctx)
    push({ m: { a: 2, b: 4, count: 0 } }); push({ m: { a: 2, b: 4, count: 5 } })
    expect(vm.runInContext('ticks', ctx)).toBe(0)
    expect(vm.runInContext('digitalRead(2)', ctx)).toBe(1)     // count 5 → state 1: A high
    stop()
  })
  it('Encoder(a, b) reads the 4× count; swapped pins read negative; write() resets', () => {
    const { ctx, push, stop } = sandbox('')
    push({ m: { a: 2, b: 4, count: 0 } }); push({ m: { a: 2, b: 4, count: 300 } })
    expect(vm.runInContext('new Encoder(2, 4).read()', ctx)).toBe(300)
    expect(vm.runInContext('new Encoder(4, 2).read()', ctx)).toBe(-300)
    expect(vm.runInContext('var e = new Encoder(2, 4); e.write(0); e.read()', ctx)).toBe(0)
    stop()
  })
})
