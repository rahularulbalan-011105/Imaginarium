import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { createWheelGeometry, createWheelParts, createCasterGeometry, createCasterParts, createGeometry } from '../../src/utils/geometryFactory.js'
import { WHEEL_DEFAULTS, CASTER_DEFAULTS, sideDriveRadius, wheelWorldRadius, wheelSpeedFactor } from '../../src/utils/wheels.js'
import { DifferentialDrive, DEFAULT_DRIVE_RADIUS } from '../../src/managers/robot/DifferentialDrive.js'
import { getMass } from '../../src/managers/physics/MassCalculator.js'

// Signed volume (same formula as MassCalculator): > 0 ⇔ faces wound outward.
function signedVolume(geo) {
  const pos = geo.attributes.position, idx = geo.index
  const at = (i) => (idx ? idx.getX(i) : i)
  const n = idx ? idx.count : pos.count
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  let v = 0
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, at(i)); b.fromBufferAttribute(pos, at(i + 1)); c.fromBufferAttribute(pos, at(i + 2))
    v += a.dot(b.clone().cross(c))
  }
  return v / 6
}
const size = (geo) => { geo.computeBoundingBox(); return geo.boundingBox.getSize(new THREE.Vector3()) }

describe('wheel geometry', () => {
  it('stands upright: axle along X, diameter across Y/Z', () => {
    const s = size(createWheelGeometry({ diameter: WHEEL_DEFAULTS.wheelDiameter, width: WHEEL_DEFAULTS.wheelWidth }))
    expect(s.x).toBeCloseTo(WHEEL_DEFAULTS.wheelWidth, 3)
    // flat-topped tread blocks → a polygon outline, within 1% of the nominal ⌀
    expect(s.y).toBeCloseTo(3.4, 1)
    expect(s.z).toBeCloseTo(3.4, 1)
  })

  it('tyre and rim are each wound outward (not black, inside-out parts)', () => {
    const { tyre, rim } = createWheelParts({ diameter: 3.4, width: 1.3 })
    expect(signedVolume(tyre)).toBeGreaterThan(0)
    expect(signedVolume(rim)).toBeGreaterThan(0)
    // tyre is the big rubber ring; the spoked rim is much lighter than a disc
    const disc = Math.PI * 1.7 * 1.7 * 1.3
    expect(signedVolume(tyre)).toBeLessThan(disc * 0.6)
    expect(signedVolume(rim)).toBeLessThan(disc * 0.3)
  })

  it('tread blocks never stick out past the requested diameter', () => {
    for (const d of [1.5, 3.4, 8]) {
      const s = size(createWheelGeometry({ diameter: d, width: 1.3 }))
      expect(Math.max(s.y, s.z)).toBeLessThanOrEqual(d + 1e-6)
      expect(Math.max(s.y, s.z)).toBeGreaterThan(d * 0.99)
    }
  })
})

describe('caster geometry', () => {
  it('is exactly the requested height and closed/outward', () => {
    const g = createCasterGeometry({ height: CASTER_DEFAULTS.casterHeight, ball: CASTER_DEFAULTS.casterBall })
    expect(size(g).y).toBeCloseTo(CASTER_DEFAULTS.casterHeight, 3)
    expect(signedVolume(g)).toBeGreaterThan(0)
  })

  it('body and steel ball are separate, outward-wound parts; ball is the lowest point', () => {
    const H = 1.6
    const { body, ball } = createCasterParts({ height: H, ball: 1.0 })
    expect(signedVolume(body)).toBeGreaterThan(0)
    expect(signedVolume(ball)).toBeGreaterThan(0)
    ball.computeBoundingBox(); body.computeBoundingBox()
    expect(ball.boundingBox.min.y).toBeCloseTo(-H / 2, 6)            // ball touches the ground
    expect(body.boundingBox.min.y).toBeGreaterThan(ball.boundingBox.min.y)
    expect(body.boundingBox.max.y).toBeCloseTo(H / 2, 6)              // flange top
    const s = body.boundingBox.getSize(new THREE.Vector3())
    expect(s.x).toBeCloseTo(s.z, 1)                                   // round flange
    const housingDia = 2 * 1.22 * 0.5                                 // housing radius = 1.22 × ball radius
    expect(s.x).toBeGreaterThan(housingDia * 1.8)                     // flange ≈ 2× the housing
  })

  it('a ball too big for the height is shrunk, height still honoured', () => {
    const g = createCasterGeometry({ height: 0.8, ball: 3 })
    expect(size(g).y).toBeCloseTo(0.8, 3)
    expect(signedVolume(g)).toBeGreaterThan(0)
  })

  it('wheel and caster get a real mass from their shape', () => {
    expect(getMass('wheel', { x: 1, y: 1, z: 1 }, 'standard')).toBeGreaterThan(0.001)
    expect(getMass('caster', { x: 1, y: 1, z: 1 }, 'metallic')).toBeGreaterThan(0.001)
    expect(createGeometry('caster').attributes.position.count).toBeGreaterThan(0)
  })
})

describe('wheel size → drive speed', () => {
  const wheel = (id, d, scale = { x: 1, y: 1, z: 1 }) => ({ id, type: 'wheel', wheelDiameter: d, scale })
  const scene = (...objs) => new Map(objs.map((o) => [o.id, o]))

  it('no Wheel part → old fixed radius (existing projects unchanged)', () => {
    expect(sideDriveRadius(['m1'], {}, scene())).toBe(DEFAULT_DRIVE_RADIUS)
    // Library "Wheels" model / any other part on the motor also keeps the old radius
    const model = { id: 'w', type: 'model', modelKey: 'free_wheels', scale: { x: 3, y: 3, z: 3 } }
    expect(sideDriveRadius(['m1'], { w: 'm1' }, scene(model))).toBe(DEFAULT_DRIVE_RADIUS)
  })

  it('default wheel drives exactly as before; double diameter → double radius', () => {
    expect(sideDriveRadius(['m1'], { w: 'm1' }, scene(wheel('w', WHEEL_DEFAULTS.wheelDiameter)))).toBeCloseTo(DEFAULT_DRIVE_RADIUS, 9)
    expect(sideDriveRadius(['m1'], { w: 'm1' }, scene(wheel('w', 6.8)))).toBeCloseTo(DEFAULT_DRIVE_RADIUS * 2, 9)
    expect(wheelSpeedFactor(wheelWorldRadius(wheel('w', 1.7)))).toBeCloseTo(0.5, 9)
  })

  it('scale counts (Y/Z, the radial axes)', () => {
    expect(wheelWorldRadius(wheel('w', 3.4, { x: 5, y: 2, z: 2 }))).toBeCloseTo(3.4, 9)
  })

  it('side average: a motor without a Wheel part keeps the default', () => {
    const r = sideDriveRadius(['m1', 'm2'], { w: 'm1' }, scene(wheel('w', 6.8)))
    expect(r).toBeCloseTo((DEFAULT_DRIVE_RADIUS * 2 + DEFAULT_DRIVE_RADIUS) / 2, 9)
  })

  it('drive model: unset radii = original speed; bigger right wheel → turns', () => {
    const plain = new DifferentialDrive()
    expect(plain.compute(255, 255).v).toBeCloseTo(20 * 7.4 * 2 * Math.PI / 60 * 0.40, 9)
    const uneven = new DifferentialDrive({ radiusLeft: 0.40, radiusRight: 0.80 })
    const out = uneven.compute(255, 255)
    expect(out.v).toBeGreaterThan(plain.compute(255, 255).v)
    expect(out.omega).toBeGreaterThan(0)
  })
})
