// ─────────────────────────────────────────────────────────────────────────────
// Modified Nodal Analysis (MNA) circuit solver.
//
// Unknowns: the voltage of every non-ground node, then the current through
// every voltage source (and inductor in DC). Ground is node 0 and is not an
// unknown. Each element STAMPS its contribution into G·x = b:
//
//   linear      resistor, current source, voltage source, VCVS
//   reactive    capacitor / inductor: backward-Euler companion models
//               (a conductance in parallel with a current source that carries
//               the state from the previous time step)
//   nonlinear   diode / LED / Zener, BJT (Ebers-Moll), MOSFET (square law):
//               linearised around the current guess each Newton iteration
//
// The solve is a damped Newton-Raphson: stamp → LU solve → limit the junction
// voltage step (SPICE "pnjlim") → repeat until node voltages move less than
// VTOL. A tiny GMIN from every node to ground keeps floating nodes (an open
// switch, an unconnected input) solvable instead of singular.
//
// Circuits in this app are small (tens of nodes), so a dense matrix with
// partial-pivot Gaussian elimination is faster and simpler than a sparse one.
// ─────────────────────────────────────────────────────────────────────────────

export const GMIN = 1e-12          // S from each node to ground
const VTOL = 1e-6                  // V   Newton convergence on node voltages
const ITOL = 1e-9                  // A   …and on source currents
const MAX_ITER = 120
const VT = 0.025852                // thermal voltage at 300 K

/** Dense linear system builder for one Newton iteration. */
export class MNASystem {
  constructor(nNodes, nBranches) {
    this.nNodes = nNodes            // INCLUDING ground (index 0)
    this.nBranches = nBranches
    this.size = nNodes - 1 + nBranches
    this.A = Array.from({ length: this.size }, () => new Float64Array(this.size))
    this.b = new Float64Array(this.size)
  }
  clear() { for (const row of this.A) row.fill(0); this.b.fill(0) }
  // node index → row (ground has no row)
  _r(n) { return n - 1 }
  _br(k) { return this.nNodes - 1 + k }
  addA(i, j, v) { if (i >= 0 && j >= 0) this.A[i][j] += v }
  /** Conductance g between nodes a and b. */
  conductance(a, b, g) {
    const ra = this._r(a), rb = this._r(b)
    this.addA(ra, ra, g); this.addA(rb, rb, g)
    this.addA(ra, rb, -g); this.addA(rb, ra, -g)
  }
  /** Current i flowing from a, through the element, into b (a → b). */
  current(a, b, i) {
    const ra = this._r(a), rb = this._r(b)
    if (ra >= 0) this.b[ra] -= i
    if (rb >= 0) this.b[rb] += i
  }
  /** Ideal voltage source V(a) − V(b) = v, its current is branch unknown k. */
  voltage(a, b, v, k) {
    const ra = this._r(a), rb = this._r(b), rk = this._br(k)
    this.addA(ra, rk, 1); this.addA(rb, rk, -1)
    this.addA(rk, ra, 1); this.addA(rk, rb, -1)
    this.b[rk] += v
  }
  /** Voltage-controlled voltage source V(a)−V(b) = gain·(V(c)−V(d)), branch k. */
  vcvs(a, b, c, d, gain, k) {
    const ra = this._r(a), rb = this._r(b), rc = this._r(c), rd = this._r(d), rk = this._br(k)
    this.addA(ra, rk, 1); this.addA(rb, rk, -1)
    this.addA(rk, ra, 1); this.addA(rk, rb, -1)
    this.addA(rk, rc, -gain); this.addA(rk, rd, gain)
  }
  /** Voltage-controlled current source: i(a→b) = g·(V(c)−V(d)). */
  vccs(a, b, c, d, g) {
    const ra = this._r(a), rb = this._r(b), rc = this._r(c), rd = this._r(d)
    this.addA(ra, rc, g); this.addA(ra, rd, -g)
    this.addA(rb, rc, -g); this.addA(rb, rd, g)
  }
  /** Solve in place (Gaussian elimination, partial pivoting). Returns x or null if singular. */
  solve() {
    const n = this.size, A = this.A, b = this.b
    const x = new Float64Array(n)
    if (n === 0) return x
    const M = A.map(r => Float64Array.from(r)), y = Float64Array.from(b)
    for (let c = 0; c < n; c++) {
      let p = c, best = Math.abs(M[c][c])
      for (let r = c + 1; r < n; r++) { const v = Math.abs(M[r][c]); if (v > best) { best = v; p = r } }
      if (best < 1e-18) return null
      if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; const ty = y[p]; y[p] = y[c]; y[c] = ty }
      const piv = M[c][c]
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / piv
        if (f === 0) continue
        const Mr = M[r], Mc = M[c]
        for (let k = c; k < n; k++) Mr[k] -= f * Mc[k]
        y[r] -= f * y[c]
      }
    }
    for (let r = n - 1; r >= 0; r--) {
      let s = y[r]
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
      x[r] = s / M[r][r]
    }
    return x
  }
}

