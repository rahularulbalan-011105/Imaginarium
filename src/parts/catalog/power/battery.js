// Shared circuit model for the battery parts in this folder (NOT a part file).
//
// A primary cell is an EMF in series with its internal resistance (Thevenin);
// the solver stamps it as a Norton source (vsource with rInt), no branch needed.
// Series cells in a holder simply add their EMFs and resistances.
//
// Checks every battery makes, after each solve:
//   short circuit   I > 0.8·Isc, i.e. the terminal voltage has collapsed below
//                   20 % of the EMF — something with almost no resistance is
//                   across the terminals (a wire, an ammeter, a reversed diode).
//   overload        I above the chemistry's sensible continuous drain.
//   reverse current something is pushing current INTO the + terminal (a higher
//                   supply in parallel, a reversed cell in a pack): primary
//                   alkaline / lithium cells are not rechargeable and can leak
//                   or vent.
import { vsource } from '../../../circuit/mna.js'
import { fmtSI } from '../../model.js'

/**
 * @param {object} o
 * @param {number} o.V      EMF (V)
 * @param {number} o.rInt   internal resistance (Ω)
 * @param {number} o.iMax   continuous drain above which we warn (A)
 * @param {string} o.what   human name used in messages ('9 V battery')
 */
export function batterySim({ V, rInt, iMax, what }) {
  const isc = V / rInt
  return {
    circuit(api) { return { src: api.add(vsource(api.pin('POS'), api.pin('NEG'), V, rInt)) } },
    solved(h, api) {
      const v = api.vpin('POS') - api.vpin('NEG')
      const i = api.cur(h.src)                       // A out of + into the circuit
      const name = api.obj.name || what
      if (i > 0.8 * isc) {
        api.issue('short', 'error', `${name} is short-circuited (${fmtSI(i, 'A')})`,
          `Its terminals are joined by almost no resistance, so only its own ${rInt} Ω internal resistance limits the current (≈${fmtSI(isc, 'A')}). A real ${what} gets hot, drains in minutes and can leak or burst. Put a load (resistor, LED with resistor, motor) between + and −.`)
        api.clearIssue('overload')
      } else {
        api.clearIssue('short')
        if (i > iMax) api.issue('overload', 'warning', `${name} is supplying ${fmtSI(i, 'A')}`,
          `That is more than a ${what} can deliver continuously (≈${fmtSI(iMax, 'A')}); its voltage sags to ${v.toFixed(2)} V and it will be flat quickly.`)
        else api.clearIssue('overload')
      }
      if (i < -0.01) api.issue('reverse', 'warning', `Current is flowing INTO ${name} (${fmtSI(-i, 'A')})`,
        `Another source in the circuit is forcing current backwards through it (a higher-voltage supply in parallel, or a cell connected the wrong way round). A ${what} is not rechargeable — it can leak or vent. Check the polarity of every source.`)
      else api.clearIssue('reverse')
      return { voltage: v, current: i, power: v * i, emf: V, rInt }
    },
  }
}

export const batteryReadout = ({ solved }) => (solved ? `${solved.voltage.toFixed(2)} V · ${fmtSI(solved.current, 'A')}` : null)
