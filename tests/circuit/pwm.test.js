// PWM is switched, not averaged as a voltage: a nonlinear load (an LED) at 50 %
// duty carries half its full-on current on average — as on real hardware.
import { describe, it, expect } from 'vitest'
import { loadParts } from '../../src/parts/registry.js'
import { createKit } from '../../src/parts/testkit.js'

await loadParts()
const ledScene = (kit) => kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 220 }, L: 'led' },
  [['U:D9', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND1']])

describe('PWM through the circuit solver', () => {
  it('LED at analogWrite(128) averages ≈ 128/255 of its full-on current', () => {
    const kit = createKit(); ledScene(kit)
    kit.analogWrite(9, 255); kit.step(0.02)
    const full = kit.state('R').current
    kit.analogWrite(9, 128); kit.step(0.02)
    const half = kit.state('R').current
    // 16-phase sampling resolves duty in 1/16 steps: 128/255 = 0.502 → 8/16 = 0.5.
    expect(half / full).toBeGreaterThan(0.45); expect(half / full).toBeLessThan(0.56)
    expect(kit.led.L).toBeGreaterThan(60)                     // visibly half-lit, not ≈ dark
  })
  it('a low duty (64/255) still lights the LED ≈ a quarter', () => {
    const kit = createKit(); ledScene(kit)
    kit.analogWrite(9, 255); kit.step(0.02); const full = kit.state('R').current
    kit.analogWrite(9, 64); kit.step(0.02)
    expect(kit.state('R').current / full).toBeGreaterThan(0.2); expect(kit.state('R').current / full).toBeLessThan(0.32)
  })
  it('in a time-based circuit the pin really switches at 490 Hz (RC filter smooths it to ≈ duty·5 V)', () => {
    const kit = createKit()
    kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 100000 }, C: { type: 'capacitor', capacitance: 1000 } },
      [['U:D9', 'R:1'], ['R:2', 'C:1'], ['C:2', 'U:GND1']])
    kit.analogWrite(9, 128); kit.step(1.0)                   // τ = 0.1 s → settled after 10 τ
    // ≈ 0.5·5 V (100 kΩ ≫ the 25 Ω pin; 1 µF) ≈ 2.5 V, with a small ripple (τ ≫ 2 ms period).
    expect(kit.vpin('C', '1')).toBeGreaterThan(2.3); expect(kit.vpin('C', '1')).toBeLessThan(2.7)
  })
  it('steady HIGH / LOW are unchanged (no sampling cost when nothing is PWMed)', () => {
    const kit = createKit(); ledScene(kit)
    kit.pinMode(9, 'output'); kit.write(9, 1); kit.step(0.02)
    expect(kit.state('R').current).toBeGreaterThan(0.011)
    kit.write(9, 0); kit.step(0.02)
    expect(kit.state('R').current).toBeLessThan(1e-6)
  })
})
