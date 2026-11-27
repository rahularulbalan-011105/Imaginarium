// LM741 general-purpose op-amp (Tinkercad "Operational Amplifier LM741"),
// DIP-8: 1 OFFSET N1 · 2 IN− · 3 IN+ · 4 V− · 5 NC · 6 OUT · 7 OFFSET N2 · 8 V+
// (TI LM741 datasheet SNOSC25).
//
// Op-amp element: open-loop gain 200 V/mV (2e5), output clamped 1.5 V inside
// each rail (datasheet: ±14 V swing at RL ≥ 10 kΩ and ±13 V at 2 kΩ on ±15 V
// → 1–2 V headroom), 75 Ω output resistance — the same parameters as mna.js
// opamp(), but piecewise-linear (linear / +sat / −sat, region picked from each
// Newton solution with adjacent-only moves). mna.js opamp() uses tanh, whose
// slope underflows to exactly 0 once saturated, so with negative feedback that
// starts outside the linear range Newton flips ±rail for ever (reported).
// Added around it: 2 MΩ differential input resistance, ≈1.7 mA quiescent supply
// current (V+ → V−, 17.6 kΩ ≈ 30 V / 1.7 mA), short-circuit current ≈25 mA (issue).
// The offset-null pins are for a 10 kΩ trimmer to V−; offset itself (≈1 mV) is not modelled.
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { dipPins } from '../../model.js'
import { dipBuild, dipDims } from '../logic/cmos.js'
import { benchSupply } from './bench.js'

const NAMES = ['NULL1', 'IN-', 'IN+', 'V-', 'NC', 'OUT', 'NULL2', 'V+']
const KINDS = { NULL1: 'passive', 'IN-': 'analog', 'IN+': 'analog', 'V-': 'power', NC: 'passive', OUT: 'analog', NULL2: 'passive', 'V+': 'power' }
const LABELS = { NULL1: 'OFFSET N1', NULL2: 'OFFSET N2', 'IN-': 'IN−', 'V-': 'V−' }
const HEADROOM = 1.5, ISC = 0.025, GAIN = 2e5, R_OUT = 75

/** Piecewise-linear op-amp: V(out) − rOut·i = Vo, Vo = mid + A·(V+ − V−) clamped to the rails − headroom. */
function opampPWL(inp, inn, out, vp, vn) {
  const vLin = (v) => 0.5 * (v(vp) + v(vn)) + GAIN * (v(inp) - v(inn))
  return {
    kind: 'OPAMP_PWL', nodes: [inp, inn, out, vp, vn], nonlinear: true, branches: 1, m: 'lin',
    stamp(sys, ctx, e) {
      const ro = sys._r(out), rk = sys._br(e.branchBase)
      sys.addA(ro, rk, 1); sys.addA(rk, ro, 1); sys.addA(rk, rk, -R_OUT)
      if (e.m === 'lin') {
        sys.addA(rk, sys._r(vp), -0.5); sys.addA(rk, sys._r(vn), -0.5)
        sys.addA(rk, sys._r(inp), -GAIN); sys.addA(rk, sys._r(inn), GAIN)
      } else if (e.m === 'hi') { sys.addA(rk, sys._r(vp), -1); sys.b[rk] -= HEADROOM }
      else { sys.addA(rk, sys._r(vn), -1); sys.b[rk] += HEADROOM }
    },
    limit(ctx, e) {
      const vo = vLin(ctx.v), hi = ctx.v(vp) - HEADROOM, lo = ctx.v(vn) + HEADROOM
      let m = e.m
      if (m === 'lin') m = vo > hi ? 'hi' : vo < lo ? 'lo' : 'lin'
      else if (m === 'hi') m = vo < hi ? 'lin' : 'hi'
      else m = vo > lo ? 'lin' : 'lo'
      if (m === e.m) return false
      e.m = m
      return true
    },
    currentOf(ctx, e) { return -ctx.brI(e) },                // current out of OUT
  }
}

