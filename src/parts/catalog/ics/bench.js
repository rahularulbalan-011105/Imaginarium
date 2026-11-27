// ─────────────────────────────────────────────────────────────────────────────
// Bench fixtures for the IC scenarios (NOT a part file). The Uno model only
// offers 5 V / 3V3, so a regulator (needs ≥ 7 V in), an op-amp on ±12 V or a
// motor supply needs a lab bench supply; a 555 needs a timing capacitor. Until
// catalogue battery / capacitor parts exist these add the SAME mna.js elements
// those parts would stamp straight into the running circuit:
//   benchSupply  vsource with 50 mΩ internal resistance (a bench PSU)
//   benchCap     an ideal capacitor (backward-Euler companion model)
// ─────────────────────────────────────────────────────────────────────────────
import { vsource, capacitor } from '../../../circuit/mna.js'

/** A bench supply of V volts from part pin `pos` ('id:PIN') to `neg` (default: ground). */
export function benchSupply(kit, pos, V, neg = null) {
  const sim = kit.bridge.sim
  return sim.circuit.add(vsource(sim.nodeOf(pos), neg ? sim.nodeOf(neg) : 0, V, 0.05))
}
/** A capacitor of C farads from pin `a` to pin `b` (default: ground). */
export function benchCap(kit, a, C, b = null) {
  const sim = kit.bridge.sim
  return sim.circuit.add(capacitor(sim.nodeOf(a), b ? sim.nodeOf(b) : 0, C))
}
