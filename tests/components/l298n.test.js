// L298N motor driver — wired the way a student wires the real module:
//   Arduino D7/D8 → IN1/IN2, D5 → ENA, OUT1/OUT2 → left motor TERM_A/TERM_B,
//   L298N GND → Arduino GND.
import { describe, it, expect } from 'vitest'
import { l298nOutputs, buildDriverOutputMap, motorsOnDrivers, L298N_DROP, L298N_PIN_ORDER, L298N_EXAMPLE_SKETCH } from '../../src/utils/l298n.js'
import { buildPinToComponentMap, isDriverGrounded } from '../../src/stores/electronicsStore.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { PIN_DEFS as WIRING_PINS, pinRole } from '../../src/utils/wiring.js'
import { PIN_DEFS as PIN_SPHERES } from '../../src/utils/electronicsFactory.js'

const HI = 255
// Net motor speed, exactly as SimulationManager computes it: TERM_A − TERM_B.
const net = (o, a = 'OUT1', b = 'OUT2') => o[a] - o[b]

describe('L298N output logic', () => {
  it('IN1 HIGH / IN2 LOW → forward, swapped → reverse (ENA jumper on)', () => {
    expect(net(l298nOutputs({ IN1: HI, IN2: 0 }))).toBeCloseTo(255 * L298N_DROP, 6)
    expect(net(l298nOutputs({ IN1: 0, IN2: HI }))).toBeCloseTo(-255 * L298N_DROP, 6)
  })

  it('both LOW or both HIGH → stopped (brake)', () => {
    expect(net(l298nOutputs({ IN1: 0, IN2: 0 }))).toBe(0)
    expect(net(l298nOutputs({ IN1: HI, IN2: HI }))).toBe(0)
  })

  it('ENA wired: its PWM value sets the speed; LOW turns the channel off', () => {
    const half = l298nOutputs({ IN1: HI, IN2: 0, ENA: 128 }, { ENA: true })
    expect(net(half)).toBeCloseTo(128 * L298N_DROP, 6)
    expect(net(l298nOutputs({ IN1: HI, IN2: 0 }, { ENA: true }))).toBe(0)   // ENA never written = LOW
  })

  it('channel B is independent (IN3/IN4/ENB → OUT3/OUT4)', () => {
    const o = l298nOutputs({ IN1: HI, IN3: 0, IN4: HI, ENB: 100 }, { ENB: true })
    expect(net(o)).toBeCloseTo(255 * L298N_DROP, 6)
    expect(net(o, 'OUT3', 'OUT4')).toBeCloseTo(-100 * L298N_DROP, 6)
  })

  it('no shared ground → nothing comes out', () => {
    expect(l298nOutputs({ IN1: HI, IN2: 0 }, {}, false)).toEqual({ OUT1: 0, OUT2: 0, OUT3: 0, OUT4: 0 })
  })

  it('the ≈2 V drop: a motor runs ≈73 % as fast as wired straight to the pack', () => {
    expect(L298N_DROP).toBeCloseTo(0.73, 2)
  })
})

describe('L298N wiring', () => {
  const objects = [
    { id: 'ard', type: 'arduino' }, { id: 'drv', type: 'l298n' },
    { id: 'mL', type: 'motor_bo' }, { id: 'mR', type: 'motor_bo' },
  ]
  const wire = (a, b) => ({ fromPinId: a, toPinId: b })
  const conns = {
    c1: wire('ard:D7', 'drv:IN1'), c2: wire('drv:IN2', 'ard:D8'), c3: wire('ard:D5', 'drv:ENA'),
    c4: wire('drv:OUT1', 'mL:TERM_A'), c5: wire('mL:TERM_B', 'drv:OUT2'),
    c6: wire('drv:OUT3', 'mR:TERM_A'), c7: wire('drv:OUT4', 'mR:TERM_B'),
    c8: wire('drv:GND', 'ard:GND1'),
  }

  it('board pins reach the driver inputs (either wire direction)', () => {
    const map = buildPinToComponentMap(conns, objects)
    expect(map[7]).toEqual([{ id: 'drv', type: 'l298n', terminal: 'IN1' }])
    expect(map[8]).toEqual([{ id: 'drv', type: 'l298n', terminal: 'IN2' }])
    expect(map[5]).toEqual([{ id: 'drv', type: 'l298n', terminal: 'ENA' }])
  })

  it('driver outputs reach the motor terminals; motors are not on any board pin', () => {
    const out = buildDriverOutputMap(conns, objects)
    expect(out.drv.OUT1).toEqual([{ id: 'mL', terminal: 'A' }])
    expect(out.drv.OUT2).toEqual([{ id: 'mL', terminal: 'B' }])
    expect(out.drv.OUT4).toEqual([{ id: 'mR', terminal: 'B' }])
    expect([...motorsOnDrivers(conns, objects)].sort()).toEqual(['mL', 'mR'])
    const map = buildPinToComponentMap(conns, objects)
    expect(Object.values(map).flat().some((c) => c.type === 'motor_bo')).toBe(false)
  })

  it('direct motor wiring is unchanged by the driver support', () => {
    const map = buildPinToComponentMap({ d: wire('ard:D3', 'mL:TERM_A') }, objects)
    expect(map[3]).toEqual([{ id: 'mL', type: 'motor_bo', terminal: 'A' }])
  })

  it('ground check: GND → board GND counts; no wire or a non-ground pin does not', () => {
    expect(isDriverGrounded(conns, 'drv')).toBe(true)
    expect(isDriverGrounded({ x: wire('drv:GND', 'ard:D2') }, 'drv')).toBe(false)
    expect(isDriverGrounded({}, 'drv')).toBe(false)
  })

  it('wiring views and 3D pins list the same 13 pins; 12V is a power pin', () => {
    expect([...WIRING_PINS.l298n].sort()).toEqual(Object.keys(PIN_SPHERES.l298n).sort())
    expect(L298N_PIN_ORDER).toHaveLength(13)
    expect(pinRole('12V')).toBe('power')
  })
})

describe('L298N example sketch', () => {
  it('passes the compiler checks and transpiles', () => {
    const r = analyzeArduino(L298N_EXAMPLE_SKETCH, { board: 'arduino' })
    expect(r.errors).toEqual([])
    expect(() => parseAndTranspile(L298N_EXAMPLE_SKETCH)).not.toThrow()
  })
})
