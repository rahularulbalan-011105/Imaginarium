// Part mass = real volume × density. Regression: a capsule (and other shapes
// without an analytic formula) used to fall through to a solid-cube estimate —
// a 5× capsule weighed 125 kg instead of ~34 kg.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/managers/ObjectManager.js', () => ({ objectManager: { getMesh: () => null } }))

const { getMassForObject, effectiveMass, totalMass } = await import('../../src/managers/physics/MassCalculator.js')
const obj = (type, s = 1) => ({ id: type, type, scale: { x: s, y: s, z: s } })
const SU = 0.05 // m per scene unit

describe('part mass', () => {
  it('capsule uses its real volume, not a bounding cube', () => {
    // CapsuleGeometry(r 0.6, length 1.2): π r² L + 4/3 π r³ (su³)
    const vSU = Math.PI * 0.36 * 1.2 + (4 / 3) * Math.PI * 0.216
    const expected = vSU * 125 * SU ** 3 * 1000
    const m = getMassForObject(obj('capsule', 5))
    expect(m).toBeGreaterThan(expected * 0.95)        // tessellation is slightly under the true solid
    expect(m).toBeLessThanOrEqual(expected)
    expect(m).toBeLessThan(40)                        // was 125 kg
  })

  it('analytic shapes are unchanged', () => {
    expect(getMassForObject(obj('box'))).toBeCloseTo(1, 6)                                   // 10 cm cube of water
    const cyl = Math.PI * 2 * SU ** 3 * 1000                                                 // r 1, h 2
    expect(Math.abs(getMassForObject(obj('cylinder')) / cyl - 1)).toBeLessThan(0.01)         // 32-sided mesh
  })

  it('every electronics part has a real fixed weight (never a volume block)', () => {
    for (const t of ['arduino', 'subo', 'servo', 'motor_dc', 'motor_bo', 'led', 'ultrasonic', 'ir_sensor',
                     'gas_sensor', 'color_sensor', 'ldr_sensor', 'dht11', 'oled', 'buzzer']) {
      const m = getMassForObject(obj(t, 3))
      expect(m, t).toBeLessThan(0.2)
    }
    expect(getMassForObject(obj('motor_dc'))).toBe(0.08)
  })

  it('the Physics → Body mass override is what the simulators use', () => {
    const capsule = { ...obj('capsule', 5), physics: { mass: 0.2 } }
    expect(effectiveMass(capsule)).toBe(0.2)
    expect(totalMass([capsule, obj('motor_dc'), obj('motor_dc')])).toBeCloseTo(0.36, 6)
    expect(effectiveMass(obj('capsule', 5))).toBe(getMassForObject(obj('capsule', 5)))   // no override → auto
  })
})
