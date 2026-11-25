// BO motor gearbox: speed ↔ torque trade-off and the load model the drive uses.
import { describe, it, expect } from 'vitest'
import {
  GEAR_RATIOS, gearSpecs, gearSpeedFactor, ratioOf, hasGearbox, rollingLoadNm, loadFactor,
  maxSlopeDeg, sideSpeedScale,
} from '../../src/utils/gearMotor.js'
import { DifferentialDrive } from '../../src/managers/robot/DifferentialDrive.js'

describe('gearbox specs', () => {
  it('1:48 is the standard, unchanged speed', () => {
    expect(gearSpeedFactor(48)).toBe(1)
    expect(ratioOf({ type: 'motor_bo' })).toBe(48)          // old projects: no gearRatio field
    expect(ratioOf({ type: 'motor_bo', gearRatio: 7 })).toBe(48)
  })
  it('a higher ratio is slower and stronger, every step', () => {
    const s = GEAR_RATIOS.map((g) => gearSpecs(g.ratio))
    for (let i = 1; i < s.length; i++) {
      expect(s[i].rpm).toBeLessThan(s[i - 1].rpm)
      expect(s[i].stallNm).toBeGreaterThan(s[i - 1].stallNm)
    }
    expect(gearSpeedFactor(220)).toBeCloseTo(48 / 220, 9)
  })
  it('gear friction: torque grows a little less than the ratio', () => {
    const k = gearSpecs(220).stallNm / gearSpecs(48).stallNm
    expect(k).toBeLessThan(220 / 48)
    expect(k).toBeGreaterThan(3)
  })
  it('only BO motors have the gearbox', () => {
    expect(hasGearbox({ type: 'motor_bo' })).toBe(true)
    expect(hasGearbox({ type: 'motor_dc' })).toBe(false)
  })
})

describe('load model', () => {
  const env = { gravity: 9.81, rollingFriction: 0.015, wheelRadiusM: 0.0325, driveMotors: 2 }
  it('a light robot barely slows the standard gearbox', () => {
    const lf = loadFactor(gearSpecs(48).stallNm, rollingLoadNm({ ...env, massKg: 0.5 }))
    expect(lf).toBeGreaterThan(0.95)
  })
  it('a heavier robot slows it more, and past stall it cannot move', () => {
    const at = (m) => loadFactor(gearSpecs(48).stallNm, rollingLoadNm({ ...env, massKg: m }))
    expect(at(10)).toBeLessThan(at(2))
    expect(at(100)).toBe(0)
  })
  it('a stronger gearbox climbs steeper slopes', () => {
    const slope = (r) => maxSlopeDeg({ ...env, massKg: 1, stallNm: gearSpecs(r).stallNm })
    expect(slope(220)).toBeGreaterThan(slope(48))
    expect(slope(48)).toBeGreaterThan(0)
  })
})

describe('drive integration', () => {
  it('per-side speed scale averages gear × load over the side', () => {
    const byId = new Map([
      ['a', { id: 'a', type: 'motor_bo', gearRatio: 48 }],
      ['b', { id: 'b', type: 'motor_bo', gearRatio: 220 }],
      ['c', { id: 'c', type: 'motor_dc' }],
    ])
    const noLoad = () => 0
    expect(sideSpeedScale(['a'], byId, noLoad).scale).toBe(1)
    expect(sideSpeedScale(['b'], byId, noLoad).scale).toBeCloseTo(48 / 220, 9)
    expect(sideSpeedScale(['c'], byId, noLoad).scale).toBe(1)          // no gearbox → unchanged
    expect(sideSpeedScale(['a', 'b'], byId, noLoad).scale).toBeCloseTo((1 + 48 / 220) / 2, 9)
    expect(sideSpeedScale(['a'], byId, () => 1e9)).toEqual({ scale: 0, worst: 0 })   // stalled
  })
  it('DifferentialDrive applies the scale per side (mismatched gearboxes curve)', () => {
    const d = new DifferentialDrive({ wheelbase: 3 })
    const straight = d.compute(200, 200)
    expect(straight.omega).toBe(0)
    d.speedScaleRight = gearSpeedFactor(220)
    const mixed = d.compute(200, 200)
    expect(mixed.vR).toBeLessThan(mixed.vL)
    expect(mixed.omega).not.toBe(0)
  })
})

describe('integrator: rolling friction only while coasting', async () => {
  const { PhysicsIntegrator } = await import('../../src/managers/physics/PhysicsIntegrator.js')
  const env = { gravity: -9.81, airDensity: 0, rollingFriction: 0.015, wind: { x: 0, z: -1, speed: 0, turbulence: 0 } }
  const settle = (target) => { const p = new PhysicsIntegrator({ mass: 1 }); let v = 0; for (let i = 0; i < 600; i++) v = p.step(target, 0, 1 / 60, 0, env).v; return v }
  it('a driven robot reaches the drive speed — slow gearboxes are not crushed', () => {
    expect(settle(4)).toBeCloseTo(4, 3)
    expect(settle(0.5) / settle(4)).toBeCloseTo(0.5 / 4, 3)
  })
  it('with the motors off it still rolls to a stop', () => {
    const p = new PhysicsIntegrator({ mass: 1 })
    for (let i = 0; i < 120; i++) p.step(4, 0, 1 / 60, 0, env)
    let v = 0
    for (let i = 0; i < 600; i++) v = p.step(0, 0, 1 / 60, 0, env).v
    expect(v).toBe(0)
  })
})
