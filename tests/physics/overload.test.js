// Physics overload policy: bounded catch-up, and slow motion is REPORTED, never hidden.
import { describe, it, expect } from 'vitest'
import { makeWorld } from './helpers.js'
import { buildQuadruped } from '../../src/managers/physics/robotics/robotTemplates.js'

describe('physics overload handling', () => {
  it('keeps real time when frames are fast enough', async () => {
    const { rt } = await makeWorld()
    rt.addRobot(buildQuadruped())
    const h = rt.config.timestep
    let sim = 0
    for (let i = 0; i < 60; i++) { rt.advance(1 / 60); sim += rt.stats.simulatedLastFrame }
    expect(sim).toBeGreaterThan(1 - 2 * h)          // ~1 s simulated for 1 s of frames
    expect(rt.stats.droppedTime).toBe(0)
    expect(rt.stats.stepsLastFrame).toBeGreaterThanOrEqual(3)
    expect(rt.stats.stepMsAvg).toBeGreaterThan(0)
    expect(rt.stats.solveMsAvg).toBeLessThanOrEqual(rt.stats.stepMsAvg)   // whole step ⊇ Rapier solve
    rt.dispose()
  })

  it('caps catch-up at maxSubsteps and counts the time it could not simulate', async () => {
    const { rt } = await makeWorld()
    rt.addRobot(buildQuadruped())
    const h = rt.config.timestep, max = rt.config.maxSubsteps
    rt.advance(0.1)                                   // a 100 ms frame (10 fps)
    expect(rt.stats.stepsLastFrame).toBe(max)         // never an unbounded loop
    expect(rt.stats.simulatedLastFrame).toBeCloseTo(max * h, 9)
    expect(rt.stats.droppedTime).toBeGreaterThan(0.1 - max * h - h)   // the rest is reported as dropped
    expect(rt.config.timestep).toBe(h)                // the timestep itself is never changed silently
    rt.dispose()
  })
})
