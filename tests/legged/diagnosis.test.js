// "Why isn't it moving?" — every reason is tagged CAD / Electronics / Code.
import { describe, it, expect } from 'vitest'
import {
  walkabilityIssue, servoWiring, servoWiringIssues, attachIssue, stuckIssue, MotionWatchdog,
} from '../../src/managers/physics/robotics/diagnosis.js'

const S = (id, name) => ({ id, name })
const W = (from, to) => ({ fromPinId: from, toPinId: to })
const full = (id, pin) => [W(`${id}:SIGNAL`, `uno:D${pin}`), W(`${id}:VCC`, 'uno:5V'), W(`${id}:GND`, 'uno:GND2')]

describe('CAD: walkability', () => {
  it('1-servo legs → legs can’t lift a foot (CAD error)', () => {
    const i = walkabilityIssue({ ok: false, reason: '4 of 4 legs cannot lift a foot straight up', legs: 4, stuckLegs: ['a', 'b', 'c', 'd'] })
    expect(i.category).toBe('cad')
    expect(i.title).toMatch(/4 of 4 legs/)
    expect(i.fix).toMatch(/knee/)
  })
  it('biped with no roll joint → can’t balance on one foot (CAD)', () => {
    const i = walkabilityIssue({ ok: false, reason: 'a two-legged robot needs a side-to-side (hip or ankle roll) servo to balance on one foot', legs: 2, stuckLegs: ['l'] })
    expect(i.category).toBe('cad')
    expect(i.fix).toMatch(/roll/)
  })
  it('walkable → no issue', () => expect(walkabilityIssue({ ok: true })).toBeNull())
})

describe('Electronics: servo wiring', () => {
  const servos = [S('s1', 'Servo_1'), S('s2', 'Servo_2'), S('s3', 'Servo_3')]
  it('reads signal pin and power from the wires', () => {
    const w = servoWiring(servos, [...full('s1', 8), W('s2:SIGNAL', 'uno:D9'), W('s3:VCC', 'uno:5V'), W('s3:GND', 'uno:GND')])
    expect(w.get('s1')).toMatchObject({ signalPin: 8, powered: true })
    expect(w.get('s2')).toMatchObject({ signalPin: 9, powered: false })
    expect(w.get('s3')).toMatchObject({ signalPin: null, powered: true })
    const ids = servoWiringIssues(servos, w).map(i => i.id)
    expect(ids).toEqual(['elec:servo-power', 'elec:servo-signal'])
    expect(servoWiringIssues(servos, w).every(i => i.category === 'electronics')).toBe(true)
  })
  it('fully wired servos → no issues', () => {
    const w = servoWiring(servos, [...full('s1', 8), ...full('s2', 9), ...full('s3', 10)])
    expect(servoWiringIssues(servos, w)).toEqual([])
  })
})

describe('attach on an empty pin: Electronics or Code?', () => {
  const servos = [S('s1', 'Servo_1'), S('s2', 'Servo_2')]
  it('a servo is unwired → Electronics (wire it to that pin)', () => {
    const i = attachIssue(9, servos, servoWiring(servos, full('s1', 8)))
    expect(i.category).toBe('electronics')
    expect(i.fix).toMatch(/pin 9/)
  })
  it('every servo is wired, just elsewhere → Code (wrong pin in the sketch)', () => {
    const i = attachIssue(11, servos, servoWiring(servos, [...full('s1', 2), ...full('s2', 3)]))
    expect(i.category).toBe('code')
    expect(i.detail).toMatch(/pin 2, pin 3/)
  })
})

describe('stuck robot: which reason', () => {
  const t = (over = {}) => ({ battery: { brownout: false }, stability: { bodyContact: false, groundedFeet: 4, mass: 1.2 }, ...over })
  it('brownout → Electronics', () => expect(stuckIssue(t({ battery: { brownout: true } }), { mode: 'gait' }).category).toBe('electronics'))
  it('fallen → CAD', () => expect(stuckIssue(t({ stability: { bodyContact: true, groundedFeet: 0 } }), { mode: 'gait' }).id).toBe('run:fallen'))
  it('stalling servos → CAD (too weak)', () => expect(stuckIssue(t(), { mode: 'gait', stalledFrac: 0.8 }).id).toBe('run:servo-weak'))
  it('slipping feet → CAD', () => expect(stuckIssue(t(), { mode: 'gait', slipFrac: 0.9 }).id).toBe('run:slip'))
  it('own servo pattern that cancels → Code', () => expect(stuckIssue(t(), { mode: 'direct', walkable: true }).category).toBe('code'))
})

