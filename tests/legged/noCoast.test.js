// Releasing the walk key stops a legged robot at once: planted feet don't coast.
// (The wheeled inertia lag made a 2.5 kg quadruped slide ~0.5 s after release.)
import { describe, it, expect } from 'vitest'
import { LeggedSystem } from '../../src/managers/robot/LeggedSystem.js'
import { PhysicsIntegrator } from '../../src/managers/physics/PhysicsIntegrator.js'

const DT = 1 / 60
function makeBot(mass) {
  const s = new LeggedSystem()
  s._gaitEngine = { step: () => ({}), stepLength: 2.5, stepHeight: 2 }
  s._physics = new PhysicsIntegrator({ mass, momentOfInertia: 0.5, frontalArea: 0.04 })
  return s
}
const env = { gravity: -9.81, airDensity: 1.225, wind: { x: 0, z: -1, speed: 0, turbulence: 0 } }

describe('legged robot stops when the legs stop', () => {
  it('2.5 kg quadruped: speed is 0 on the first frame after release', () => {
    const bot = makeBot(2.459)
    let out
    for (let t = 0; t < 2; t += DT) out = bot.step(DT, 8, 0, false, env, null)
    expect(out.v).toBeGreaterThan(7)                 // walking at speed
    out = bot.step(DT, 0, 0, true, env, null)
    expect(out.v).toBe(0)
    expect(out.omega).toBe(0)
  })

  it('turning stops at once too, and a restart ramps up from rest', () => {
    const bot = makeBot(2.459)
    for (let t = 0; t < 2; t += DT) bot.step(DT, 0, 1.8, false, env, null)
    expect(bot.step(DT, 0, 0, true, env, null).omega).toBe(0)
    const first = bot.step(DT, 8, 0, false, env, null).v
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(8)                    // starting still has its short ramp
  })
})
