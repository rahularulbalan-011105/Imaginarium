// Shared LED-junction helpers for the lights / displays parts (RGB LED, bar
// graph, 7-segment). Not a part file (no .part.js): imported by them.
//
// Every LED segment is a real Shockley junction in the MNA solver, with the
// knee placed at the datasheet forward voltage for 20 mA (ledDiodeParams), so
// a missing series resistor, a reversed common or a too-low supply changes the
// current exactly as on the bench.
import { addDiode } from '../../../circuit/mna.js'
import { ledDiodeParams } from '../../../circuit/legacyAdapters.js'

// The shared diodeIV() switches to a linear extension above 40·n·Vt (2.07 V for
// n = 2), so a junction whose operating point is above that conducts almost
// nothing. InGaN (green / blue / white, Vf ≈ 3.2 V) LEDs therefore use an
// ideality factor n = 3.5 — within the 2…7 measured for InGaN LEDs — which puts
// the 20 mA knee (3.04 V) safely below that 3.62 V limit.
export const ledIdeality = (vf) => (vf > 2.4 ? 3.5 : 2)

/** Add one LED junction anode → cathode with forward voltage `vf` (V at 20 mA). */
export function addLed(api, anode, cathode, vf, opts = {}) {
  return addDiode(api, anode, cathode, ledDiodeParams(vf, { n: ledIdeality(vf), ...opts }))
}

/** 0…1 brightness of an LED from its forward current (1 = the 20 mA rating). */
export function ledLevel(i, iRef = 0.02) {
  return i > 2e-5 ? Math.max(0, Math.min(1, i / iRef)) : 0
}

/** Raise / clear an over-current issue for one junction. */
export function checkLedCurrent(api, key, i, maxA, what) {
  if (i > maxA) {
    api.issue(key, 'error', `${api.obj.name || api.obj.type}: ${what} carries ${(i * 1000).toFixed(0)} mA`,
      `It is rated ${(maxA * 1000).toFixed(0)} mA maximum and would burn out. Add a series resistor (220 Ω from 5 V gives ≈13 mA).`)
  } else api.clearIssue(key)
}

/** Mix RGB channel levels (0…1 each) into a hex colour + overall level for setGlow. */
export function mixColor(r, g, b) {
  const L = Math.max(r, g, b)
  if (!(L > 0)) return { hex: 0x000000, level: 0 }
  const c = (x) => Math.round(Math.max(0, Math.min(1, x / L)) * 255)
  return { hex: (c(r) << 16) | (c(g) << 8) | c(b), level: L }
}
