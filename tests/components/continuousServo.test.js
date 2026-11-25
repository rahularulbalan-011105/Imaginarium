// FS90R-style continuous-rotation servo: write() → speed, wiring like a servo,
// treated as a drive motor (not a positional joint).
import { describe, it, expect } from 'vitest'
import { crSpeed, crMotorSpeed, CR_MAX_RPM, CR_SERVO_EXAMPLE_SKETCH } from '../../src/utils/continuousServo.js'
import { buildPinToComponentMap } from '../../src/stores/electronicsStore.js'
import { PIN_DEFS as WIRING_PINS, ELEC_TYPES } from '../../src/utils/wiring.js'
import { PIN_DEFS as FACTORY_PINS } from '../../src/utils/electronicsFactory.js'
import { variantOverrides, COMPONENT_VARIANTS } from '../../src/utils/componentVariants.js'
import { parseAndTranspile } from '../../src/utils/arduinoParser.js'
import { analyzeArduino } from '../../src/utils/arduinoDiagnostics.js'
import { DifferentialDrive } from '../../src/managers/robot/DifferentialDrive.js'
import { getComponentDef as getComponent } from '../../src/robot/componentRegistry.js'

describe('write() → speed', () => {
  it('stops at 90 and inside the deadband', () => {
    expect(crSpeed(90)).toBe(0)
    expect(crSpeed(91)).toBe(0)
    expect(crSpeed(89)).toBe(0)
  })
  it('turns one way above 90 and the other way below', () => {
    expect(crSpeed(110)).toBeGreaterThan(0)
    expect(crSpeed(70)).toBeLessThan(0)
    expect(crSpeed(110)).toBeCloseTo(-crSpeed(70), 9)
  })
  it('speeds up with distance from 90, then saturates', () => {
    expect(crSpeed(100)).toBeLessThan(crSpeed(115))
    expect(crSpeed(130)).toBe(1)
    expect(crSpeed(180)).toBe(1)
    expect(crSpeed(0)).toBe(-1)
  })
  it('full speed drives a wheel at the FS90R’s 110 RPM, not a BO motor’s', () => {
    const d = new DifferentialDrive()
    const rpm = (pwm) => (d.pwmToVelocity(pwm, 1) / (2 * Math.PI)) * 60
    expect(rpm(crMotorSpeed(180))).toBeCloseTo(CR_MAX_RPM, 6)
    expect(rpm(255)).toBeGreaterThan(rpm(crMotorSpeed(180)))
  })
})

describe('registration', () => {
  it('wires exactly like a servo', () => {
    expect(ELEC_TYPES.has('servo_cr')).toBe(true)
    expect(WIRING_PINS.servo_cr).toEqual(WIRING_PINS.servo)
    expect(Object.keys(FACTORY_PINS.servo_cr).sort()).toEqual([...WIRING_PINS.servo_cr].sort())
  })
  it('a board pin on its SIGNAL reaches it', () => {
    const objects = [{ id: 'b', type: 'arduino' }, { id: 's', type: 'servo_cr' }]
    const map = buildPinToComponentMap({ c: { fromPinId: 'b:D9', toPinId: 's:SIGNAL' } }, objects)
    expect(map[9]).toEqual([{ id: 's', type: 'servo_cr', terminal: 'A' }])
  })
  it('is a drive motor in the blueprint registry, not a servo joint', () => {
    expect(getComponent('servo_cr')?.role).toBe('drive')
  })
  it('the FS90R entry is a variant of the continuous type, SG90-sized', () => {
    expect(COMPONENT_VARIANTS.fs90r.base).toBe('servo_cr')
    const o = variantOverrides('fs90r', [])
    expect(o.name).toBe('FS90R_1')
    expect(o.scale.x).toBe(0.6)
  })
})

describe('example sketch', () => {
  it('compiles cleanly', () => {
    const diag = analyzeArduino(CR_SERVO_EXAMPLE_SKETCH, { board: 'arduino' })
    expect(diag.errors, JSON.stringify(diag.errors)).toEqual([])
    const { code, error } = parseAndTranspile(CR_SERVO_EXAMPLE_SKETCH, new Set(['Servo']))
    expect(error).toBeFalsy()
    expect(code).toMatch(/left\.write\(/)
  })
})
