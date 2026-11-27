// Shared power-MOSFET circuit model + checks for the N / P channel part files
// (not a part file). Level-1 square-law channel from mna.js with K fitted to
// the datasheet R_DS(on), plus the intrinsic body diode (source → drain for
// N-channel, drain → source for P-channel).
import { mosfet, diode } from '../../../circuit/mna.js'
import { fmtSI } from '../../model.js'

/** m = { pmos, Vth, K, lambda, bodyIs, bodyN } */
export function stampMosfet(api, m) {
  const D = api.pin('D'), G = api.pin('G'), S = api.pin('S')
  const q = api.add(mosfet(D, G, S, { pmos: m.pmos, Vth: m.Vth, K: m.K, lambda: m.lambda }))
  const body = api.add(m.pmos ? diode(D, S, { Is: m.bodyIs, n: m.bodyN }) : diode(S, D, { Is: m.bodyIs, n: m.bodyN }))
  return { q, body }
}

/** lim = { pn, idMax, vdsMax, vgsMax, pFreeAir } */
export function mosfetSolved(h, api, m, lim) {
  const s = m.pmos ? -1 : 1
  const id = api.cur(h.q)                         // into the drain (N +, P −)
  const ibody = api.cur(h.body)
  const vds = api.vpin('D') - api.vpin('S'), vgs = api.vpin('G') - api.vpin('S')
  const p = Math.abs(vds * id) + Math.abs(ibody * vds)
  const name = api.obj.name || lim.pn
  const on = s * vgs > m.Vth
  const rds = on && Math.abs(id) > 1e-6 ? Math.abs(vds / id) : Infinity

  if (Math.abs(id) > lim.idMax) api.issue('id', 'error', `${name} drain current is ${fmtSI(Math.abs(id), 'A')}`,
    `The ${lim.pn} is rated ${lim.idMax} A continuous (with a heatsink).`)
  else api.clearIssue('id')
  if (s * vds > lim.vdsMax) api.issue('vds', 'error', `${name} has ${Math.abs(vds).toFixed(1)} V drain–source`,
    `Above ${lim.vdsMax} V it avalanches. An unclamped coil? Add a flyback diode.`)
  else api.clearIssue('vds')
  if (Math.abs(vgs) > lim.vgsMax) api.issue('vgs', 'error', `${name} gate–source is ${vgs.toFixed(1)} V`,
    `The gate oxide is rated ±${lim.vgsMax} V and is destroyed above it.`)
  else api.clearIssue('vgs')
  if (p > lim.pFreeAir) api.issue('power', 'warning', `${name} dissipates ${fmtSI(p, 'W')}`,
    `Without a heatsink a TO-220 handles only ≈${lim.pFreeAir} W (R_θJA ≈ 62 °C/W). Drive the gate fully on or add a heatsink.`)
  else api.clearIssue('power')
  if (on && Math.abs(id) > 0.1 && Math.abs(vds) > 0.5)
    api.issue('enhance', 'warning', `${name} is not fully on (${vds.toFixed(2)} V across it)`, lim.enhanceHint)
  else api.clearIssue('enhance')

  return { id, vds, vgs, power: p, on, rds, bodyCurrent: ibody }
}
