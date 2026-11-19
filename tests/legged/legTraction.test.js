// Gravity-dependent legged motion: grip = μ·g, walking speed ∝ √g, zero-G = no grip.
import { describe, it, expect } from 'vitest'
import { stepTraction, gravitySpeedScale } from '../../src/managers/robot/legTraction.js'

const DT = 1 / 60
function walk(gravity, seconds, want = { vx: 0, vz: -8, omega: 0 }, s = { vx: 0, vz: 0, omega: 0 }, grounded = true) {
  let push = 0
  for (let t = 0; t < seconds; t += DT) push = Math.max(push, stepTraction(s, want, { gravity, grounded, dt: DT, walking: true }).pushOff)
  return { s, push }
}

describe('legged traction under gravity', () => {
  it('Earth: reaches the tuned walking speed almost at once', () => {
    const { s } = walk(-9.81, 0.1)
    expect(s.vz).toBeCloseTo(-8, 5)
  })

  it('Moon and Mars walk slower (Froude: speed ∝ √g)', () => {
    expect(walk(-1.62, 3).s.vz).toBeCloseTo(-8 * Math.sqrt(1.62 / 9.81), 3)
    expect(walk(-3.72, 3).s.vz).toBeCloseTo(-8 * Math.sqrt(3.72 / 9.81), 3)
    expect(gravitySpeedScale(-20)).toBe(1)          // never faster than the tuned Earth speed
  })

  it('less gravity = less grip: the Moon takes longer to get going than Earth', () => {
    const earth = walk(-9.81, 0.02).s.vz, moon = walk(-1.62, 0.02).s.vz
    expect(Math.abs(moon)).toBeLessThan(Math.abs(earth))
  })

  it('zero-G: legs give no push, momentum is kept, kicking pushes off the floor', () => {
    const still = walk(0, 2)
    expect(still.s.vz).toBe(0)
    expect(still.push).toBeGreaterThan(0)
    const drifting = walk(0, 2, { vx: 0, vz: 0, omega: 0 }, { vx: 3, vz: 0, omega: 0.5 })
    expect(drifting.s.vx).toBe(3)                   // no grip to stop it
    expect(drifting.s.omega).toBe(0.5)
  })

  it('airborne under gravity: no grip until the feet land', () => {
    const { s } = walk(-1.62, 1, undefined, undefined, false)
    expect(s.vz).toBe(0)
  })
})
