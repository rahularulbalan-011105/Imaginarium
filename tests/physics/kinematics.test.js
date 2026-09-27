// Forward/inverse kinematics, centre of mass, support polygon.
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { KinematicChain } from '../../src/managers/physics/robotics/kinematics.js'
import { centerOfMass, convexHull2D, supportMargin, analyzeSupport } from '../../src/managers/physics/robotics/stability.js'
import { makeWorld } from './helpers.js'
import { buildQuadruped } from '../../src/managers/physics/robotics/robotTemplates.js'

// Deterministic PRNG for reproducible random configurations.
function rng(seed) { let a = seed; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296) }

const leg3 = () => new KinematicChain([
  { axis: { x: 0, y: 0, z: -1 }, point: { x: 0, y: 0, z: 0 }, min: -0.6, max: 0.6 },   // abduction
  { axis: { x: 1, y: 0, z: 0 }, point: { x: 0, y: 0, z: 0 }, min: -1.2, max: 1.2 },    // hip pitch
  { axis: { x: 1, y: 0, z: 0 }, point: { x: 0, y: -1.3, z: -0.9 }, min: -1.5, max: 1.5 }, // knee
], { x: 0, y: -3.1, z: 0 })

describe('kinematics', () => {
  it('11. forward kinematics matches the analytic 2-link planar arm', () => {
    const c = new KinematicChain([
      { axis: { x: 0, y: 0, z: 1 }, point: { x: 0, y: 0, z: 0 } },
      { axis: { x: 0, y: 0, z: 1 }, point: { x: 1, y: 0, z: 0 } },
    ], { x: 2.5, y: 0, z: 0 })
    const r = rng(3)
    for (let k = 0; k < 20; k++) {
      const a = (r() - 0.5) * 6, b = (r() - 0.5) * 6
      const p = c.fk([a, b])
      expect(p.x).toBeCloseTo(Math.cos(a) + 1.5 * Math.cos(a + b), 9)
      expect(p.y).toBeCloseTo(Math.sin(a) + 1.5 * Math.sin(a + b), 9)
    }
  })

  it('11b. forward kinematics handles prismatic joints', () => {
    const c = new KinematicChain([{ type: 'prismatic', axis: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 0, z: 0 } }], { x: 1, y: 0, z: 0 })
    expect(c.fk([0.7]).y).toBeCloseTo(0.7, 9)
  })

  it('12. inverse kinematics reaches reachable targets and respects joint limits', () => {
    const c = leg3(), r = rng(9)
    let ok = 0
    for (let k = 0; k < 50; k++) {
      const q = c.joints.map(j => j.min + (j.max - j.min) * (0.15 + 0.7 * r()))
      const target = c.fk(q).clone()
      const res = c.ik(target, [0, 0, 0], { tolerance: 1e-3, maxIterations: 80 })
      res.theta.forEach((t, i) => { expect(t).toBeGreaterThanOrEqual(c.joints[i].min - 1e-9); expect(t).toBeLessThanOrEqual(c.joints[i].max + 1e-9) })
      if (res.status === 'ok') { ok++; expect(res.error).toBeLessThan(1e-3) }
    }
    expect(ok).toBeGreaterThanOrEqual(45)
  })

  it('12b. inverse kinematics reports impossible targets instead of faking them', () => {
    const c = leg3()
    const far = c.ik({ x: 0, y: -50, z: 0 }, [0, 0, 0])
    expect(['unreachable', 'limited']).toContain(far.status)
    expect(far.error).toBeGreaterThan(40)
    expect(c.ik({ x: NaN, y: 0, z: 0 }).status).toBe('invalid')
  })

  it('12c. 6-D inverse kinematics solves position AND orientation for a 6-DOF arm', () => {
    const arm = new KinematicChain([
      { axis: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 0, z: 0 } },
      { axis: { x: 1, y: 0, z: 0 }, point: { x: 0, y: 1, z: 0 } },
      { axis: { x: 1, y: 0, z: 0 }, point: { x: 0, y: 3, z: 0 } },
      { axis: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 4, z: 0 } },
      { axis: { x: 1, y: 0, z: 0 }, point: { x: 0, y: 5, z: 0 } },
      { axis: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 5.5, z: 0 } },
    ], { x: 0, y: 6, z: 0 })
    const q = [0.3, 0.4, -0.5, 0.2, 0.6, -0.3]
    const oq = new THREE.Quaternion()
    const pos = arm.fk(q, new THREE.Vector3(), oq)
    const res = arm.ik(pos, [0, 0, 0, 0, 0, 0], { orientation: { x: oq.x, y: oq.y, z: oq.z, w: oq.w }, tolerance: 1e-3, maxIterations: 200 })
    expect(res.status).toBe('ok')
    expect(res.error).toBeLessThan(1e-3)
    expect(res.orientationError).toBeLessThan(1e-2)
  })
})

describe('centre of mass & support polygon', () => {
  it('17. COM = Σmᵢrᵢ / Σmᵢ, and the robot reports its physical mass', async () => {
    const c = centerOfMass([
      { mass: 1, com: { x: 0, y: 0, z: 0 } },
      { mass: 3, com: { x: 4, y: 2, z: -8 } },
    ])
    expect(c.com).toEqual({ x: 3, y: 1.5, z: -6 })
    expect(c.mass).toBe(4)

    const { rt } = await makeWorld()
    const g = buildQuadruped()
    const robot = rt.addRobot(g)
    rt.step()
    const graphMass = g.links.flatMap(l => l.colliders).reduce((s, c) => s + c.mass, 0)
    expect(robot.stability.mass).toBeCloseTo(graphMass, 4)
    // Symmetric robot → COM on its centre line.
    expect(Math.abs(robot.stability.com.x)).toBeLessThan(0.02)
  })

  it('18. support polygon classifies stable / marginal / unstable', () => {
    const feet = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }].map(f => ({ x: f.x, y: 0, z: f.z }))
    expect(analyzeSupport({ x: 0, y: 3, z: 0 }, feet, 0.3).state).toBe('stable')
    expect(analyzeSupport({ x: 1.9, y: 3, z: 0 }, feet, 0.3).state).toBe('marginal')
    const out = analyzeSupport({ x: 3, y: 3, z: 0 }, feet, 0.3)
    expect(out.state).toBe('unstable')
    expect(out.margin).toBeCloseTo(-1, 6)
    // Two feet can't statically support anything.
    expect(analyzeSupport({ x: 0, y: 3, z: 0 }, feet.slice(0, 2), 0.3).state).toBe('unstable')
    expect(convexHull2D([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.5, y: 0.5 }]).length).toBe(4)
    expect(supportMargin({ x: 0.5, y: 0.5 }, convexHull2D([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]))).toBeCloseTo(0.5, 9)
  })
})
