// ─────────────────────────────────────────────────────────────────────────────
// Open-collector voltage comparator channel (NOT a part file), shared by the
// LM339 (quad) and LM393 (dual). Values from TI SLCS006 (LM339) / SLCS005 (LM393):
//
//   decision     OUT sinks (LOW) when V(IN−) > V(IN+); otherwise the output
//                transistor is off and OUT floats (needs a pull-up resistor).
//                No hysteresis on the die (add positive feedback outside).
//   inputs       common-mode range 0 … VCC − 1.5 V. With ONE input inside the
//                range the result is still correct (datasheet note); with BOTH
//                above it the output is undefined: the last state is held and
//                a warning raised. Below −0.3 V the substrate diode conducts
//                (abs. max) → error. Input bias (25 nA typ) is not modelled: it
//                only matters for megohm dividers and would make an unwired
//                input node meaningless.
//   output       saturated sink VOL = 250 mV at 4 mA typ → 62.5 Ω, current-
//                limited at the 16 mA typical sink current (6 mA min) above
//                that; OFF leakage 0.1 nA → 1e-10 S. Output abs. max 36 V.
//   supply       2–36 V single supply; ICC is a resistor VCC → GND chosen by the
//                part (LM339 0.8 mA, LM393 0.4 mA typ at 5 V).
// The region (off / sat / lim) is chosen from each Newton solution in limit(),
// moving only between adjacent regions, like regpass.js.
// ─────────────────────────────────────────────────────────────────────────────
export const CMP = { R_SAT: 0.25 / 0.004, I_SINK: 0.016, G_OFF: 1e-10, CM_HEAD: 1.5, V_MIN: 2, V_MAX: 36 }

export function comparatorChannel({ inp, inn, out, vcc, gnd }) {
  const decide = (v, e) => {
    const vs = v(vcc) - v(gnd)
    if (!(vs >= CMP.V_MIN)) return { on: false, cmBad: false }
    const top = v(gnd) + vs - CMP.CM_HEAD
    const cmBad = v(inp) > top && v(inn) > top
    if (cmBad) return { on: e.on, cmBad }
    return { on: v(inn) > v(inp), cmBad }
  }
  return {
    kind: 'CMP_OC', nodes: [inp, inn, out, vcc, gnd], nonlinear: true,
    m: 'off', on: false, cmBad: false,
    stamp(sys, ctx, e) {
      if (e.m === 'sat') sys.conductance(out, gnd, 1 / CMP.R_SAT)
      else if (e.m === 'lim') sys.current(out, gnd, CMP.I_SINK)
      else sys.conductance(out, gnd, CMP.G_OFF)
    },
    limit(ctx, e) {
      const { on } = decide(ctx.v, e)
      const i = (ctx.v(out) - ctx.v(gnd)) / CMP.R_SAT
      let m = e.m
      if (!on) m = 'off'
      else if (m === 'off') m = 'sat'
      else if (m === 'sat' && i > CMP.I_SINK) m = 'lim'
      else if (m === 'lim' && i < CMP.I_SINK) m = 'sat'
      if (m === e.m) return false
      e.m = m
      return true
    },
    update(ctx, e) { const d = decide(ctx.v, e); e.on = d.on; e.cmBad = d.cmBad },
    /** Current sunk INTO OUT (A). */
    currentOf(ctx, e) {
      const vo = ctx.v(out) - ctx.v(gnd)
      return e.m === 'sat' ? vo / CMP.R_SAT : e.m === 'lim' ? CMP.I_SINK : vo * CMP.G_OFF
    },
  }
}

/**
 * Shared run-time checks + state for a comparator package.
 * chans = [{ k, el, inp, inn, out }] (pin names), name = chip name ('LM339').
 */
export function comparatorSolved(chans, api, pn) {
  const name = api.obj.name || pn
  const g = api.vpin('GND'), vs = api.vpin('VCC') - g
  const used = chans.filter(c => [c.inp, c.inn, c.out].some(n => api.connected(n)))
  if (vs > CMP.V_MAX) api.issue('overvoltage', 'error', `${name} has ${vs.toFixed(1)} V across VCC–GND`, `The ${pn} is rated 2–36 V (single supply).`)
  else api.clearIssue('overvoltage')
  if (used.length && vs < CMP.V_MIN) api.issue('unpowered', 'warning', `${name} is not powered`, `VCC−GND is ${vs.toFixed(2)} V. Wire VCC to 5V and GND to GND (the ${pn} needs 2–36 V).`)
  else api.clearIssue('unpowered')
  const out = {}
  for (const c of chans) {
    const vo = api.vpin(c.out) - g, vp = api.vpin(c.inp) - g, vn = api.vpin(c.inn) - g
    const isink = api.cur(c.el)
    const key = (s) => `${s}${c.k}`
    const wired = used.includes(c)
    if (wired && vs >= CMP.V_MIN && c.el.cmBad) api.issue(key('cm'), 'warning', `${name} comparator ${c.k}: both inputs are above VCC − 1.5 V`,
      `The input common-mode range is 0 … ${(vs - CMP.CM_HEAD).toFixed(1)} V here, so the output is undefined. Keep at least one input below VCC − 1.5 V (e.g. a divider).`)
    else api.clearIssue(key('cm'))
    if (Math.min(vp, vn) < -0.3) api.issue(key('neg'), 'error', `${name} comparator ${c.k}: an input is at ${Math.min(vp, vn).toFixed(2)} V`,
      'Inputs must stay above −0.3 V (absolute maximum); below that the input substrate diode conducts. Clamp with a resistor + diode.')
    else api.clearIssue(key('neg'))
    if (c.el.m === 'lim') api.issue(key('sink'), 'warning', `${name} output ${c.k} is current-limited at 16 mA`,
      `The pull-up / load wants more than the ${pn}'s ≈16 mA sink current, so OUT${c.k} only falls to ${vo.toFixed(2)} V. Use a larger pull-up (≥ 1 kΩ at 5 V).`)
    else api.clearIssue(key('sink'))
    // Open collector: when the transistor is OFF something must pull OUT up.
    if (api.connected(c.out) && vs >= CMP.V_MIN && !c.el.on && vo < 0.5) api.issue(key('pullup'), 'warning', `${name} output ${c.k} has no pull-up`,
      `The ${pn} output is open-collector: it can only pull LOW. With IN+ > IN− it lets go and OUT${c.k} floats (${vo.toFixed(2)} V). Add a pull-up resistor (e.g. 10 kΩ) from OUT${c.k} to VCC, or use INPUT_PULLUP on the Arduino pin.`)
    else api.clearIssue(key('pullup'))
    if (vo > CMP.V_MAX) api.issue(key('vout'), 'error', `${name} output ${c.k} is pulled to ${vo.toFixed(1)} V`, 'The open-collector output allows 36 V at most.')
    else api.clearIssue(key('vout'))
    out[`out${c.k}`] = { low: c.el.on, vout: vo, vin: vp - vn, isink }
  }
  return { ...out, vcc: vs }
}