// SPICE pn-junction voltage limiting: keeps exp() from overflowing and Newton
// from oscillating when a junction swings from off to on in one step.
export function pnjlim(vnew, vold, vt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit
    }
    return vt * Math.log(vnew / vt)
  }
  return vnew
}

/** Diode current and conductance at junction voltage v (with GMIN for stability). */
export function diodeIV(v, Is, nVt) {
  // Linear extension only where the junction would already carry ~100 A, so a
  // part with a tiny Is (an LED or Zener tuned to its forward voltage) still
  // follows the true exponential across its whole working range. (A fixed
  // 40·nVt limit is right for silicon but sits at ≈2 V for n = 2 — below a blue
  // LED's knee.) Capped so exp() can never overflow.
  const lim = nVt * Math.min(Math.log(100 / Is), 700)
  let i, g
  if (v > lim) {                    // linear extension above the overflow point
    const e = Math.exp(lim / nVt)
    i = Is * (e * (1 + (v - lim) / nVt) - 1); g = Is * e / nVt
  } else if (v < -5 * nVt) {        // reverse: saturation current
    i = -Is; g = GMIN
  } else {
    const e = Math.exp(v / nVt)
    i = Is * (e - 1); g = Is * e / nVt
  }
  return { i, g: g + GMIN }
}

/**
 * A circuit = nodes + elements. Elements are plain objects with
 *   nodes: number[]            node indices (0 = ground)
 *   branches?: number          how many branch-current unknowns it needs
 *   stamp(sys, ctx)            ctx = { v(node), x, dt, t, first, br(k), state }
 *   update?(ctx)               commit state after an accepted time step
 *   nonlinear?: boolean
 *   limit?(ctx)                optional per-iteration junction limiting
 */
export class Circuit {
  constructor() {
    this.nodeCount = 1              // node 0 = ground
    this.elements = []
    this.branchCount = 0
    this.t = 0
    this.x = null                   // last solution vector
    this.converged = true
    this.iterations = 0
  }
  node() { return this.nodeCount++ }
  add(el) {
    el.branchBase = this.branchCount
    this.branchCount += el.branches ?? 0
    el.state ??= {}
    this.elements.push(el)
    return el
  }
  get nonlinear() { return this.elements.some(e => e.nonlinear) }

  /** Voltage of node n in solution x (ground = 0). */
  // A node created after the last solve (a net nothing drives) reads 0 V.
  voltageOf(n, x = this.x) { return n <= 0 || !x ? 0 : (x[n - 1] ?? 0) }
  /** Current of branch unknown k (global index). */
  branchCurrent(k, x = this.x) { return x ? x[this.nodeCount - 1 + k] : 0 }

