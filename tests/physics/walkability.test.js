// Can the IK gait walk this robot? Legs that cannot lift a foot (one hip-pitch
// servo per leg — the "micro duck" biped) must be reported so the app hands the
// robot to the kinematic legged path instead of standing still forever.
import { describe, it, expect } from 'vitest'
import { makeWorld, seconds, forwardProgress } from './helpers.js'
import { buildQuadruped, buildHexapod, buildLeggedRobot } from '../../src/managers/physics/robotics/robotTemplates.js'

/** Body + two straight legs, ONE hip-pitch servo each, flat feet. */
function duck() {
  const H = 5, hipY = 4
  const links = [{ id: 'base', origin: { x: 0, y: H, z: 0 }, colliders: [{ shape: 'box', halfExtents: { x: 2.5, y: 1.5, z: 2 }, offset: { p: { x: 0, y: 0, z: 0 } }, mass: 0.5, material: 'plastic' }] }]
  const joints = [], actuators = []
  for (const [i, x] of [[0, -1.8], [1, 1.8]]) {
    const hip = { x, y: hipY, z: 0 }
    links.push({ id: `leg${i}`, origin: hip, colliders: [
      { shape: 'box', halfExtents: { x: 0.4, y: 1.8, z: 0.4 }, offset: { p: { x: 0, y: -1.8, z: 0 } }, mass: 0.1 },
      { shape: 'box', halfExtents: { x: 0.7, y: 0.2, z: 1.2 }, offset: { p: { x: 0, y: -3.8, z: 0 } }, mass: 0.03, material: 'rubber' },
    ] })
    joints.push({ id: `hip${i}`, type: 'revolute', parent: 'base', child: `leg${i}`, anchor: hip, axis: { x: 1, y: 0, z: 0 }, limits: { min: -1.2, max: 1.2 } })
    actuators.push({ id: `s${i}`, jointId: `hip${i}`, kind: 'servo', componentId: `s${i}`, spec: { preset: 'ds3218' } })
  }
  return { id: 'duck', baseLinkId: 'base', forward: { x: 0, y: 0, z: -1 }, links, joints, actuators, imu: { linkId: 'base' }, locomotion: { type: 'legs', gait: {}, balance: {} } }
}

/** Two 3-DOF legs with flat feet. */
function flatBiped() {
  const g = buildLeggedRobot({ name: 'Biped', footRadius: 0.2, body: { hx: 2, hy: 1.5, hz: 1.2, mass: 0.5 }, legs: [{ x: -1.6, z: 0 }, { x: 1.6, z: 0 }] })
  for (const l of g.links) if (l.isFoot) l.colliders[1] = { shape: 'box', halfExtents: { x: 0.9, y: 0.2, z: 1.4 }, offset: l.colliders[1].offset, mass: 0.02, material: 'rubber' }
  return g
}

describe('walkability', () => {
  it('one hip-pitch servo per leg cannot lift a foot', async () => {
    const { rt } = await makeWorld()
    const w = rt.addRobot(duck()).walkability()
    expect(w.ok).toBe(false)
    expect(w.legs).toBe(2)
    expect(w.stuckLegs).toHaveLength(2)
  })

  it('a biped with hip+knee pitch only cannot balance on one foot', async () => {
    const { rt } = await makeWorld()
    const g = buildLeggedRobot({ dof: 2, footRadius: 0.2, body: { hx: 2, hy: 1.5, hz: 1.2, mass: 0.5 }, legs: [{ x: -1.6, z: 0 }, { x: 1.6, z: 0 }] })
    const w = rt.addRobot(g).walkability()
    expect(w.ok).toBe(false)
    expect(w.reason).toMatch(/roll/)
  })

  it('quadruped, hexapod and a 3-DOF biped can', async () => {
    for (const g of [buildQuadruped(), buildHexapod(), flatBiped()]) {
      const { rt } = await makeWorld()
      expect(rt.addRobot(g).walkability()).toMatchObject({ ok: true })
    }
  })

  it('a flat-footed biped with real legs walks forward on the gait', async () => {
    const { rt } = await makeWorld()
    const r = rt.addRobot(flatBiped())
    rt.run(seconds(rt, 1))
    const start = { ...r.basePose().p }
    r.setMode('gait'); r.setCommand({ forward: 1 })
    rt.run(seconds(rt, 8))
    expect(forwardProgress(r, start)).toBeGreaterThan(4)
    expect(r.bodyGroundContact).toBe(false)
  })
})
