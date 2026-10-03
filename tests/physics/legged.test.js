// Whole-robot behaviour. Every assertion is on a measured physical quantity
// (displacement, height, tilt, contact force, battery state) — never on "it ran".
import { describe, it, expect } from 'vitest'
import { makeWorld, seconds, forwardProgress, tilt } from './helpers.js'
import { buildQuadruped, buildHexapod, buildBox } from '../../src/managers/physics/robotics/robotTemplates.js'
import { forceToN } from '../../src/managers/physics/robotics/units.js'

const G = 9.81

describe('legged robots', () => {
  it('10 & 13. a quadruped stands on its own servos; foot forces carry its weight', async () => {
    const { rt } = await makeWorld()
    const g = buildQuadruped()
    const robot = rt.addRobot(g)
    rt.run(seconds(rt, 3))
    const H = g.standHeight, y = robot.basePose().p.y
    expect(y).toBeGreaterThan(H * 0.95)                    // servos hold the body up (small compliance sag)
    expect(y).toBeLessThan(H * 1.01)
    const { roll, pitch } = tilt(robot)
    expect(Math.abs(roll)).toBeLessThan(0.02)
    expect(Math.abs(pitch)).toBeLessThan(0.02)
    expect(robot.stability.state).toBe('stable')
    const feet = [...robot.feet.values()]
    expect(feet.every(f => f.contact)).toBe(true)
    // Σ normal force ≈ M·g (contact-impulse readout validated against Newton).
    const total = feet.reduce((s, f) => s + f.normalForce, 0)
    expect(Math.abs(total - robot.stability.mass * G) / (robot.stability.mass * G)).toBeLessThan(0.03)
    // Standing still → negligible friction, contact normals point up.
    for (const f of feet) { expect(f.frictionForce).toBeLessThan(0.1 * f.normalForce + 0.05); expect(f.normal.y).toBeGreaterThan(0.95) }
    expect(robot.bodyGroundContact).toBe(false)
  })

  it('14. a quadruped walks forward by foot contact (crawl gait)', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(buildQuadruped({ gait: { type: 'crawl' } }))
    rt.run(seconds(rt, 0.5))
    const start = { ...robot.basePose().p }
    robot.setMode('gait'); robot.setCommand({ forward: 1 })
    let maxTilt = 0, belly = false
    for (let i = 0; i < seconds(rt, 10); i++) {
      rt.step()
      const t = tilt(robot); maxTilt = Math.max(maxTilt, Math.abs(t.roll), Math.abs(t.pitch))
      belly ||= robot.bodyGroundContact
    }
    expect(forwardProgress(robot, start)).toBeGreaterThan(5)   // > 25 cm
    expect(maxTilt).toBeLessThan(0.3)
    expect(belly).toBe(false)
    expect(robot.basePose().p.y).toBeGreaterThan(robot.graph.standHeight * 0.85)
    // Validation telemetry: joints/feet actually track the controller's targets.
    const tel = robot.telemetry()
    expect(tel.validation.maxFootError_m).toBeLessThan(0.05)
  })

  it('14b. walking the other way: backward command moves it backward', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(buildQuadruped({ gait: { type: 'crawl' } }))
    rt.run(seconds(rt, 0.5))
    const start = { ...robot.basePose().p }
    robot.setMode('gait'); robot.setCommand({ forward: -1 })
    rt.run(seconds(rt, 8))
    expect(forwardProgress(robot, start)).toBeLessThan(-3)
  })

  it('15. a hexapod walks with a tripod gait and stays statically stable', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(buildHexapod())
    rt.run(seconds(rt, 0.5))
    const start = { ...robot.basePose().p }
    robot.setMode('gait'); robot.setCommand({ forward: 1 })
    let unstable = 0, n = 0
    for (let i = 0; i < seconds(rt, 8); i++) {
      rt.step()
      if (i > seconds(rt, 1)) { n++; if (robot.stability.state === 'unstable') unstable++ }
    }
    expect(robot.gait.type).toBe('tripod')
    expect(forwardProgress(robot, start)).toBeGreaterThan(8)
    expect(unstable / n).toBeLessThan(0.1)                  // tripod keeps a support triangle
    expect(Math.abs(tilt(robot).roll)).toBeLessThan(0.1)
  })

  it('16. losing leg torque makes the robot fall — no animation, just physics', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(buildQuadruped())
    rt.run(seconds(rt, 1))
    expect(robot.stability.state).toBe('stable')
    // The right-side servos lose all torque (e.g. a failed driver).
    for (const [id, A] of robot.actuators) if (/leg[13]_/.test(id)) A.servo.spec.maxTorque = 0
    let sawUnstable = false
    for (let i = 0; i < seconds(rt, 3); i++) { rt.step(); sawUnstable ||= robot.stability.state === 'unstable' }
    expect(sawUnstable).toBe(true)
    expect(Math.abs(tilt(robot).roll)).toBeGreaterThan(0.3)   // tipped toward the dead side
    expect(robot.basePose().p.y).toBeLessThan(robot.graph.standHeight * 0.85)
  })

  it('19. walks across uneven terrain through contact alone', async () => {
    const { rt } = await makeWorld()
    rt.setTerrain({ type: 'uneven', center: { x: 0, z: -9 }, size: 14, amplitude: 0.35, resolution: 20, seed: 5 })
    const robot = rt.addRobot(buildHexapod())
    rt.run(seconds(rt, 0.5))
    const start = { ...robot.basePose().p }
    robot.setMode('gait'); robot.setCommand({ forward: 1 })
    let maxTilt = 0
    for (let i = 0; i < seconds(rt, 10); i++) { rt.step(); const t = tilt(robot); maxTilt = Math.max(maxTilt, Math.abs(t.roll), Math.abs(t.pitch)) }
    expect(forwardProgress(robot, start)).toBeGreaterThan(6)
    expect(maxTilt).toBeLessThan(0.45)
  })

  it('20. battery depletion: voltage sags, the pack browns out, servos go limp, robot sags', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(buildQuadruped({ power: { capacity_mAh: 0.4 } }))
    const v0 = robot.battery.voltage
    rt.run(seconds(rt, 1))
    expect(robot.battery.voltage).toBeLessThan(v0)             // sag + discharge
    for (let i = 0; i < seconds(rt, 6) && !robot.battery.brownout; i++) rt.step()
    expect(robot.battery.brownout).toBe(true)
    rt.run(seconds(rt, 2))
    expect([...robot.actuators.values()].every(A => A.servo.limp)).toBe(true)
    expect(robot.basePose().p.y).toBeLessThan(robot.graph.standHeight * 0.8)
    expect(robot.battery.energyUsed_J).toBeGreaterThan(0)
  })

  it('22. several robots coexist in one world (independent collision groups)', async () => {
    const { rt } = await makeWorld()
    const a = rt.addRobot(buildQuadruped({ id: 'A', origin: { x: -12, z: 0 } }))
    const b = rt.addRobot(buildHexapod({ id: 'B', origin: { x: 12, z: 0 } }))
    const c = rt.addRobot(buildBox({ id: 'C', center: { x: 0, y: 1, z: 12 }, half: { x: 1, y: 1, z: 1 } }))
    rt.run(seconds(rt, 2))
    expect(new Set([a._slot, b._slot, c._slot]).size).toBe(3)
    expect(a.basePose().p.y).toBeGreaterThan(a.graph.standHeight * 0.95)
    expect(b.basePose().p.y).toBeGreaterThan(b.graph.standHeight * 0.95)
    expect(c.basePose().p.y).toBeCloseTo(1, 1)
  })

  it('23. robots collide: a walking robot shoves an obstacle / another robot', async () => {
    const { rt } = await makeWorld()
    const walker = rt.addRobot(buildHexapod({ id: 'W' }))
    // A wide, low crate: wider than the leg span so the legs can't straddle it.
    const box = rt.addRobot(buildBox({ id: 'Box', center: { x: 0, y: 0.6, z: -6.5 }, half: { x: 6, y: 0.6, z: 0.6 }, mass: 0.2, material: 'plastic' }))
    const z0 = box.basePose().p.z
    rt.run(seconds(rt, 0.5))
    walker.setMode('gait'); walker.setCommand({ forward: 1 })
    let touched = false
    for (let i = 0; i < seconds(rt, 10); i++) { rt.step(); touched ||= walker.bodyGroundContact || [...walker.feet.values()].some(f => f.contact && f.otherMaterial === 'plastic') }
    expect(touched).toBe(true)
    expect(z0 - box.basePose().p.z).toBeGreaterThan(0.5)     // pushed forward (−Z)
  })

  it('contact forces are reported in SI and agree with Newton on a resting body', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(buildQuadruped())
    rt.run(seconds(rt, 2))
    const fy = [...robot.feet.values()].reduce((s, f) => s + f.force.y, 0)
    expect(fy).toBeCloseTo(robot.stability.mass * G, 0)
    expect(forceToN(1)).toBeCloseTo(0.05, 9)
  })

  it('LOW physics quality (120 Hz) keeps servos/joints/contacts stable', async () => {
    const { rt } = await makeWorld({ timestep: 1 / 120 })
    const q = rt.addRobot(buildQuadruped())
    rt.run(seconds(rt, 3))
    expect(q.basePose().p.y).toBeGreaterThan(q.graph.standHeight * 0.93)
    expect(Math.abs(tilt(q).roll)).toBeLessThan(0.03)
    expect(q.stability.state).toBe('stable')

    const { rt: rt2 } = await makeWorld({ timestep: 1 / 120 })
    const hx = rt2.addRobot(buildHexapod())
    rt2.run(seconds(rt2, 0.5))
    const start = { ...hx.basePose().p }
    hx.setMode('gait'); hx.setCommand({ forward: 1 })
    let maxTilt = 0
    for (let i = 0; i < seconds(rt2, 8); i++) { rt2.step(); maxTilt = Math.max(maxTilt, Math.abs(tilt(hx).roll), Math.abs(tilt(hx).pitch)) }
    expect(forwardProgress(hx, start)).toBeGreaterThan(8)
    expect(maxTilt).toBeLessThan(0.2)
  })
})
