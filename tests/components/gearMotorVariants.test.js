// Gear motors (N20 / TT / JGA25-370 metal, each ± encoder): variants of the BO
// and encoder motor types — stamped data, models at real size, pins on the real
// terminals / connector contacts, and a shaft that spins in place.
import { describe, it, expect, beforeAll } from 'vitest'
import * as THREE from 'three'
import { COMPONENT_VARIANTS, variantOverrides } from '../../src/utils/componentVariants.js'
import { PIN_DEFS as WIRING_PINS } from '../../src/utils/wiring.js'
import { hasGearbox, ratioOf, GEAR_RATIOS } from '../../src/utils/gearMotor.js'

const GEAR = ['n20', 'tt', 'metal_gear', 'n20_enc', 'tt_enc', 'metal_gear_enc']
const MODELLED = ['n20', 'metal_gear', 'n20_enc', 'metal_gear_enc']

let factory
beforeAll(async () => {
  const ctx2d = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 5 }) : () => {}), set: () => true })
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) }
  factory = await import('../../src/utils/electronicsFactory.js')
})

const sizeOf = (g) => {
  const box = new THREE.Box3()
  g.updateMatrixWorld(true)
  g.traverse((c) => { if (c.isMesh) box.union(new THREE.Box3().setFromObject(c)) })
  return box
}

describe('gear motor variants', () => {
  it('plain ones are BO motors, encoder ones are encoder motors', () => {
    for (const k of ['n20', 'tt', 'metal_gear']) expect(COMPONENT_VARIANTS[k].base, k).toBe('motor_bo')
    for (const k of ['n20_enc', 'tt_enc', 'metal_gear_enc']) expect(COMPONENT_VARIANTS[k].base, k).toBe('motor_enc')
  })
  it('stamp name, mass and a real gearbox ratio the Properties panel offers', () => {
    for (const k of GEAR) {
      const o = { type: COMPONENT_VARIANTS[k].base, ...variantOverrides(k) }
      expect(o.name).toMatch(/_1$/)
      expect(o.physics.mass).toBeGreaterThan(0)
      expect(GEAR_RATIOS.map((g) => g.ratio)).toContain(o.gearRatio)
      expect(hasGearbox(o)).toBe(true)
      expect(ratioOf(o)).toBe(o.gearRatio)
    }
    expect(variantOverrides('tt').scale).toEqual({ x: 1.4, y: 1.4, z: 1.4 })     // TT at its real 70 mm
  })
  it('existing variants are unchanged by the new `fields` merge', () => {
    const sg = variantOverrides('sg90')
    expect(Object.keys(sg).sort()).toEqual(['name', 'physics', 'scale', 'variant'])
  })
  it('only the N20 / metal variants get their own model; TT keeps the TT model', () => {
    for (const k of MODELLED) expect(factory.isGearMotorModel({ type: COMPONENT_VARIANTS[k].base, variant: k }), k).toBe(true)
    for (const k of ['tt', 'tt_enc']) expect(factory.isGearMotorModel({ type: COMPONENT_VARIANTS[k].base, variant: k }), k).toBe(false)
    expect(factory.isGearMotorModel({ type: 'motor_bo' })).toBe(false)
    expect(factory.isGearMotorModel({ type: 'servo', variant: 'n20' })).toBe(false)
  })
})

describe('gear motor models', () => {
  it('real sizes: N20 12 × 10 mm, JGA25 Ø25 mm', () => {
    const n20 = sizeOf(factory.createGearMotorGroup('n20')).getSize(new THREE.Vector3())
    expect(n20.z).toBeCloseTo(1.2, 1)
    expect(n20.y).toBeCloseTo(1.0, 1)
    expect(n20.x).toBeGreaterThan(3.5)                                          // body + 10 mm shaft + terminals
    expect(n20.x).toBeLessThan(4.2)
    const metal = sizeOf(factory.createGearMotorGroup('metal_gear')).getSize(new THREE.Vector3())
    expect(metal.y).toBeCloseTo(2.56, 1)
    expect(metal.x).toBeGreaterThan(6.5)
  })
  it('pins: same names as the base type, sitting on terminals / connector contacts', () => {
    for (const k of MODELLED) {
      const g = factory.createGearMotorGroup(k)
      const pins = g.userData.dynamicPins
      expect(Object.keys(pins).sort(), k).toEqual([...WIRING_PINS[COMPONENT_VARIANTS[k].base]].sort())
      g.updateMatrixWorld(true)
      const metal = []
      g.traverse((c) => {
        const hex = c.material?.color?.getHex?.()
        if (c.isMesh && (hex === 0xd4a017 || hex === 0xc77b42)) metal.push(new THREE.Box3().setFromObject(c).expandByScalar(0.06))
      })
      for (const [name, p] of Object.entries(pins))
        expect(metal.some((b) => b.containsPoint(new THREE.Vector3(p.x, p.y, p.z))), `${k}:${name}`).toBe(true)
    }
  })
  it('encoder header follows the real M1 GND A B VCC M2 order', () => {
    const pins = factory.createGearMotorGroup('n20_enc').userData.dynamicPins
    const zs = ['TERM_A', 'GND', 'ENC_A', 'ENC_B', 'VCC', 'TERM_B'].map((n) => pins[n].z)
    expect([...zs].sort((a, b) => a - b)).toEqual(zs)
    expect(pins.TERM_A.label).toBe('M1')
  })
  it('the shaft runs along +X and wheels mount at its tip; it spins in place', () => {
    for (const k of MODELLED) {
      const g = factory.createGearMotorGroup(k)
      expect(g.userData.rotorAxis).toBe('x')
      const tipX = g.userData.rotorGroup.position.x
      expect(tipX, k).toBeCloseTo(sizeOf(g).max.x, 2)
      const shaft = g.userData.rotorMesh
      const before = new THREE.Box3().setFromObject(shaft).getCenter(new THREE.Vector3())
      shaft.rotation.x += 1.3
      g.updateMatrixWorld(true)
      const after = new THREE.Box3().setFromObject(shaft).getCenter(new THREE.Vector3())
      expect(after.distanceTo(before), k).toBeLessThan(0.05)                    // turns about its own axis
    }
  })
})
