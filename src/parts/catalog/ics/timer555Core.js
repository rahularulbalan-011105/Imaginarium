// ─────────────────────────────────────────────────────────────────────────────
// NE555 timer core (NOT a part file), shared by the 555 (DIP-8) and the 556
// dual timer (DIP-14, two independent 555s on one die). Each timer is stamped
// from a pin-name map, so the same model and checks serve both packages.
//
//   divider      the real 5 kΩ–5 kΩ–5 kΩ chain VCC → CTRL → (VCC/3 node) → GND,
//                so CTRL sits at 2/3 VCC and can be overridden from outside
//   comparators  THR > V(CTRL) resets the latch; TRIG < V(CTRL)/2 sets it
//                (trigger dominant, as on the real die)
//   RESET        below ≈0.7 V forces OUT low and the discharge on; the pin has
//                an internal bias (≈0.1–0.4 mA) so a floating RESET does not reset
//   discharge    NPN to GND, Ron ≈ 10 Ω (VCE(sat) ≈ 0.1 V at 10 mA), on while OUT is low
//   output       HIGH: Darlington from VCC, VOH = VCC − 1.45 V − 2.5 Ω·I
//                     (datasheet: VOH 3.3 V at −100 mA with VCC = 5 V)
//                LOW:  10 Ω to GND (VOL ≈ 0.1 V at 10 mA); rated ±200 mA
//   supply       ≈3 mA quiescent per timer at 5 V (datasheet ICC 3 mA typ)
// The latch is evaluated before every sub-step from the solved pin voltages
// (sim.transient), so RC timing comes out of the capacitor maths.
// ─────────────────────────────────────────────────────────────────────────────
import { resistor, sw, vsource } from '../../../circuit/mna.js'
import { stampStage, stageCurrent } from '../logic/cmos.js'

const STAGE = { ronHi: 2.5, dropHi: 1.45, ronLo: 10 }
export const TIMER_ROLES = ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC']

/** Output stage element whose level q (1 / 0 / null) is set by the latch. */
function outStage(out, vcc, gnd) {
  return {
    kind: '555OUT', nodes: [out, vcc, gnd], q: null,
    stamp(sys, ctx, el) { stampStage(sys, out, vcc, gnd, el.q, STAGE) },
    currentOf(ctx, el) { return stageCurrent(ctx.v, out, vcc, gnd, el.q, STAGE) },
  }
}

/**
 * Stamp one timer. `m` maps each role in TIMER_ROLES to the part's pin name
 * (GND / VCC may be shared by two timers). `rq` is the rest of the quiescent
 * current as a VCC → GND resistance (null = do not add one).
 */
export function timerCircuit(api, m, { rq = 1900 } = {}) {
  const P = Object.fromEntries(TIMER_ROLES.map(r => [r, api.pin(m[r])]))
  const n3 = api.node()                                      // the VCC/3 tap of the divider
  api.add(resistor(P.VCC, P.CTRL, 5000))
  api.add(resistor(P.CTRL, n3, 5000))
  api.add(resistor(n3, P.GND, 5000))
  if (rq) api.add(resistor(P.VCC, P.GND, rq))                // rest of ICC: 5 V / 1.9 kΩ + 0.33 mA divider ≈ 3 mA
  api.add(vsource(P.RESET, P.GND, 1.4, 12000))               // RESET input bias (pin reads ≈1.4 V when left open)
  const dis = api.add(sw(P.DIS, P.GND, { Ron: 10, Roff: 1e9 }))
  const out = api.add(outStage(P.OUT, P.VCC, P.GND))
  return { m, P, n3, dis, out, q: 0, edges: [] }
}

/** Evaluate the latch from the last solution (call from beforeStep). */
export function timerBeforeStep(h, api) {
  const { m } = h
  const g = api.vpin(m.GND)
  const vcc = api.vpin(m.VCC) - g
  let q = h.q
  if (vcc < 3) q = null                                       // not running
  else if (api.vpin(m.RESET) - g < 0.7) q = 0
  else {
    const vc = api.vpin(m.CTRL) - g
    if (api.vpin(m.TRIG) - g < vc / 2) q = 1                  // trigger comparator (dominant)
    else if (api.vpin(m.THR) - g > vc) q = 0                  // threshold comparator
    else if (q == null) q = 0
  }
  if (q !== h.q) {
    if (q === 1 || h.q === 1) { h.edges.push({ t: api.t, q }); if (h.edges.length > 12) h.edges.shift() }
    h.q = q
  }
  h.out.q = q
  h.dis.closed = q === 0
}

/**
 * Checks + measured waveform for one timer. `sfx` is appended to every issue
 * key ('' for the 555, '1' / '2' for the 556 halves); `who` names it in messages.
 * lim = { vmax: 16, vabs: 18, pins: 'pin 8 to 5V and pin 1 to GND', resetPin: 'pin 4' }.
 */
export function timerSolved(h, api, { sfx = '', who, lim, checkSupply = true }) {
  const { m } = h
  const g = api.vpin(m.GND), vcc = api.vpin(m.VCC) - g
  if (checkSupply) {
    if (vcc > lim.vmax) api.issue('overvoltage', vcc > lim.vabs ? 'error' : 'warning', `${who} has ${vcc.toFixed(1)} V on VCC`, `The ${lim.pn} is rated 4.5–${lim.vmax} V (${lim.vabs} V absolute maximum).`)
    else api.clearIssue('overvoltage')
  }
  const signals = ['TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS'].map(r => m[r])
  const anyWired = signals.some(n => api.connected(n))
  if (anyWired && vcc < 4.5) api.issue(`unpowered${sfx}`, 'warning', `${who} is not powered`, `VCC−GND is ${vcc.toFixed(2)} V. Wire ${lim.pins} (the ${lim.pn} needs 4.5–${lim.vmax} V).`)
  else api.clearIssue(`unpowered${sfx}`)
  if (anyWired && !api.connected(m.RESET)) api.issue(`reset${sfx}`, 'warning', `${who}: RESET (${lim.resetPin}) is not connected`, 'Tie RESET to VCC. Left open it may pick up noise and reset the timer.')
  else api.clearIssue(`reset${sfx}`)
  const iout = api.cur(h.out)
  if (Math.abs(iout) > 0.2) api.issue(`overcurrent${sfx}`, 'error', `${who} output carries ${(Math.abs(iout) * 1000).toFixed(0)} mA`, 'The 555 output is rated ±200 mA. Use a resistor or a transistor for the load.')
  else api.clearIssue(`overcurrent${sfx}`)
  // Measure the waveform like a scope: last rising edges and the high time after them.
  const rises = h.edges.filter(e => e.q === 1).map(e => e.t)
  let period = null, highTime = null
  if (rises.length >= 2) period = rises[rises.length - 1] - rises[rises.length - 2]
  for (let i = h.edges.length - 1; i > 0; i--) {
    if (h.edges[i].q !== 1 && h.edges[i - 1].q === 1) { highTime = h.edges[i].t - h.edges[i - 1].t; break }
  }
  return {
    running: h.q != null, out: h.q, vout: api.vpin(m.OUT) - g, vcc, iout,
    period, freq: period ? 1 / period : null, highTime, duty: period && highTime != null ? highTime / period : null,
  }
}

export const timerReadout = (s) => (!s ? '' : !s.running ? 'off' : s.freq ? `${s.freq.toFixed(2)} Hz · ${(s.duty * 100).toFixed(0)} %` : `OUT ${s.out ? 'HIGH' : 'LOW'}`)