  /**
   * Advance by dt seconds (dt = 0 → DC operating point: capacitors open,
   * inductors short). Returns true when Newton converged.
   */
  step(dt = 0) {
    const sys = new MNASystem(this.nodeCount, this.branchCount)
    let x = this.x && this.x.length === sys.size ? Float64Array.from(this.x) : new Float64Array(sys.size)
    const self = this
    const ctx = {
      dt, t: this.t + dt, x,
      v: (n) => (n <= 0 ? 0 : ctx.x[n - 1]),
      br: (el, k = 0) => self.nodeCount - 1 + el.branchBase + k,
      brI: (el, k = 0) => ctx.x[self.nodeCount - 1 + el.branchBase + k],
    }
    const maxIter = this.nonlinear ? MAX_ITER : 1
    const newton = (x0) => {
      let xs = x0, conv = false, it = 0
      ctx.x = xs
      for (; it < maxIter; it++) {
        sys.clear()
        for (let n = 1; n < this.nodeCount; n++) sys.addA(n - 1, n - 1, GMIN)
        for (const el of this.elements) el.stamp(sys, ctx, el)
        const nx = sys.solve()
        if (!nx) { conv = false; break }
        let maxDv = 0, maxDi = 0
        for (let k = 0; k < nx.length; k++) {
          const d = Math.abs(nx[k] - xs[k])
          if (k < this.nodeCount - 1) maxDv = Math.max(maxDv, d); else maxDi = Math.max(maxDi, d)
        }
        xs = nx; ctx.x = xs
        // A limiter returns true while it is still clipping a junction step — the
        // linearisation point then differs from the solution, so not converged yet.
        let clipped = false
        for (const el of this.elements) if (el.limit?.(ctx, el)) clipped = true
        if (!this.nonlinear || (it > 0 && !clipped && maxDv < VTOL && maxDi < ITOL)) { conv = true; it++; break }
      }
      return { xs, conv, it }
    }
    let r = newton(x)
    // Warm-start trap: starting from the previous solution can leave Newton
    // cycling (an op-amp whose output was saturated sees a zero slope and flips
    // rail to rail). Retry once from a cold start before giving up.
    if (!r.conv && this.nonlinear && this.x) {
      for (const el of this.elements) { el._vdIter = undefined; el._vbe = undefined; el._vbc = undefined }
      const first = r.it
      r = newton(new Float64Array(sys.size))
      r.it += first
    }
    x = r.xs
    const converged = r.conv
    const iter = r.it
    this.iterations = iter
    this.converged = converged
    if (converged || !this.x) {
      this.x = x
      this.t += dt
      for (const el of this.elements) el.update?.(ctx, el)
    }
    return converged
  }
}

// ── Element factories ────────────────────────────────────────────────────────
// Every factory returns an element object; Circuit.add() registers it.

export function resistor(a, b, R) {
  return {
    kind: 'R', nodes: [a, b], R,
    stamp(sys, ctx, el) { sys.conductance(a, b, 1 / Math.max(el.R, 1e-6)) },
    currentOf(ctx, el) { return (ctx.v(a) - ctx.v(b)) / Math.max(el.R, 1e-6) },
  }
}

/** Voltage source with optional internal (series) resistance. */
export function vsource(pos, neg, V, rInt = 0) {
  if (rInt > 0) {
    // Norton equivalent: current V/r in parallel with conductance 1/r — no branch needed.
    return {
      kind: 'Vr', nodes: [pos, neg], V, r: rInt,
      stamp(sys, ctx, el) { sys.conductance(pos, neg, 1 / el.r); sys.current(neg, pos, el.V / el.r) },
      currentOf(ctx, el) { return (el.V - (ctx.v(pos) - ctx.v(neg))) / el.r },   // out of +
    }
  }
  return {
    kind: 'V', nodes: [pos, neg], V, branches: 1,
    stamp(sys, ctx, el) { sys.voltage(pos, neg, el.V, el.branchBase) },
    currentOf(ctx, el) { return -ctx.brI(el) },   // out of + terminal into the circuit
  }
}

export function isource(a, b, I) {
  return { kind: 'I', nodes: [a, b], I, stamp(sys, ctx, el) { sys.current(a, b, el.I) } }
}

