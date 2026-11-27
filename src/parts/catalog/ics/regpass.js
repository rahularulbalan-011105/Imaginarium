// Linear-regulator pass element (NOT a part file), shared by LM7805 / LM317.
//
// Current I flows IN → OUT through the pass transistor. Four regions:
//   reg      I = G·(V(ref) + vRef − V(OUT))     (ref = GND for a 7805, ADJ for an LM317)
//   dropout  I = G·(V(IN) − vDrop − V(OUT))     (the input is too low to regulate)
//   limit    I = iLim                           (current limiter)
//   off      I = 0                              (OUT pulled above target: it cannot sink)
// The region is chosen from each Newton SOLUTION (in limit()), never from the
// stale iterate: a region is kept only while its own solution is consistent
// with it, so the piecewise-linear switch converges in a couple of iterations.
import { stampI } from '../logic/cmos.js'

export function regulatorPass({ nin, out, ref, vRef, vDrop, iLim, rOut = 0.005 }) {
  const G = 1 / rOut
  const region = (v) => {
    const reg = v(ref) + vRef, drop = v(nin) - vDrop
    const dropout = drop < reg
    const I0 = G * ((dropout ? drop : reg) - v(out))
    return { I0, lin: dropout ? 'dropout' : 'reg' }
  }
  return {
    kind: 'REGPASS', nodes: [nin, out, ref], nonlinear: true,
    m: 'reg', mode: 'reg', I: 0,
    stamp(sys, ctx, e) {
      if (e.m === 'reg') stampI(sys, nin, out, [[ref, G], [out, -G]], G * vRef)
      else if (e.m === 'dropout') stampI(sys, nin, out, [[nin, G], [out, -G]], -G * vDrop)
      else if (e.m === 'limit') stampI(sys, nin, out, [], iLim)
    },
    limit(ctx, e) {
      const { I0, lin } = region(ctx.v)
      // Only ADJACENT regions: off ⇄ linear ⇄ limit. Jumping off → limit (or
      // back) from an inconsistent solution would cycle for ever.
      let m = e.m
      if (m === 'off') m = I0 > 0 ? lin : 'off'
      else if (m === 'limit') m = I0 <= iLim ? lin : 'limit'
      else if (lin !== m) m = lin                // reg ⇄ dropout first (Vout = min of the two)
      else m = I0 > iLim ? 'limit' : I0 <= 0 ? 'off' : lin
      if (m === e.m) return false
      e.m = m
      return true
    },
    update(ctx, e) {
      const { I0 } = region(ctx.v)
      e.mode = e.m
      e.I = e.m === 'limit' ? iLim : e.m === 'off' ? 0 : Math.max(0, I0)
    },
  }
}