export default definePart({
  type: 'opamp_lm741',
  label: 'Operational Amplifier LM741',
  shortName: '741',
  tinkercad: 'Operational Amplifier LM741',
  category: 'ics',
  icon: '▷',
  desc: 'General-purpose op-amp · DIP-8 · ±5…±18 V · 1 MHz GBW',
  purpose: 'Amplifies the difference between IN+ (3) and IN− (2). Power it from V+ (8) and V− (4), ideally ±9…±15 V. ' +
    'Inverting amplifier: Rin to IN−, Rf from OUT (6) to IN−, IN+ to GND → gain = −Rf/Rin. Without feedback it is a comparator. ' +
    'The 741 output cannot reach its rails: it stays ≈1.5 V inside them, so on a single 5 V supply it only swings ≈1.5–3.5 V.',
  usage: 'amplifiers · comparators · active filters · buffers',
  spec: {
    dims_mm: dipDims(8), mass_kg: 0.0005, supply: '±5 … ±18 V (36 V total max)', gain: 2e5, gbw_Hz: 1e6, iout_sc_mA: 25,
    summary: 'Open-loop gain 200 V/mV, Rin 2 MΩ, output swing ±13…±14 V on ±15 V, short-circuit current 25 mA, slew 0.5 V/µs.',
  },
  pins: dipPins(NAMES, { kinds: KINDS }).map(p => ({ ...p, label: LABELS[p.name] ?? p.name })),
  build: () => dipBuild(8, 'LM741'),
  sim: {
    circuit(api) {
      const inp = api.pin('IN+'), inn = api.pin('IN-'), out = api.pin('OUT'), vp = api.pin('V+'), vn = api.pin('V-')
      api.add(resistor(inp, inn, 2e6))
      api.add(resistor(vp, vn, 17600))
      const oa = api.add(opampPWL(inp, inn, out, vp, vn))
      return { oa }
    },
    solved(h, api) {
      const name = api.obj.name || 'LM741'
      const vs = api.vpin('V+') - api.vpin('V-')
      const anyWired = ['IN-', 'IN+', 'OUT'].some(n => api.connected(n))
      if (vs > 36) api.issue('overvoltage', 'error', `${name} has ${vs.toFixed(1)} V across its supply`, 'The 741 allows ±18 V (36 V total) at most.')
      else api.clearIssue('overvoltage')
      if (anyWired && vs < 2 * HEADROOM + 0.5) api.issue('unpowered', 'warning', `${name} is not powered`, 'Wire V+ (pin 8) and V− (pin 4): ±9 V … ±15 V, or 5 V and GND for a limited swing.')
      else if (anyWired && vs < 10) api.issue('lowsupply', 'warning', `${name} runs on only ${vs.toFixed(1)} V`, `A 741 needs ≈1.5 V headroom at each rail, so its output can only move between ${(api.vpin('V-') + HEADROOM).toFixed(1)} V and ${(api.vpin('V+') - HEADROOM).toFixed(1)} V. Use a rail-to-rail op-amp or a split supply for more.`)
      if (!(anyWired && vs < 2 * HEADROOM + 0.5)) api.clearIssue('unpowered')
      if (!(anyWired && vs >= 2 * HEADROOM + 0.5 && vs < 10)) api.clearIssue('lowsupply')
      const iout = api.cur(h.oa)
      if (Math.abs(iout) > ISC) api.issue('overcurrent', 'warning', `${name} output would deliver ${(Math.abs(iout) * 1000).toFixed(0)} mA`, 'The 741 output is short-circuit limited to ≈25 mA; use a ≥ 2 kΩ load or a buffer transistor.')
      else api.clearIssue('overcurrent')
      const vout = api.vpin('OUT')
      const sat = h.oa.m !== 'lin'
      return { vout, vin: api.vpin('IN+') - api.vpin('IN-'), iout, saturated: sat, supply: vs }
    },
    readout: ({ solved }) => (solved ? `OUT ${solved.vout.toFixed(2)} V${solved.saturated ? ' (saturated)' : ''}` : ''),
  },
  tests: [
    {
      name: 'inverting amplifier on ±12 V: Rin 10 kΩ, Rf 22 kΩ, 3.3 V in → −2.2 × 3.3 = −7.26 V',
      run(kit) {
        kit.scene({ U: 'arduino', A: 'opamp_lm741', RI: { type: 'resistor', resistance: 10000 }, RF: { type: 'resistor', resistance: 22000 } }, [
          ['RI:1', 'U:3V3'], ['RI:2', 'A:IN-'], ['RF:1', 'A:IN-'], ['RF:2', 'A:OUT'], ['A:IN+', 'U:GND1'],
        ])
        benchSupply(kit, 'A:V+', 12); benchSupply(kit, 'A:V-', -12)
        kit.step(0.05)
        kit.near(kit.vpin('A', 'OUT'), -7.26, 0.02, 'Vout = −(Rf/Rin)·Vin')
        kit.near(kit.vpin('A', 'IN-'), 0, 0.001, 'virtual ground at IN−')
        kit.ok(!kit.state('A').saturated, 'linear region')
        kit.ok(!kit.hasIssue('A:'), 'no issues')
      },
    },
    {
      name: 'comparator (no feedback) saturates ≈1.5 V inside the ±12 V rails',
      run(kit) {
        kit.scene({ U: 'arduino', A: 'opamp_lm741', R1: { type: 'resistor', resistance: 10000 }, R2: { type: 'resistor', resistance: 10000 } }, [
          ['A:IN+', 'U:D13'], ['R1:1', 'U:5V'], ['R1:2', 'A:IN-'], ['R2:1', 'A:IN-'], ['R2:2', 'U:GND1'],
        ])
        benchSupply(kit, 'A:V+', 12); benchSupply(kit, 'A:V-', -12)
        kit.pinMode(13, 'output')
        kit.write(13, 1); kit.step(0.05)
        kit.between(kit.vpin('A', 'OUT'), 10.0, 11.0, 'IN+ (5 V) > IN− (2.5 V): high saturation ≈ +10.5 V')
        kit.write(13, 0); kit.step(0.05)
        kit.between(kit.vpin('A', 'OUT'), -11.0, -10.0, 'IN+ (0 V) < IN− (2.5 V): low saturation ≈ −10.5 V')
        kit.ok(kit.state('A').saturated, 'saturated')
      },
    },
    {
      name: 'on a single 5 V supply the output only swings ≈1.5–3.5 V (and warns)',
      run(kit) {
        kit.scene({ U: 'arduino', A: 'opamp_lm741', R1: { type: 'resistor', resistance: 10000 }, R2: { type: 'resistor', resistance: 10000 } }, [
          ['A:V+', 'U:5V'], ['A:V-', 'U:GND1'], ['A:IN+', 'U:D13'], ['R1:1', 'U:5V'], ['R1:2', 'A:IN-'], ['R2:1', 'A:IN-'], ['R2:2', 'U:GND2'],
        ])
        kit.pinMode(13, 'output'); kit.write(13, 1); kit.step(0.05)
        kit.near(kit.vpin('A', 'OUT'), 3.5, 0.05, 'high = 5 − 1.5 V')
        kit.write(13, 0); kit.step(0.05)
        kit.near(kit.vpin('A', 'OUT'), 1.5, 0.05, 'low = 0 + 1.5 V')
        kit.ok(kit.hasIssue('A:lowsupply'), 'low-supply warning')
      },
    },
  ],
})