/** Capacitor: backward-Euler companion G = C/dt, Ieq = G·v_prev. Open in DC. */
export function capacitor(a, b, C, { v0 = 0, maxV = Infinity, polarized = false } = {}) {
  return {
    kind: 'C', nodes: [a, b], C, maxV, polarized,
    state: { v: v0 },
    stamp(sys, ctx, el) {
      if (!(ctx.dt > 0)) return                        // DC: open circuit
      const g = el.C / ctx.dt
      sys.conductance(a, b, g)
      sys.current(b, a, g * el.state.v)
    },
    // The step's current is stored when the step is committed, so it can still be
    // read after update() has moved state.v on (C·dv/dt of the step just taken).
    update(ctx, el) {
      if (!(ctx.dt > 0)) { el.state.i = 0; return }
      const v = ctx.v(a) - ctx.v(b)
      el.state.i = (el.C / ctx.dt) * (v - el.state.v)
      el.state.v = v
    },
    currentOf(ctx, el) { return el.state.i ?? 0 },
  }
}

/** Inductor: short in DC (branch current), BE companion in transient. */
export function inductor(a, b, L, { i0 = 0 } = {}) {
  return {
    kind: 'L', nodes: [a, b], L, branches: 1,
    state: { i: i0 },
    stamp(sys, ctx, el) {
      const k = el.branchBase
      if (!(ctx.dt > 0)) { sys.voltage(a, b, 0, k); return }
      // V(a) − V(b) − (L/dt)·i = −(L/dt)·i_prev
      const ra = sys._r(a), rb = sys._r(b), rk = sys._br(k), z = el.L / ctx.dt
      sys.addA(ra, rk, 1); sys.addA(rb, rk, -1)
      sys.addA(rk, ra, 1); sys.addA(rk, rb, -1); sys.addA(rk, rk, -z)
      sys.b[rk] += -z * el.state.i
    },
    update(ctx, el) { el.state.i = ctx.brI(el) },
    currentOf(ctx, el) { return ctx.brI(el) },
  }
}

/**
 * Diode junction (also LED and Zener): Shockley equation, with an optional
 * reverse breakdown at Vz (Zener). Parameters: Is saturation current, n
 * emission coefficient. Series resistance is NOT folded in here — put a
 * resistor() on an internal node in series (see addDiode), as SPICE does.
 */
export function diode(anode, cathode, { Is = 1e-14, n = 1, Vz = 0 } = {}) {
  const nVt = n * VT
  const vcrit = nVt * Math.log(nVt / (Math.SQRT2 * Is))
  const el = {
    kind: 'D', nodes: [anode, cathode], nonlinear: true, Is, n, Vz,
    state: { vd: 0 },
    stamp(sys, ctx, e) {
      let vd = ctx.v(anode) - ctx.v(cathode)
      vd = e._vdIter ?? vd
      let { i, g } = diodeIV(vd, e.Is, nVt)
      if (e.Vz > 0) {                                     // reverse breakdown branch
        const zb = diodeIV(-vd - e.Vz, e.Is, nVt)
        i -= zb.i; g += zb.g
      }
      sys.conductance(anode, cathode, g)
      sys.current(anode, cathode, i - g * vd)
    },
    limit(ctx, e) {
      const vnew = ctx.v(anode) - ctx.v(cathode)
      const vold = e._vdIter ?? e.state.vd
      e._vdIter = pnjlim(vnew, vold, nVt, vcrit)
      return Math.abs(e._vdIter - vnew) > VTOL
    },
    update(ctx, e) { e.state.vd = ctx.v(anode) - ctx.v(cathode); e._vdIter = undefined },
    currentOf(ctx, e) {
      const vd = ctx.v(anode) - ctx.v(cathode)
      let { i } = diodeIV(vd, e.Is, nVt)
      if (e.Vz > 0) i -= diodeIV(-vd - e.Vz, e.Is, nVt).i
      return i
    },
  }
  return el
}

/**
 * A diode with series resistance Rs: junction + resistor through an internal
 * node. `c` is a Circuit (or a part api with node()/add()). Returns the junction
 * element, whose currentOf() is the branch current.
 */
export function addDiode(c, anode, cathode, { Rs = 0, ...params } = {}) {
  if (!(Rs > 0)) return c.add(diode(anode, cathode, params))
  const mid = c.node()
  c.add(resistor(anode, mid, Rs))
  return c.add(diode(mid, cathode, params))
}

/**
 * BJT, transport Ebers-Moll model (no Early effect).
 *   pnp = false: NPN, true: PNP.  bf forward β, br reverse β.
 */
