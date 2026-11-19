// A legged robot may turn only if its joints can push a foot sideways: a twist
// (vertical-hinge) servo, or 4+ legs that can turn tank-style. A biped whose
// hips and knees all hinge flat (the micro duck) walks forward/back only.
import { describe, it, expect } from 'vitest'
import { turnCapability } from '../../src/managers/robot/LeggedSystem.js'

const X = { x: 1, y: 0, z: 0 }, NX = { x: -1, y: 0, z: 0 }, Z = { x: 0, y: 0, z: 1 }, UP = { x: 0, y: 1, z: 0 }

describe('turnCapability', () => {
  it('micro duck: biped, hip + knee hinges all along X → cannot turn', () => {
    const c = turnCapability(2, [NX, X, X, NX])
    expect(c.canTurn).toBe(false)
    expect(c.reason).toMatch(/twisting/)
  })

  it('one-servo-per-leg biped → cannot turn', () => {
    expect(turnCapability(2, [X, X]).canTurn).toBe(false)
  })

  it('biped with a hip twist (vertical hinge) → can turn', () => {
    expect(turnCapability(2, [UP, X, UP, X]).canTurn).toBe(true)
  })

  it('a tilted-but-mostly-vertical hinge still counts as a twist', () => {
    const tilted = { x: 0.3, y: 0.95, z: 0 }
    expect(turnCapability(2, [tilted, X]).canTurn).toBe(true)
  })

  it('quadruped / hexapod with flat hinges → can turn (tank-style)', () => {
    expect(turnCapability(4, [X, X, Z, Z]).canTurn).toBe(true)
    expect(turnCapability(6, Array(6).fill(X)).canTurn).toBe(true)
  })
})
