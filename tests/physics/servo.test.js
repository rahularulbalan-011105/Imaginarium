// Servo actuator physics: tracking, torque limiting, stall, backlash/deadband,
// torque-speed curve, overheating, battery sag/depletion.
import { describe, it, expect } from 'vitest'
import { makeWorld, seconds, jointRig } from './helpers.js'
import { ServoActuator, resolveServoSpec } from '../../src/managers/physics/robotics/ServoActuator.js'
import { BatteryModel } from '../../src/managers/physics/robotics/BatteryModel.js'
import { L } from '../../src/managers/physics/robotics/units.js'

const G = 9.81

describe('servo actuator', () => {
  it('5. servo reaches its target through torque (no teleport) and tracks it', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(jointRig({ servo: { preset: 'mg996r' } }))
    robot.setMode('direct'); robot.directTargets.set('s', 0.6)
    const J = robot.joints.get('j')
    // First step: the joint has barely moved — it has to accelerate.
    rt.step(); robot.measureJoint(J)
    expect(Math.abs(J.angle)).toBeLessThan(0.05)
    rt.run(seconds(rt, 0.6))
    robot.measureJoint(J)
    expect(J.angle).toBeGreaterThan(0.6 - 0.04)
    expect(J.angle).toBeLessThan(0.6 + 0.04)
  })

  it('6. output torque never exceeds the (voltage-scaled) stall torque', async () => {
    const { rt } = await makeWorld()
    // Arm load ≈ 0.6 × MG996R stall torque at its lever.
    const lever = 1.5 * L, tauStall = 1.08
    const mass = (0.6 * tauStall) / (G * lever)
    const robot = rt.addRobot(jointRig({ arm: { x: 0, y: 0, z: -1.5 }, armMass: mass, servo: { preset: 'mg996r' } }))
    robot.setMode('direct'); robot.directTargets.set('s', 0)
    const A = robot.actuators.get('s')
    let maxTau = 0
    for (let i = 0; i < seconds(rt, 2); i++) { rt.step(); maxTau = Math.max(maxTau, Math.abs(A.servo.motorTorque)) }
    const vScale = Math.min(1, robot.battery.voltage / A.servo.spec.nominalVoltage)
    expect(maxTau).toBeLessThanOrEqual(tauStall * Math.max(vScale, 0.95) + 1e-6)
    robot.measureJoint(robot.joints.get('j'))
    expect(Math.abs(robot.joints.get('j').angle)).toBeLessThan(0.15)   // it can hold this load
  })

  it('7. an overloaded servo cannot lift its load: it saturates and the load wins', async () => {
    const { rt } = await makeWorld()
    const lever = 1.5 * L, tauStall = 0.216                 // MG90S
    const mass = (2.5 * tauStall) / (G * lever)             // needs 2.5× what it has
    const robot = rt.addRobot(jointRig({ arm: { x: 0, y: 0, z: -1.5 }, armMass: mass, servo: { preset: 'mg90s' } }))
    robot.setMode('direct'); robot.directTargets.set('s', 0.3)   // try to lift it
    const A = robot.actuators.get('s'), J = robot.joints.get('j')
    let maxAngle = -Infinity, satSteps = 0, n = 0
    for (let i = 0; i < seconds(rt, 2); i++) {
      rt.step(); robot.measureJoint(J); n++
      maxAngle = Math.max(maxAngle, J.angle)
      if (A.servo.saturated) satSteps++
      // Stall torque scales with bus voltage (MG90S is rated at 4.8 V; the pack is ~5.3 V).
      expect(Math.abs(A.servo.motorTorque)).toBeLessThanOrEqual(A.servo.spec.maxTorque * robot.battery.voltage / A.servo.spec.nominalVoltage + 1e-6)
    }
    expect(maxAngle).toBeLessThan(0.05)                     // never got the load up to its target
    expect(satSteps / n).toBeGreaterThan(0.8)               // pushing flat-out the whole time
  })

  it('7b. a servo blocked by a hard stop stalls at full torque', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(jointRig({ arm: { x: 0, y: 0, z: -1.5 }, armMass: 0.05, joint: { limits: { min: -1.5, max: 0.2 } }, servo: { preset: 'mg90s' } }))
    robot.setMode('direct'); robot.directTargets.set('s', 0.8)
    rt.run(seconds(rt, 1))
    const A = robot.actuators.get('s'), J = robot.joints.get('j')
    robot.measureJoint(J)
    expect(J.angle).toBeLessThan(0.23)                      // the stop holds
    expect(A.servo.stalled).toBe(true)
    expect(A.servo.saturated).toBe(true)
    expect(Math.abs(A.servo.motorTorque)).toBeGreaterThan(0.9 * A.servo.torqueLimit)
    expect(A.servo.current).toBeGreaterThan(0.5 * A.servo.spec.stallCurrent)   // stall current flows
  })

  it('servo unit: deadband turns the motor off, backlash delays reversal', () => {
    const s = new ServoActuator({ preset: 'mg90s', backlash: 2 * Math.PI / 180 })
    s.setTarget(s.spec.deadband * 0.5)
    for (let i = 0; i < 50; i++) s.update(1 / 240, 0, 0, 1e-4)
    expect(s.motor.active).toBe(false)                      // inside the deadband

    const b = new ServoActuator({ preset: 'mg90s', backlash: 4 * Math.PI / 180 })
    b.setTarget(0.5); b.update(1 / 240, 0, 0, 1e-4)        // engage in +
    let engagedSteps = 0
    for (let i = 0; i < 20 && !b.motor.active; i++) { b.update(1 / 240, 0, 0, 1e-4); engagedSteps++ }
    b.setTarget(-0.5)                                       // reverse
    let slackSteps = 0
    while (!b.motor.active || b.motorTorque >= 0) { b.update(1 / 240, 0, 0, 1e-4); if (++slackSteps > 50) break }
    const expected = (4 * Math.PI / 180) / (b.spec.maxVelocity / 240)
    expect(slackSteps).toBeGreaterThanOrEqual(Math.floor(expected * 0.8))
  })

  it('servo unit: available torque falls along the DC torque-speed line', () => {
    const s = new ServoActuator({ preset: 'mg996r' })
    s.setTarget(1.4)
    for (let i = 0; i < 400; i++) s.update(1 / 240, 0, 0, 1e-3)      // setpoint reaches the target
    const wNl = s.spec.maxVelocity
    // Joint moving TOWARD the target (motoring) at a steady speed.
    for (let i = 0; i < 60; i++) s.update(1 / 240, 0, 0.5 * wNl, 1e-3)
    expect(s.motorTorque).toBeGreaterThan(0)
    expect(s.torqueLimit).toBeCloseTo(s.spec.maxTorque * 0.5, 2)
    for (let i = 0; i < 60; i++) s.update(1 / 240, 0, 0.95 * wNl, 1e-3)
    expect(s.torqueLimit).toBeLessThan(s.spec.maxTorque * 0.06)
    // Moving AWAY from the target (braking): full stall torque is available.
    for (let i = 0; i < 60; i++) s.update(1 / 240, 0, -0.5 * wNl, 1e-3)
    expect(s.torqueLimit).toBeCloseTo(s.spec.maxTorque, 2)
  })

  const blockedRig = (thermal) => {
    const g = jointRig({ arm: { x: 0, y: 0, z: -1.5 }, armMass: 0.05, joint: { limits: { min: -1.5, max: 0.2 } }, servo: { preset: 'mg90s' } })
    g.actuators[0].thermal = { heatCapacity: 0.05, thermalResistance: 25, maxTemp: 90, recoverTemp: 60, ...thermal }
    return g
  }

  it('21. thermal derating: a stalled servo heats, loses torque, and settles below cut-out', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(blockedRig({ deratingStart: 70 }))
    robot.setMode('direct'); robot.directTargets.set('s', 0.8)      // blocked → stall current → heat
    const A = robot.actuators.get('s')
    rt.run(seconds(rt, 0.2))
    const coldTorque = Math.abs(A.servo.motorTorque)
    rt.run(seconds(rt, 3))
    expect(A.servo.temperature).toBeGreaterThan(70)
    expect(A.servo.temperature).toBeLessThan(90)
    expect(A.servo.overheated).toBe(false)
    expect(Math.abs(A.servo.motorTorque)).toBeLessThan(0.85 * coldTorque)   // derated
  })

  it('21b. without derating a stalled servo overheats, cuts out (limp), cools and recovers', async () => {
    const { rt } = await makeWorld()
    const robot = rt.addRobot(blockedRig({ deratingStart: 90 }))
    robot.setMode('direct'); robot.directTargets.set('s', 0.8)
    const A = robot.actuators.get('s')
    let overheatedAt = null, recoveredAt = null, peak = 0, torqueWhileCut = 0
    for (let i = 0; i < seconds(rt, 6); i++) {
      const wasCut = A.servo.overheated          // the cut-out trips at the END of a step
      rt.step()
      peak = Math.max(peak, A.servo.temperature)
      if (wasCut && A.servo.overheated) torqueWhileCut = Math.max(torqueWhileCut, Math.abs(A.servo.motorTorque))
      if (A.servo.overheated && overheatedAt == null) overheatedAt = i
      else if (!A.servo.overheated && overheatedAt != null && recoveredAt == null) recoveredAt = i
    }
    expect(overheatedAt).not.toBeNull()
    expect(peak).toBeGreaterThanOrEqual(90)
    expect(torqueWhileCut).toBe(0)                          // cut-out: no motor torque at all
    expect(recoveredAt).not.toBeNull()                      // cooled below recoverTemp → back on
  })
})