export function bjt(c, b, e, { pnp = false, Is = 1e-14, bf = 100, br = 1 } = {}) {
  const s = pnp ? -1 : 1
  const vcrit = VT * Math.log(VT / (Math.SQRT2 * Is))
  return {
    kind: pnp ? 'PNP' : 'NPN', nodes: [c, b, e], nonlinear: true,
    state: { vbe: 0, vbc: 0 },
    stamp(sys, ctx, el) {
      const vbe = el._vbe ?? s * (ctx.v(b) - ctx.v(e))
      const vbc = el._vbc ?? s * (ctx.v(b) - ctx.v(c))
      const F = diodeIV(vbe, Is, VT), R = diodeIV(vbc, Is, VT)
      // Terminal currents (into the device), NPN polarity:
      //   ic = IF − IR − IR/br ,  ib = IF/bf + IR/br ,  ie = −(ic + ib)
      const ic = F.i - R.i - R.i / br
      const ib = F.i / bf + R.i / br
      // Partial derivatives wrt vbe, vbc
      const dic_dvbe = F.g, dic_dvbc = -R.g - R.g / br
      const dib_dvbe = F.g / bf, dib_dvbc = R.g / br
      // Linearised current into terminal X: iX ≈ iX0 + d/dvbe·Δvbe + d/dvbc·Δvbc.
      // Express in node voltages (vbe = s(Vb−Ve), vbc = s(Vb−Vc)) and stamp as
      // VCCS entries + equivalent current sources (currents leave node via sys.current).
      const stampTerm = (node, i0, dvbe, dvbc) => {
        const r = sys._r(node)
        if (r < 0) return
        // current INTO device at `node` = leaving the node into the device
        // G-row: +d(i)/dV(node...) ; b: −(i0 − dvbe·vbe − dvbc·vbc)
        sys.addA(r, sys._r(b), s * (dvbe + dvbc) * s)
        sys.addA(r, sys._r(e), -s * dvbe * s)
        sys.addA(r, sys._r(c), -s * dvbc * s)
        sys.b[r] -= s * (i0 - dvbe * vbe - dvbc * vbc)
      }
      stampTerm(c, ic, dic_dvbe, dic_dvbc)
      stampTerm(b, ib, dib_dvbe, dib_dvbc)
      stampTerm(e, -(ic + ib), -(dic_dvbe + dib_dvbe), -(dic_dvbc + dib_dvbc))
    },
    limit(ctx, el) {
      const vbe = s * (ctx.v(b) - ctx.v(e)), vbc = s * (ctx.v(b) - ctx.v(c))
      el._vbe = pnjlim(vbe, el._vbe ?? el.state.vbe, VT, vcrit)
      el._vbc = pnjlim(vbc, el._vbc ?? el.state.vbc, VT, vcrit)
      return Math.abs(el._vbe - vbe) > VTOL || Math.abs(el._vbc - vbc) > VTOL
    },
    update(ctx, el) {
      el.state.vbe = s * (ctx.v(b) - ctx.v(e)); el.state.vbc = s * (ctx.v(b) - ctx.v(c))
      el._vbe = el._vbc = undefined
    },
    /** Collector current (into collector, NPN positive). */
    currentOf(ctx) {
      const vbe = s * (ctx.v(b) - ctx.v(e)), vbc = s * (ctx.v(b) - ctx.v(c))
      const F = diodeIV(vbe, Is, VT), R = diodeIV(vbc, Is, VT)
      return s * (F.i - R.i - R.i / br)
    },
  }
}

/**
 * MOSFET, level-1 (Shichman-Hodges) square law with channel-length modulation.
 *   pmos = false: N-channel, true: P-channel.  Vth threshold (positive number),
 *   K = µCox·W/L (A/V²), lambda.  Body tied to source. Symmetric drain/source.
 */
