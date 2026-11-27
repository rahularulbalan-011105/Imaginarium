// Mecanum wheels: roller geometry ↔ physics agree, the kinematics solve forward /
// sideways / turning, wrong layouts behave wrongly, and plain wheels are unchanged.
import { describe, it, expect } from 'vitest'
import {
  rollerAxisLocal, contactRollerAxisLocal, groundRollerAxis, slipFactor, solveTwist, wheelSpeedsFor,
  layoutCheck, handSign, isMecanum, MECANUM_EXAMPLE_SKETCH,
} from '../../src/utils/mecanum.js'
import { createMecanumParts } from '../../src/utils/geometryFactory.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'

// robot facing +z, its left = +x (y up)
const F = [0, 0, 1], L = [1, 0, 0]
const s = (hand, axle = [1, 0, 0]) => slipFactor(groundRollerAxis(axle, hand), F, L)
const a = 3, b = 4
const layout = (FL, FR, RL, RR) => [
  { x: b, y: a, s: s(FL) }, { x: b, y: -a, s: s(FR) }, { x: -b, y: a, s: s(RL) }, { x: -b, y: -a, s: s(RR) }]
const go = (ws, v) => { const t = solveTwist(ws.map((w, i) => ({ ...w, v: v[i] }))); return [t.vx, t.vy, t.omega].map((n) => +n.toFixed(4) + 0) }

describe('rollers', () => {
  it('45° to the axle, and the 3D model\'s bottom roller is the one the physics uses', () => {
    for (const hand of ['A', 'B']) {
      const ax = rollerAxisLocal(0.7, hand)
      expect(Math.hypot(...ax)).toBeCloseTo(1, 9)
      expect(Math.abs(ax[0])).toBeCloseTo(Math.SQRT1_2, 9)
      contactRollerAxisLocal(hand).forEach((v, i) => expect(v).toBeCloseTo(groundRollerAxis([1, 0, 0], hand)[i], 9))
    }
    expect(handSign('A')).toBe(-handSign('B'))
  })
  it('a wheel turned end-for-end keeps its hand (that is why A and B exist)', () => {
    expect(s('A', [-1, 0, 0])).toBeCloseTo(s('A', [1, 0, 0]), 9)
    expect(s('A')).toBeCloseTo(-s('B'), 9)
  })
  it('the model: rollers reach the wheel radius and stay within its width', () => {
    const { tyre } = createMecanumParts({ diameter: 3.4, width: 1.3, hand: 'A' })
    expect(tyre.boundingBox.max.y).toBeCloseTo(1.7, 1)
    expect(tyre.boundingBox.max.x).toBeLessThanOrEqual(0.66)
  })
})

describe('kinematics (X layout: A front-left + rear-right)', () => {
  const X = layout('A', 'B', 'B', 'A')
  it('the standard signs', () => expect(X.map((w) => Math.round(w.s))).toEqual([-1, 1, 1, -1]))
  it('forward, strafe right, diagonal, turn left', () => {
    expect(go(X, [1, 1, 1, 1])).toEqual([1, 0, 0])
    expect(go(X, [1, -1, -1, 1])).toEqual([0, -1, 0])          // −y = to the right
    expect(go(X, [1, 0, 0, 1])).toEqual([0.5, -0.5, 0])
    expect(go(X, [-1, 1, -1, 1])).toEqual([0, 0, +(1 / (a + b)).toFixed(4)])
  })
  it('inverse kinematics round-trips', () => {
    const cmd = { vx: 0.3, vy: -0.7, omega: 0.05 }
    const t = solveTwist(X.map((w, i) => ({ ...w, v: wheelSpeedsFor(X, cmd)[i] })))
    expect(t.vx).toBeCloseTo(0.3, 6); expect(t.vy).toBeCloseTo(-0.7, 6); expect(t.omega).toBeCloseTo(0.05, 6)
  })
  it('layout check', () => expect(layoutCheck(X)).toMatchObject({ pattern: 'X', canStrafe: true, canTurn: true }))
})

describe('wrong layouts behave like real ones', () => {
  it('all one hand: no sideways motion, "forward" goes diagonal', () => {
    const same = layout('A', 'A', 'A', 'A')
    expect(layoutCheck(same).canStrafe).toBe(false)
    expect(go(same, [1, -1, -1, 1])[1]).toBeCloseTo(0, 6)
    const [vx, vy] = go(same, [1, 1, 1, 1]); expect(Math.abs(vy)).toBeGreaterThan(0.3); expect(vx).toBeGreaterThan(0.3)
  })
  it('O layout: sideways comes out reversed', () => {
    const O = layout('B', 'A', 'A', 'B')
    expect(layoutCheck(O).pattern).toBe('O')
    expect(go(O, [1, -1, -1, 1])[1]).toBeGreaterThan(0.9)
  })
  it('a plain wheel among them blocks sideways motion', () => {
    const mixed = layout('A', 'B', 'B', 'A'); mixed[0] = { ...mixed[0], s: null }
    expect(layoutCheck(mixed).canStrafe).toBe(false)
  })
})

describe('plain wheels: the same answer as the differential model', () => {
  it('two wheels on one axle', () => {
    const d = [{ x: 0, y: a, s: null }, { x: 0, y: -a, s: null }]
    expect(go(d, [1, 1])).toEqual([1, 0, 0])
    expect(go(d, [-1, 1])[2]).toBeCloseTo(2 / (2 * a), 3)       // (vR − vL) / track
    expect(isMecanum({ type: 'wheel' })).toBe(false)
    expect(isMecanum({ type: 'wheel', wheelStyle: 'mecanum' })).toBe(true)
  })
})

describe('template', () => {
  it('compiles cleanly', () => {
    expect(analyzeArduino(MECANUM_EXAMPLE_SKETCH, { board: 'arduino' }).errors).toEqual([])
    expect(parseAndTranspile(MECANUM_EXAMPLE_SKETCH, new Set()).error).toBeFalsy()
  })
})
