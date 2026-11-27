import { describe, it, expect } from 'vitest'
import { Circuit, resistor, vsource, capacitor, inductor, diode, bjt, mosfet, sw, opamp } from '../../src/circuit/mna.js'

// Every expected value here is worked out by hand from the textbook formula,
// so a passing test means the solver reproduces real circuit behaviour.

describe('MNA solver — linear', () => {
  it('voltage divider: 9 V across 1 kΩ + 2 kΩ gives 6 V at the middle', () => {
    const c = new Circuit(); const top = c.node(), mid = c.node()
    c.add(vsource(top, 0, 9)); c.add(resistor(top, mid, 1000)); c.add(resistor(mid, 0, 2000))
    expect(c.step()).toBe(true)
    expect(c.voltageOf(mid)).toBeCloseTo(6, 6)
  })
  it('source with internal resistance sags under load (9 V, 2 Ω, 10 Ω load → 7.5 V)', () => {
    const c = new Circuit(); const p = c.node()
    c.add(vsource(p, 0, 9, 2)); const r = c.add(resistor(p, 0, 10))
    c.step()
    expect(c.voltageOf(p)).toBeCloseTo(7.5, 6)
    expect(r.currentOf({ v: (n) => c.voltageOf(n) }, r)).toBeCloseTo(0.75, 6)
  })
  it('RC charging reaches 63.2 % of the supply after one time constant', () => {
    const c = new Circuit(); const p = c.node(), m = c.node()
    c.add(vsource(p, 0, 5)); c.add(resistor(p, m, 1000)); c.add(capacitor(m, 0, 100e-6))   // τ = 0.1 s
    const dt = 1e-4
    for (let i = 0; i < 1000; i++) c.step(dt)
    expect(c.voltageOf(m) / 5).toBeGreaterThan(0.62)
    expect(c.voltageOf(m) / 5).toBeLessThan(0.64)
  })
  it('RL current rises to 63.2 % of V/R after τ = L/R', () => {
    const c = new Circuit(); const p = c.node(), m = c.node()
    c.add(vsource(p, 0, 10)); c.add(resistor(p, m, 100)); const L = c.add(inductor(m, 0, 1))  // τ = 10 ms
    for (let i = 0; i < 1000; i++) c.step(1e-5)
    const i = c.branchCurrent(L.branchBase)
    expect(i / 0.1).toBeGreaterThan(0.62)
    expect(i / 0.1).toBeLessThan(0.64)
  })
  it('open switch isolates, closed switch conducts', () => {
    const c = new Circuit(); const p = c.node(), m = c.node()
    c.add(vsource(p, 0, 5)); const s = c.add(sw(p, m)); c.add(resistor(m, 0, 1000))
    c.step(); expect(c.voltageOf(m)).toBeLessThan(1e-3)
    s.closed = true; c.step(); expect(c.voltageOf(m)).toBeCloseTo(5, 3)
  })
})