export function mosfet(d, g, s_, { pmos = false, Vth = 2, K = 0.5, lambda = 0.01, Ron = 0 } = {}) {
  const p = pmos ? -1 : 1
  return {
    kind: pmos ? 'PMOS' : 'NMOS', nodes: [d, g, s_], nonlinear: true,
    stamp(sys, ctx) {
      let vd = ctx.v(d), vs = ctx.v(s_)
      let dN = d, sN = s_
      if (p * (vd - vs) < 0) { [vd, vs] = [vs, vd]; [dN, sN] = [s_, d] }   // swap for symmetry
      const vgs = p * (ctx.v(g) - vs), vds = p * (vd - vs)
      const vov = vgs - Vth
      let id = 0, gm = 0, gds = 0
      if (vov <= 0) { id = 0; gm = 0; gds = 0 }
      else if (vds < vov) {                                            // triode
        id = K * (vov * vds - vds * vds / 2) * (1 + lambda * vds)
        gm = K * vds * (1 + lambda * vds)
        gds = K * (vov - vds) * (1 + lambda * vds) + K * (vov * vds - vds * vds / 2) * lambda
      } else {                                                         // saturation
        id = 0.5 * K * vov * vov * (1 + lambda * vds)
        gm = K * vov * (1 + lambda * vds)
        gds = 0.5 * K * vov * vov * lambda
      }
      gds += 1e-9
      // id flows dN → sN (for NMOS polarity); linearise: id ≈ id0 + gm·Δvgs + gds·Δvds
      const ieq = p * (id - gm * vgs - gds * vds)
      sys.conductance(dN, sN, gds)
      sys.vccs(dN, sN, g, sN, gm)
      sys.current(dN, sN, ieq)
    },
    currentOf(ctx) {
      let vd = ctx.v(d), vs = ctx.v(s_), sign = 1
      if (p * (vd - vs) < 0) { [vd, vs] = [vs, vd]; sign = -1 }
      const vgs = p * (ctx.v(g) - vs), vds = p * (vd - vs), vov = vgs - Vth
      if (vov <= 0) return 0
      const id = vds < vov ? K * (vov * vds - vds * vds / 2) * (1 + lambda * vds) : 0.5 * K * vov * vov * (1 + lambda * vds)
      return sign * p * id                                             // drain current (into drain)
    },
  }
}

/** Switch: Ron when closed, Roff when open. `closed` is mutable. */
export function sw(a, b, { closed = false, Ron = 0.01, Roff = 1e12 } = {}) {
  return {
    kind: 'SW', nodes: [a, b], closed, Ron, Roff,
    stamp(sys, ctx, el) { sys.conductance(a, b, 1 / (el.closed ? el.Ron : el.Roff)) },
    currentOf(ctx, el) { return (ctx.v(a) - ctx.v(b)) / (el.closed ? el.Ron : el.Roff) },
  }
}

/**
 * Op-amp: high-gain VCVS from (in+ − in−) with its output clamped between the
 * supply rails (minus a headroom), via a Newton-friendly soft limit.
 */
export function opamp(inp, inn, out, vpos, vneg, { gain = 2e5, headroom = 1.5, rOut = 75 } = {}) {
  return {
    kind: 'OPAMP', nodes: [inp, inn, out, vpos, vneg], nonlinear: true, branches: 1,
    stamp(sys, ctx, el) {
      const k = el.branchBase
      const vd = ctx.v(inp) - ctx.v(inn)
      const hi = ctx.v(vpos) - headroom, lo = ctx.v(vneg) + headroom
      const mid = (hi + lo) / 2, half = Math.max((hi - lo) / 2, 0.01)
      // vo = mid + half·tanh(gain·vd/half) — linearised
      const u = gain * vd / half
      const th = Math.tanh(u)
      const vo = mid + half * th
      const dvo = gain * (1 - th * th)
      // Internal ideal source node: V(out) = vo0 + dvo·(vd − vd0), out through rOut
      // Implement as VCVS (branch k) on out with Thevenin rOut folded by a resistor.
      const ro = sys._r(out), rk = sys._br(k)
      sys.addA(ro, rk, 1); sys.addA(rk, ro, 1)
      sys.addA(rk, rk, -rOut)
      sys.addA(rk, sys._r(inp), -dvo); sys.addA(rk, sys._r(inn), dvo)
      sys.b[rk] += vo - dvo * vd
      // supply current is not modelled (rails are ideal)
    },
  }
}
