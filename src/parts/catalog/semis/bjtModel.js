// Shared BJT circuit model + run-time checks for the NPN / PNP part files (not
// a part file). Transport Ebers-Moll from mna.js plus the SPICE base spreading
// resistance RB on an internal node, so the base current is measurable.
import { bjt, resistor } from '../../../circuit/mna.js'
import { fmtSI } from '../../model.js'

/**
 * @param {object} api   part circuit api
 * @param {object} m     { pnp, Is, bf, br, rb }
 */
export function stampBjt(api, m) {
  const bi = api.node()
  const rb = api.add(resistor(api.pin('B'), bi, m.rb))
  const q = api.add(bjt(api.pin('C'), bi, api.pin('E'), { pnp: m.pnp, Is: m.Is, bf: m.bf, br: m.br }))
  return { rb, q }
}

/**
 * Solved state + damage checks against absolute-maximum ratings.
 * lim = { pn, icMax, pMax, vceo, vebo }
 */
export function bjtSolved(h, api, m, lim) {
  const s = m.pnp ? -1 : 1
  const ic = api.cur(h.q)                       // into the collector (NPN +, PNP −)
  const ib = api.cur(h.rb)                      // into the base
  const vce = api.vpin('C') - api.vpin('E'), vbe = api.vpin('B') - api.vpin('E')
  const p = Math.max(0, vce * ic + vbe * ib)
  const name = api.obj.name || lim.pn
  const sic = s * ic, sib = s * ib, svce = s * vce
  const region = sic < 1e-6 ? 'off' : (svce < 0.3 && sib > 0 && sic < m.bf * sib * 0.9 ? 'saturated' : 'active')

  if (Math.abs(ic) > lim.icMax) api.issue('ic', 'error', `${name} collector current is ${fmtSI(Math.abs(ic), 'A')}`,
    `The ${lim.pn} is rated ${fmtSI(lim.icMax, 'A')} continuous collector current. Use a larger collector resistor or a power transistor / MOSFET.`)
  else api.clearIssue('ic')
  if (p > lim.pMax) api.issue('power', 'error', `${name} dissipates ${fmtSI(p, 'W')}`,
    `A TO-92 ${lim.pn} can dissipate only ${fmtSI(lim.pMax, 'W')} in free air. Drive the base harder so it saturates, or use a power device.`)
  else api.clearIssue('power')
  if (svce > lim.vceo) api.issue('vce', 'error', `${name} has ${Math.abs(vce).toFixed(1)} V collector–emitter`,
    `Above V_CEO = ${lim.vceo} V the ${lim.pn} breaks down (inductive kick? add a flyback diode).`)
  else api.clearIssue('vce')
  if (-s * vbe > lim.vebo) api.issue('veb', 'error', `${name} base–emitter is reverse-biased by ${Math.abs(vbe).toFixed(1)} V`,
    `The emitter–base junction is rated only ${lim.vebo} V in reverse. Check the E/B/C leg order.`)
  else api.clearIssue('veb')
  if (Math.abs(ib) > 0.05) api.issue('ib', 'warning', `${name} base current is ${fmtSI(Math.abs(ib), 'A')}`,
    'The base has no current-limiting resistor. Put ≈1 kΩ between the Arduino pin and the base.')
  else api.clearIssue('ib')

  return { ic, ib, vce, vbe, power: p, region, beta: Math.abs(ib) > 1e-9 ? ic / ib : 0 }
}