describe('MNA solver — nonlinear', () => {
  it('silicon diode drops ≈0.6–0.75 V at a few mA', () => {
    const c = new Circuit(); const p = c.node(), a = c.node()
    c.add(vsource(p, 0, 5)); c.add(resistor(p, a, 1000)); c.add(diode(a, 0, { Is: 1e-14, n: 1 }))
    expect(c.step()).toBe(true)
    expect(c.voltageOf(a)).toBeGreaterThan(0.6); expect(c.voltageOf(a)).toBeLessThan(0.75)
  })
  it('reverse-biased diode blocks', () => {
    const c = new Circuit(); const p = c.node(), a = c.node()
    c.add(vsource(p, 0, 5)); c.add(resistor(p, a, 1000)); c.add(diode(0, a))
    c.step(); expect(c.voltageOf(a)).toBeGreaterThan(4.99)
  })
  it('5.1 V Zener regulates a 12 V supply', () => {
    const c = new Circuit(); const p = c.node(), k = c.node()
    c.add(vsource(p, 0, 12)); c.add(resistor(p, k, 470)); c.add(diode(0, k, { Vz: 5.1 }))
    expect(c.step()).toBe(true)
    expect(c.voltageOf(k)).toBeGreaterThan(5.0); expect(c.voltageOf(k)).toBeLessThan(5.9)
  })
  it('NPN switch: base driven → collector pulled near 0 V; base low → collector at supply', () => {
    const build = (vb) => {
      const c = new Circuit(); const vcc = c.node(), col = c.node(), base = c.node(), drv = c.node()
      c.add(vsource(vcc, 0, 5)); c.add(resistor(vcc, col, 1000))
      c.add(vsource(drv, 0, vb)); c.add(resistor(drv, base, 1000))
      c.add(bjt(col, base, 0, { bf: 100 }))
      expect(c.step()).toBe(true)
      return c.voltageOf(col)
    }
    expect(build(5)).toBeLessThan(0.3)
    expect(build(0)).toBeGreaterThan(4.99)
  })
  it('NPN in active region: Ic ≈ β·Ib', () => {
    const c = new Circuit(); const vcc = c.node(), col = c.node(), base = c.node(), drv = c.node()
    c.add(vsource(vcc, 0, 12)); c.add(resistor(vcc, col, 100))
    c.add(vsource(drv, 0, 1.7)); c.add(resistor(drv, base, 100000))   // Ib ≈ 10 µA
    const q = c.add(bjt(col, base, 0, { bf: 100 }))
    c.step()
    const ic = q.currentOf({ v: (n) => c.voltageOf(n) })
    const ib = (1.7 - c.voltageOf(base)) / 100000
    expect(ic / ib).toBeGreaterThan(95); expect(ic / ib).toBeLessThan(101)
  })
  it('PNP high-side switch conducts when its base is pulled low', () => {
    const c = new Circuit(); const vcc = c.node(), col = c.node(), base = c.node()
    c.add(vsource(vcc, 0, 5)); c.add(resistor(col, 0, 1000)); c.add(resistor(base, 0, 1000))
    c.add(bjt(col, base, vcc, { pnp: true }))
    expect(c.step()).toBe(true)
    expect(c.voltageOf(col)).toBeGreaterThan(4.6)
  })
  it('N-MOSFET: gate 5 V turns on a 100 Ω load; gate 0 V leaves it off', () => {
    const build = (vg) => {
      const c = new Circuit(); const vcc = c.node(), dr = c.node(), g = c.node()
      c.add(vsource(vcc, 0, 5)); c.add(resistor(vcc, dr, 100)); c.add(vsource(g, 0, vg))
      c.add(mosfet(dr, g, 0, { Vth: 2, K: 0.5 }))
      expect(c.step()).toBe(true)
      return c.voltageOf(dr)
    }
    expect(build(5)).toBeLessThan(0.2)
    expect(build(0)).toBeGreaterThan(4.99)
  })
  it('P-MOSFET high side: gate at 0 V switches 5 V onto the load', () => {
    const c = new Circuit(); const vcc = c.node(), dr = c.node()
    c.add(vsource(vcc, 0, 5)); c.add(resistor(dr, 0, 100))
    c.add(mosfet(dr, 0, vcc, { pmos: true, Vth: 2, K: 0.5 }))
    expect(c.step()).toBe(true)
    expect(c.voltageOf(dr)).toBeGreaterThan(4.8)
  })
  it('op-amp non-inverting amplifier: gain 1 + Rf/Rg = 3', () => {
    const c = new Circuit(); const vp = c.node(), vn = c.node(), inp = c.node(), out = c.node(), fb = c.node()
    c.add(vsource(vp, 0, 15)); c.add(vsource(0, vn, 15))
    c.add(vsource(inp, 0, 1))
    c.add(resistor(out, fb, 20000)); c.add(resistor(fb, 0, 10000))
    c.add(opamp(inp, fb, out, vp, vn))
    expect(c.step()).toBe(true)
    expect(c.voltageOf(out)).toBeCloseTo(3, 2)
  })
})

describe('MNA solver — regressions found by the parts work', () => {
  it('a 3.1 V (blue/white) LED junction conducts ≈ the expected current', () => {
    // LED tuned to Vf = 3.1 V at 20 mA, n = 2 (legacyAdapters.ledDiodeParams), through 100 Ω from 5 V:
    // (5 − ≈3.0) / (100 + 8) ≈ 17–19 mA.
    const nVt = 2 * 0.025852, Is = 0.02 / Math.exp((3.1 - 0.02 * 8) / nVt)
    const c = new Circuit(); const p = c.node(), a = c.node(), k = c.node()
    c.add(vsource(p, 0, 5)); c.add(resistor(p, a, 100)); c.add(resistor(a, k, 8)); const d = c.add(diode(k, 0, { Is, n: 2 }))
    expect(c.step()).toBe(true)
    const i = d.currentOf({ v: (n) => c.voltageOf(n) }, d)
    expect(i).toBeGreaterThan(0.016); expect(i).toBeLessThan(0.02)
  })
  it('op-amp inverting amplifier settles even though Newton starts saturated: −Rf/Ri · Vin = −7.2 V', () => {
    const c = new Circuit(); const vp = c.node(), vn = c.node(), inp = c.node(), out = c.node(), mid = c.node()
    c.add(vsource(vp, 0, 12)); c.add(vsource(0, vn, 12)); c.add(vsource(inp, 0, 1))
    c.add(resistor(inp, mid, 10000)); c.add(resistor(mid, out, 72000))
    c.add(opamp(0, mid, out, vp, vn))
    expect(c.step()).toBe(true)
    expect(c.voltageOf(out)).toBeCloseTo(-7.2, 2)
  })
})

describe('MNA solver — op-amp warm start', () => {
  it('recovers from a saturated previous solution (input changes 2 V → 1 V): settles at −7.2 V', () => {
    const c = new Circuit(); const vp = c.node(), vn = c.node(), inp = c.node(), out = c.node(), mid = c.node()
    c.add(vsource(vp, 0, 12)); c.add(vsource(0, vn, 12)); const src = c.add(vsource(inp, 0, 2))
    c.add(resistor(inp, mid, 10000)); c.add(resistor(mid, out, 72000))
    c.add(opamp(0, mid, out, vp, vn))
    c.step()
    expect(c.voltageOf(out)).toBeLessThan(-10)          // 2 V · −7.2 saturates at the −rail
    src.V = 1
    expect(c.step()).toBe(true)
    expect(c.voltageOf(out)).toBeCloseTo(-7.2, 2)
  })
})
