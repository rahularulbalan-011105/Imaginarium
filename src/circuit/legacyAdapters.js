// Circuit models for the hand-built parts that predate the catalogue, so that
// an LED behind a 220 Ω resistor, or a motor switched by a transistor, works.
// When one of these parts is wired STRAIGHT to a board pin the older direct
// path drives it and its solved state here is ignored (CircuitSim.directIds).
import { addDiode, resistor } from './mna.js'

// LED forward voltage by colour at ~20 mA (typical 5 mm datasheet values).
export function ledVf(color) {
  const c = String(color ?? '#ff0000').toLowerCase()
  const hex = c.startsWith('#') ? parseInt(c.slice(1), 16) : 0xff0000
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255
  if (b > 160 && r < 120) return 3.1          // blue
  if (r > 200 && g > 200 && b > 200) return 3.1 // white
  if (g > 160 && r < 140) return 2.9          // green (InGaN)
  if (r > 200 && g > 140) return 2.1          // yellow / orange
  return 1.9                                  // red
}

/**
 * Diode parameters that put the knee at `vf` for 20 mA with emission n = 2:
 *   I = Is·(exp(Vf/(n·Vt)) − 1)  →  Is = 0.02 / exp(Vf/(n·Vt))
 */
export function ledDiodeParams(vf, { n = 2, iRef = 0.02, Rs = 8 } = {}) {
  const nVt = n * 0.025852
  return { Is: iRef / Math.exp((vf - iRef * Rs) / nVt), n, Rs }
}

export const LEGACY_ADAPTERS = {
  led: {
    circuit(api) {
      const d = addDiode(api, api.pin('ANODE'), api.pin('CATHODE'), ledDiodeParams(ledVf(api.obj.color)))
      return { d }
    },
    solved(h, api) {
      const i = api.cur(h.d)
      if (i > 0.03) api.issue('overcurrent', 'error', `${api.obj.name || 'LED'} has ${(i * 1000).toFixed(0)} mA through it`,
        'A 5 mm LED is rated 20 mA continuous (30 mA max). It would burn out — add a series resistor (220 Ω from 5 V).')
      else api.clearIssue('overcurrent')
      return { current: i, brightness: Math.max(0, Math.min(255, Math.round((i / 0.02) * 255))) }
    },
  },
  // Small DC / gear motors: armature resistance; speed follows the voltage across it.
  ...Object.fromEntries(['motor', 'motor_dc', 'motor_bo'].map(t => [t, {
    circuit(api) { return { r: api.add(resistor(api.pin('TERM_A'), api.pin('TERM_B'), 8)) } },
    solved(h, api) {
      const v = api.vpin('TERM_A') - api.vpin('TERM_B')
      return { voltage: v, speed: Math.max(-255, Math.min(255, Math.round((v / 6) * 255))) }
    },
  }])),
  buzzer: {
    circuit(api) { return { r: api.add(resistor(api.pin('SIGNAL'), api.pin('GND'), 1000)) } },
    solved(h, api) { const v = api.vpin('SIGNAL') - api.vpin('GND'); return { on: v > 2, voltage: v } },
  },
}
