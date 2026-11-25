// Servo gripper: jaw geometry, squeeze force, hold check, and that it wires /
// codes exactly like a servo.
import { describe, it, expect } from 'vitest'
import {
  GRIP, gapForAngle, angleForGap, fingerRoot, linkAngle, padForceN, squeezeN, holdCapacityN,
  maxPayloadKg, partBetweenPads, gapRate, FULL_SQUEEZE_CM, GRIPPER_EXAMPLE_SKETCH, GRIPPER_ARM_SKETCH,
} from '../../src/utils/gripper.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { buildPinToComponentMap } from '../../src/stores/electronicsStore.js'
import { servoWiring } from '../../src/managers/physics/robotics/diagnosis.js'
import { PIN_DEFS as WIRING_PINS } from '../../src/utils/wiring.js'
import { PIN_DEFS as FACTORY_PINS } from '../../src/utils/electronicsFactory.js'

const box = (x0, x1, y0, y1, z0, z1) => ({ min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } })

describe('jaw geometry', () => {
  it('write(0) = fully open, write(180) = closed; angle ↔ gap round-trips', () => {
    expect(gapForAngle(0)).toBe(GRIP.maxGap)
    expect(gapForAngle(180)).toBe(0)
    expect(gapForAngle(90)).toBeCloseTo(GRIP.maxGap / 2, 9)
    expect(angleForGap(gapForAngle(120))).toBe(120)
  })
  it('the parallelogram puts the pads exactly `gap` apart', () => {
    for (const gap of [0, 1, 2.5, GRIP.maxGap]) {
      const { x } = fingerRoot(gap)
      expect(2 * (x - GRIP.padInset)).toBeCloseTo(gap, 9)
    }
    expect(linkAngle(GRIP.maxGap)).toBeGreaterThan(linkAngle(0))   // links swing out to open
  })
  it('jaws move at the servo speed (a metal MG996R is slower than an SG90)', () => {
    expect(gapRate('sg90')).toBeGreaterThan(gapRate('mg996r'))
    expect(GRIP.maxGap / gapRate('sg90')).toBeGreaterThan(0.2)     // ~0.3 s open → closed
  })
})

describe('grip force and hold', () => {
  it('a stronger servo squeezes harder', () => {
    expect(padForceN('mg996r', 2)).toBeGreaterThan(5 * padForceN('sg90', 2))
    expect(padForceN('sg90', 2)).toBeGreaterThan(1.5)
    expect(padForceN('sg90', 2)).toBeLessThan(4)
  })
  it('commanded just to the part: no squeeze; well past it: full stall force', () => {
    expect(squeezeN('sg90', 2, 2)).toBe(0)
    expect(squeezeN('sg90', 2, 2 - FULL_SQUEEZE_CM / 2)).toBeCloseTo(padForceN('sg90', 2) / 2, 9)
    expect(squeezeN('sg90', 2, 0)).toBeCloseTo(padForceN('sg90', 2), 9)
  })
  it('holds while 2·μ·F ≥ m·g', () => {
    const kg = maxPayloadKg('sg90', 2)
    expect(holdCapacityN(padForceN('sg90', 2)) / 9.81).toBeCloseTo(kg, 9)
    expect(maxPayloadKg('sg90', 2, 1.62)).toBeGreaterThan(5 * kg)  // on the Moon it holds ~6× more
    expect(kg).toBeGreaterThan(0.1); expect(kg).toBeLessThan(0.6)
  })
})

describe('is a part between the pads?', () => {
  const gap = 3, { z } = fingerRoot(gap)
  it('a 2 cm block centred in the pad zone', () => {
    const r = partBetweenPads(box(-1, 1, -0.5, 1.5, z + 0.2, z + 1.5), gap)
    expect(r.width).toBeCloseTo(2, 9); expect(r.centerX).toBeCloseTo(0, 9)
  })
  it('off to one side but still between the jaws: it gets centred', () => {
    expect(partBetweenPads(box(-0.2, 1.3, -0.5, 0.5, z, z + 1), gap).centerX).toBeCloseTo(0.55, 9)
  })
  it('a part the pad edge only grazes (the table under it) is not gripped', () => {
    expect(partBetweenPads(box(-1, 1, -3, -0.45, z, z + 1.5), gap)).toBeNull()        // 0.10 of pad height
    expect(partBetweenPads(box(-1, 1, -3, -0.35, z, z + 1.5), gap)).not.toBeNull()    // 0.20: it bears on it
  })
  it('in front of the fingertips, above the pads, or outside the jaws: no', () => {
    expect(partBetweenPads(box(-1, 1, -0.5, 0.5, z + GRIP.padLen + 0.1, z + 4), gap)).toBeNull()
    expect(partBetweenPads(box(-1, 1, 0.8, 2, z, z + 1), gap)).toBeNull()
    expect(partBetweenPads(box(1.6, 3, -0.5, 0.5, z, z + 1), gap)).toBeNull()
  })
})

describe('wired and coded like a servo', () => {
  it('pins match; SIGNAL on a board pin reaches it', () => {
    expect(WIRING_PINS.gripper).toEqual(['SIGNAL', 'VCC', 'GND'])
    expect(Object.keys(FACTORY_PINS.gripper).sort()).toEqual(['GND', 'SIGNAL', 'VCC'])
    const objects = [{ id: 'u', type: 'arduino' }, { id: 'g', type: 'gripper' }]
    const conns = { a: { fromPinId: 'u:D9', toPinId: 'g:SIGNAL' }, b: { fromPinId: 'g:VCC', toPinId: 'u:5V' }, c: { fromPinId: 'g:GND', toPinId: 'u:GND1' } }
    expect(buildPinToComponentMap(conns, objects)[9]).toEqual([{ id: 'g', type: 'gripper', terminal: 'A' }])
    expect(servoWiring([{ id: 'g' }], conns).get('g')).toMatchObject({ signalPin: 9, powered: true })
  })
  it('the example sketches compile cleanly', () => {
    expect(analyzeArduino(GRIPPER_EXAMPLE_SKETCH, { board: 'arduino' }).errors).toEqual([])
    expect(analyzeArduino(GRIPPER_ARM_SKETCH, { board: 'arduino' }).errors).toEqual([])
    expect(parseAndTranspile(GRIPPER_ARM_SKETCH, new Set(['Servo'])).error).toBeFalsy()
    expect(parseAndTranspile(GRIPPER_EXAMPLE_SKETCH, new Set(['Servo'])).error).toBeFalsy()
  })
})
