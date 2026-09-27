// Rigid bodies, collisions, joints, damping, friction — measured against analytic
// physics, in the same shared-world/scene-unit setup the app uses.
import { describe, it, expect } from 'vitest'
import { makeWorld, seconds, jointRig } from './helpers.js'
import { buildBox } from '../../src/managers/physics/robotics/robotTemplates.js'
import { L } from '../../src/managers/physics/robotics/units.js'

describe('rigid body physics', () => {
  it('1. single rigid body falls under gravity as y = y0 − ½gt²', async () => {
    const { rt } = await makeWorld()
    const r = rt.addRobot(buildBox({ center: { x: 0, y: 60, z: 0 }, half: { x: 0.5, y: 0.5, z: 0.5 }, mass: 1 }))
    const t = 0.5
    rt.run(seconds(rt, t))
    const fell = 60 - r.basePose().p.y
    const expected = 0.5 * (9.81 / L) * t * t          // su
    expect(fell).toBeGreaterThan(expected * 0.98)
    expect(fell).toBeLessThan(expected * 1.02)
  })

  it('1b. gravity is configurable (Moon, zero-g)', async () => {
    const { rt } = await makeWorld({ gravity: -1.62 })
    const r = rt.addRobot(buildBox({ center: { x: 0, y: 60, z: 0 }, mass: 1 }))
    rt.run(seconds(rt, 0.5))
    expect(60 - r.basePose().p.y).toBeCloseTo(0.5 * (1.62 / L) * 0.25, 0)
    rt.setGravity(0)
    const y = r.basePose().p.y, v = r.links.get('b').body.linvel().y
    rt.run(seconds(rt, 0.5))
    expect(r.basePose().p.y - y).toBeCloseTo(v * 0.5, 0)       // coasts at constant velocity
  })

  it('2. two bodies collide and the upper one comes to rest on the lower', async () => {
    const { rt } = await makeWorld()
    const lower = rt.addRobot(buildBox({ id: 'lower', center: { x: 0, y: 1, z: 0 }, half: { x: 2, y: 1, z: 2 }, mass: 2 }))
    const upper = rt.addRobot(buildBox({ id: 'upper', center: { x: 0, y: 8, z: 0 }, half: { x: 0.5, y: 0.5, z: 0.5 }, mass: 0.5 }))
    rt.run(seconds(rt, 2))
    const topOfLower = lower.basePose().p.y + 1
    expect(upper.basePose().p.y).toBeGreaterThan(topOfLower + 0.5 - 0.05)
    expect(upper.basePose().p.y).toBeLessThan(topOfLower + 0.5 + 0.05)
  })

  it('3. revolute joint: pendulum period matches 2π√(I/mgd) and the anchor holds', async () => {
    const { rt } = await makeWorld()
    const d = 2, m = 0.2, r = 0.2, th0 = 0.15
    // Authored displaced by th0 → released, it swings about the vertical.
    const robot = rt.addRobot(jointRig({ arm: { x: 0, y: -d * Math.cos(th0), z: d * Math.sin(th0) }, armMass: m, shape: 'sphere' }))
    const J = robot.joints.get('j')
    const h = rt.config.timestep, series = []
    for (let i = 0; i < seconds(rt, 4); i++) { rt.step(); robot.measureJoint(J); series.push(J.angle) }
    const mean = series.reduce((a, b) => a + b, 0) / series.length
    const crossings = []
    for (let i = 1; i < series.length; i++) if (series[i - 1] < mean && series[i] >= mean) crossings.push(i * h)
    const amplitude = Math.max(...series) - Math.min(...series)
    expect(amplitude).toBeGreaterThan(th0)                      // it really swings (≈ 2·th0)
    const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1)
    const g = 9.81 / L
    const I = (2 / 5) * m * r * r + m * d * d
    const T = 2 * Math.PI * Math.sqrt(I / (m * g * d))
    expect(Math.abs(period - T) / T).toBeLessThan(0.03)
    const c = robot.links.get('arm').body.worldCom()
    expect(Math.hypot(c.x, c.y - 5, c.z)).toBeCloseTo(d, 1)    // anchor constraint holds
  })

  it('4. joint limits are enforced by the solver', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(jointRig({ arm: { x: 0, y: 0, z: -1.5 }, joint: { limits: { min: -0.3, max: 0.3 } } }))
    const J = robot.joints.get('j')
    let maxAbs = 0
    for (let i = 0; i < seconds(rt, 2); i++) { rt.step(); robot.measureJoint(J); maxAbs = Math.max(maxAbs, Math.abs(J.angle)) }
    expect(maxAbs).toBeGreaterThan(0.25)      // gravity really drove it to the stop
    expect(maxAbs).toBeLessThan(0.3 + 0.03)   // …and the stop held
  })

  it('8. joint damping dissipates energy (amplitude decays faster)', async () => {
    const amp = async (damping) => {
      const { rt } = await makeWorld()
      const th0 = 0.5, d = 2
      const robot = rt.addRobot(jointRig({ arm: { x: 0, y: -d * Math.cos(th0), z: d * Math.sin(th0) }, shape: 'sphere', joint: { damping } }))
      const J = robot.joints.get('j')
      rt.run(seconds(rt, 3))
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < seconds(rt, 1); i++) { rt.step(); robot.measureJoint(J); lo = Math.min(lo, J.angle); hi = Math.max(hi, J.angle) }
      return hi - lo
    }
    const free = await amp(0), damped = await amp(0.02)
    expect(free).toBeGreaterThan(0.5)             // an undamped pendulum keeps swinging
    expect(damped).toBeLessThan(free * 0.5)
  })

  it('9. friction: a block holds on a slope when μ > tanθ and slides when μ < tanθ', async () => {
    const slide = async (material) => {
      const { rt } = await makeWorld()
      const th = 20 * Math.PI / 180            // tan 20° = 0.364
      const r = rt.addRobot(buildBox({ center: { x: 0, y: 0.5, z: 0 }, half: { x: 0.5, y: 0.5, z: 0.5 }, mass: 1, material }))
      rt.run(seconds(rt, 0.3))                  // settle
      rt.setGravity({ x: 0, y: -9.81 * Math.cos(th), z: -9.81 * Math.sin(th) })   // tilt the world
      const z0 = r.basePose().p.z
      rt.run(seconds(rt, 1.5))
      return Math.abs(r.basePose().p.z - z0)
    }
    expect(await slide('rubber')).toBeLessThan(0.05)   // min(1.0, 0.9) = 0.9 > 0.364
    expect(await slide('ice')).toBeGreaterThan(2)      // min(0.1, 0.9) = 0.1 < 0.364
  })
})