describe('MotionWatchdog', () => {
  const DT = 1 / 60
  it('commanded but not moving for the window → stuck; progress → moving', () => {
    const w = new MotionWatchdog({ window: 1 })
    let ev = null
    for (let i = 0; i < 70 && !ev; i++) ev = w.update(DT, true, { x: 0, z: 0, yaw: 0 })
    expect(ev).toBe('stuck')
    expect(w.update(DT, true, { x: 0, z: -1, yaw: 0 })).toBe('moving')
  })
  it('turning on the spot counts as moving', () => {
    const w = new MotionWatchdog({ window: 1 })
    let ev = null
    for (let i = 0; i < 70; i++) ev = w.update(DT, true, { x: 0, z: 0, yaw: i * 0.02 }) ?? ev
    expect(ev).toBeNull()
  })
  it('not commanded → never stuck', () => {
    const w = new MotionWatchdog({ window: 0.5 })
    for (let i = 0; i < 100; i++) expect(w.update(DT, false, { x: 0, z: 0 })).toBeNull()
  })
})

describe('fall detection', () => {
  it('tilt from a quaternion: upright 0°, on its face 90°', async () => {
    const { tiltDeg, fallenIssue } = await import('../../src/managers/physics/robotics/diagnosis.js')
    expect(tiltDeg({ x: 0, y: 0, z: 0, w: 1 })).toBeCloseTo(0)
    const h = Math.SQRT1_2
    expect(tiltDeg({ x: h, y: 0, z: 0, w: h })).toBeCloseTo(90)
    expect(tiltDeg({ x: 0, y: h, z: 0, w: h })).toBeCloseTo(0)      // yaw is not a tilt
    expect(fallenIssue(88).category).toBe('cad')
  })
})

describe('weight: is the robot too heavy for its servos?', async () => {
  const { servoLoads, weightIssues, looseIssue } = await import('../../src/managers/physics/robotics/diagnosis.js')
  const L = 0.05                                    // m per scene unit
  const X = { x: 1, y: 0, z: 0 }
  const DS3218 = 2.06, SG90 = 0.176                 // N·m stall
  // 4 legs; hip 4 su (20 cm) above the foot, foot 1 su (5 cm) in front of the hip.
  const quad = (maxTorque) => ({
    legs: [[-2, -3], [2, -3], [-2, 3], [2, 3]].map(([x, z]) => ({
      foot: { x, y: 0, z: z - 1 },
      joints: [{ anchor: { x, y: 4, z }, axis: X, servo: { name: `hip ${x},${z}`, maxTorque } }],
    })),
  })
  it('1000 kg body on weak legs → can’t even stand (error)', () => {
    const r = { ...quad(SG90), massKg: 1000 }
    const [i] = weightIssues(1000, servoLoads(r, L))
    expect(i.id).toBe('cad:weight-stand')
    expect(i.category).toBe('cad')
    expect(i.title).toMatch(/1000 kg/)
  })
  it('a 1 kg robot on DS3218s → fine', () => {
    const r = { ...quad(DS3218), massKg: 1 }
    expect(weightIssues(1, servoLoads(r, L))).toEqual([])
  })
  it('stands but too heavy to step → walk error', () => {
    // stand: 4 legs share (0.12 N·m); walk: 2 legs, ≥15° lever (0.26 N·m) — 1 kg on SG90s (0.176)
    const r = { ...quad(SG90), massKg: 1 }
    const loads = servoLoads(r, L)
    expect(loads[0].standNm).toBeLessThan(SG90)
    expect(weightIssues(1, loads)[0].id).toBe('cad:weight-walk')
  })
  it('a leg straight under its joint still gets a stepping lever', () => {
    const r = { massKg: 5, legs: [{ foot: { x: 0, y: 0, z: 0 }, joints: [{ anchor: { x: 0, y: 4, z: 0 }, axis: X, servo: { name: 'h', maxTorque: 1 } }] }] }
    const [ld] = servoLoads(r, L)
    expect(ld.standNm).toBeCloseTo(0)
    expect(ld.walkNm).toBeGreaterThan(0)
  })
  it('loose parts → CAD issue naming them', () => {
    expect(looseIssue([])).toBeNull()
    const i = looseIssue(['Box_7'])
    expect(i.category).toBe('cad')
    expect(i.title).toMatch(/Box_7 isn't attached/)
  })
})