describe('battery / power', () => {
  it('voltage sags under load and depletes over time', () => {
    const b = new BatteryModel({ chemistry: 'nimh', cells: 4, capacity_mAh: 100, internalResistance: 0.2 })
    const vIdle = b.step(0.01, 0)
    const vLoad = b.step(0.01, 5)
    expect(vIdle - vLoad).toBeCloseTo(5 * 0.2, 1)           // I·R sag
    let t = 0
    while (!b.brownout && t < 1000) { b.step(0.1, 2); t += 0.1 }
    expect(b.brownout).toBe(true)
    expect(t).toBeGreaterThan(100 * 3.6 / 2 * 0.8)          // ≈ capacity / current
    expect(b.energyUsed_J).toBeGreaterThan(0)
  })

  it('current limit scales the actuators down instead of drawing impossible current', () => {
    const b = new BatteryModel({ maxCurrent: 3 })
    b.step(0.01, 6)
    expect(b.currentLimited).toBe(true)
    expect(b.supplyScale).toBeCloseTo(0.5, 5)
    expect(b.current).toBe(3)
  })

  it('resolveServoSpec derives PD gains and electrical constants from datasheet values', () => {
    const s = resolveServoSpec({ preset: 'mg996r' })
    expect(s.kp).toBeGreaterThan(0)
    expect(s.windingResistance).toBeCloseTo(6 / 2.5, 5)
    expect(s.kt).toBeCloseTo(1.08 / (2.5 - 0.01), 5)
  })
})
