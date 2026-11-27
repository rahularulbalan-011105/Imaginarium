// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for the IC / logic catalogue parts (NOT a part file).
//
//   levelOf()      CMOS input thresholds with hysteresis (VIL 0.3·VCC, VIH 0.7·VCC)
//   stampStage()   a push-pull output stage stamped into the MNA system: HIGH is
//                  the PMOS (or emitter follower) from the chip's OWN VCC pin
//                  through Ron, LOW is the NMOS to the chip's GND pin, null is
//                  high-impedance. Supply current therefore really flows
//                  through the chip's VCC/GND pins.
//   logicBlock()   a combinational/latched logic element that evaluates its
//                  inputs INSIDE the Newton loop: each iteration reads the
//                  current node voltages, applies the thresholds, computes the
//                  outputs and stamps the stages. For logic this is a fixed-
//                  point iteration that settles in (logic depth + 1) iterations,
//                  so gates feeding gates resolve within one solve.
//   stampI()       a linear controlled current I = Σ g·V(n) + c between two nodes.
//   dipBuild()     a DIP model (model.js dip()) with a pin-1 dot and marking.
// ─────────────────────────────────────────────────────────────────────────────
import { Group } from 'three'
import { dip, dipPinXZ, mat, cyl, at, PITCH } from '../../model.js'

/** 74HC thresholds (fractions of VCC) and supply limits (NXP/TI 74HC datasheets). */
export const HC = { VIL: 0.3, VIH: 0.7, VCC_MIN: 2.0, VCC_MAX: 6.0, VCC_ABS: 7.0, IO_ABS: 0.025, ICC_ABS: 0.05 }

/** Logic level of voltage v (relative to GND) for a supply vs, holding `prev` inside the hysteresis band. */
export function levelOf(v, vs, prev = 0, vil = HC.VIL, vih = HC.VIH) {
  if (v >= vih * vs) return 1
  if (v <= vil * vs) return 0
  return prev ?? 0
}

/**
 * Stamp an output stage. q = 1 / 0 / null (high-Z).
 * p = { ronHi, ronLo, dropHi = 0, dropLo = 0 }. A HIGH output with dropHi is
 * V(vcc) − dropHi behind ronHi (an emitter follower / Darlington); LOW is
 * V(gnd) + dropLo behind ronLo.
 */
export function stampStage(sys, out, vcc, gnd, q, p) {
  if (q === 1) {
    const g = 1 / p.ronHi
    sys.conductance(out, vcc, g)
    if (p.dropHi) sys.current(out, vcc, g * p.dropHi)
  } else if (q === 0) {
    const g = 1 / p.ronLo
    sys.conductance(out, gnd, g)
    if (p.dropLo) sys.current(gnd, out, g * p.dropLo)
  }
}
/** Current OUT of an output pin into the circuit (A), given node voltages via v(). */
export function stageCurrent(v, out, vcc, gnd, q, p) {
  if (q === 1) return (v(vcc) - (p.dropHi ?? 0) - v(out)) / p.ronHi
  if (q === 0) return -(v(out) - v(gnd) - (p.dropLo ?? 0)) / p.ronLo
  return 0
}

/**
 * Linear controlled current from node `from` to node `to`:
 *   I = Σ g_j · V(n_j) + c      (terms = [[node, g], …])
 */
export function stampI(sys, from, to, terms, c) {
  const rf = sys._r(from), rt = sys._r(to)
  for (const [n, g] of terms) {
    const rn = sys._r(n)
    if (rn < 0) continue
    sys.addA(rf, rn, g)
    sys.addA(rt, rn, -g)
  }
  if (rf >= 0) sys.b[rf] -= c
  if (rt >= 0) sys.b[rt] += c
}

/**
 * Logic element evaluated inside the solve.
 * @param {object} o
 * @param {number[]} o.ins     input nodes
 * @param {number[]} o.outs    output nodes
 * @param {number} o.vcc @param {number} o.gnd   the chip's own supply pins
 * @param {number} o.vMin      below this VCC−GND the chip is unpowered (outputs high-Z)
 * @param {(lv:number[], st:object, vs:number) => (0|1|null)[]} o.compute
 * @param {(lv:number[], st:object, q:(0|1|null)[]) => void} [o.commit]   after an accepted step (latches)
 * @param {object|object[]} o.stage   output stage params (one for all, or per output)
 */
export function logicBlock({ ins, outs, vcc, gnd, vMin = HC.VCC_MIN, compute, commit, stage, vil = HC.VIL, vih = HC.VIH }) {
  const stageOf = (i) => (Array.isArray(stage) ? stage[i] : stage)
  const evaluate = (v, st) => {
    const vs = v(vcc) - v(gnd)
    if (!(vs >= vMin)) return { vs, powered: false, lv: st.lv, q: outs.map(() => null) }
    const lv = ins.map((n, i) => levelOf(v(n) - v(gnd), vs, st.lv[i], vil, vih))
    return { vs, powered: true, lv, q: compute(lv, st, vs) }
  }
  const el = {
    kind: 'LOGIC', nodes: [...ins, ...outs, vcc, gnd], nonlinear: true,
    state: { lv: ins.map(() => 0), q: outs.map(() => null), powered: false, vs: 0 },
    stamp(sys, ctx, e) {
      const r = evaluate(ctx.v, e.state)
      outs.forEach((o, i) => stampStage(sys, o, vcc, gnd, r.q[i], stageOf(i)))
    },
    update(ctx, e) {
      const r = evaluate(ctx.v, e.state)
      e.state.lv = r.lv; e.state.q = r.q; e.state.powered = r.powered; e.state.vs = r.vs
      commit?.(r.lv, e.state, r.q)
    },
    /** Current out of output i with the committed levels. */
    outCurrent(i, v) { return stageCurrent(v, outs[i], vcc, gnd, el.state.q[i], stageOf(i)) },
  }
  return el
}

// ── models ──────────────────────────────────────────────────────────────────
/** DIP package with a moulded pin-1 dot next to the notch (legs end at y = 0). */
export function dipBuild(n, label, { bodyColor = 0x1f1f1f } = {}) {
  const g = new Group()
  g.add(dip(n, { label, bodyColor }))
  const p1 = dipPinXZ(n, 1)
  const dot = cyl(0.035, 0.01, mat(0x3a3a3a, { rough: 0.4 }), { seg: 12 })
  g.add(at(dot, p1.x + 0.02, 0.35 + 0.33 + 0.005, p1.z - 0.14))
  return g
}
/** Real DIP size in mm: body length n/2 × 2.54, 7 mm tall seated, 8.4 mm across the legs. */
export function dipDims(n) { return { w: (n / 2) * PITCH * 10, h: 7.0, d: 8.4 } }
