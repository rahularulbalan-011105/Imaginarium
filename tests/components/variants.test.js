import { describe, it, expect } from 'vitest'
import { COMPONENT_VARIANTS, variantOverrides } from '../../src/utils/componentVariants.js'
import { SERVO_PRESETS, resolveServoSpec } from '../../src/managers/physics/robotics/ServoActuator.js'

describe('component variants', () => {
  it('every servo variant names a real servo preset (no silent fallback to MG90S)', () => {
    for (const [key, v] of Object.entries(COMPONENT_VARIANTS)) {
      if (v.base !== 'servo') continue
      expect(SERVO_PRESETS[v.physics.servo.preset], key).toBeDefined()
    }
  })

  it('SG90 resolves to the SG90 datasheet torque, not the default servo', () => {
    const o = variantOverrides('sg90')
    expect(resolveServoSpec(o.physics.servo).maxTorque).toBe(SERVO_PRESETS.sg90.maxTorque)
    expect(o.physics.mass).toBe(0.009)
    expect(o.scale).toEqual({ x: 0.6, y: 0.6, z: 0.6 })
  })

  it('MG996R and DS3218 get their own torque and mass, strongest last', () => {
    const mg = variantOverrides('mg996r'), ds = variantOverrides('ds3218')
    expect(resolveServoSpec(mg.physics.servo).maxTorque).toBe(SERVO_PRESETS.mg996r.maxTorque)
    expect(resolveServoSpec(ds.physics.servo).maxTorque).toBe(SERVO_PRESETS.ds3218.maxTorque)
    expect([mg.physics.mass, ds.physics.mass]).toEqual([0.055, 0.060])
    expect(mg.name).toBe('MG996R_1')
    const torque = ['sg90', 'mg996r', 'ds3218'].map((k) => resolveServoSpec(variantOverrides(k).physics.servo).maxTorque)
    expect([...torque].sort((a, b) => a - b)).toEqual(torque)
  })

  it('numbers names per variant and gives each object its own physics copy', () => {
    const first = variantOverrides('sg90', [])
    const second = variantOverrides('sg90', [{ variant: 'sg90' }, { type: 'servo' }])
    expect(first.name).toBe('SG90_1')
    expect(second.name).toBe('SG90_2')
    first.physics.servo.preset = 'ds3218'
    expect(COMPONENT_VARIANTS.sg90.physics.servo.preset).toBe('sg90')
    expect(second.physics.servo.preset).toBe('sg90')
  })

  it('unknown variant → null', () => {
    expect(variantOverrides('nope')).toBeNull()
  })
})
