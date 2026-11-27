// 1N47xxA 1 W Zener diode (Tinkercad "Zener Diode"), default 1N4733A 5.1 V.
// DO-41 glass body Ø2.7 × 5.2 mm, black band = cathode, leads at 0.4".
// Datasheet (Vishay / ON Semi 1N4728A–1N4764A, 1 W): V_Z at the test current
// I_ZT, dynamic impedance Z_ZT at I_ZT, P_D 1 W, V_F ≤ 1.2 V at 200 mA.
//
// Circuit model: a forward junction A→K, plus a breakdown branch K→A made of a
// series resistance, a junction and a voltage offset. The junction's emission
// is chosen so the slope resistance at I_ZT equals the datasheet Z_ZT
// (n·Vt/I_ZT + Rs = Z_ZT, split 20 % / 80 %) and the offset puts exactly V_Z at
// I_ZT. Below I_ZT the voltage falls off logarithmically (the soft knee).
import { definePart } from '../../definePart.js'
import { diode, addDiode, resistor, vsource } from '../../../circuit/mna.js'
import { fmtSI } from '../../model.js'
import { do41, DO41_PINS } from './packages.js'

// [Vz, Izt (A), Zzt (Ω)] from the 1N4728A…1N4742A table.
const TABLE = {
  '3.3': ['1N4728A', 3.3, 0.076, 10], '3.6': ['1N4729A', 3.6, 0.069, 10], '3.9': ['1N4730A', 3.9, 0.064, 9],
  '4.3': ['1N4731A', 4.3, 0.058, 9], '4.7': ['1N4732A', 4.7, 0.053, 8], '5.1': ['1N4733A', 5.1, 0.049, 7],
  '5.6': ['1N4734A', 5.6, 0.045, 5], '6.2': ['1N4735A', 6.2, 0.041, 2], '6.8': ['1N4736A', 6.8, 0.037, 3.5],
  '7.5': ['1N4737A', 7.5, 0.034, 4], '8.2': ['1N4738A', 8.2, 0.031, 4.5], '9.1': ['1N4739A', 9.1, 0.028, 5],
  '10': ['1N4740A', 10, 0.025, 7], '12': ['1N4742A', 12, 0.021, 9],
}
const P_MAX = 1.0
const VT = 0.025852
const IS_B = 1e-14

export function zenerParams(key) {
  const [pn, Vz, Izt, Zzt] = TABLE[key] ?? TABLE['5.1']
  const nVt = 0.2 * Izt * Zzt, Rs = 0.8 * Zzt
  const Voff = Vz - nVt * Math.log(Izt / IS_B + 1) - Izt * Rs
  return { pn, Vz, Izt, Zzt, n: nVt / VT, Rs, Voff }
}

export default definePart({
  type: 'zener_diode',
  label: 'Zener Diode',
  shortName: 'DZ',
  tinkercad: 'Zener Diode',
  category: 'semis',
  icon: '⊳Z',
  desc: '1N47xxA 1 W Zener · default 1N4733A 5.1 V',
  purpose: 'Conducts backwards once the voltage across it reaches its Zener voltage, so it holds a node at V_Z. Wire it band (cathode) toward + with a series resistor from the supply: R = (V_in − V_Z) / I. It also conducts forwards like a normal diode.',
  usage: 'voltage references · simple shunt regulators · over-voltage clamps',
  spec: {
    dims_mm: { w: 11.0, h: 4.35, d: 2.7 }, mass_kg: 0.00035, power_W: P_MAX,
    summary: '1 W Zener. Cathode (black band) toward +. Holds V_Z at its test current I_ZT; always use a series resistor.',
  },
  props: {
    vz: {
      type: 'select', label: 'Zener voltage', unit: 'V', default: '5.1',
      options: Object.entries(TABLE).map(([k, [pn]]) => ({ value: k, label: `${k} V (${pn})` })),
    },
  },
  pins: DO41_PINS,
  build() { return do41({ glass: true }) },
  sim: {
    circuit(api) {
      const z = zenerParams(api.prop('vz'))
      const A = api.pin('ANODE'), K = api.pin('CATHODE')
      const fwd = addDiode(api, A, K, { Is: 1e-12, n: 1, Rs: 0.5 })
      // Breakdown branch K → m → (junction) → q → (−Voff source) → A.
      const m = api.node(), q = api.node()
      api.add(resistor(K, m, z.Rs))
      const brk = api.add(diode(m, q, { Is: IS_B, n: z.n }))
      api.add(vsource(q, A, z.Voff))
      return { fwd, brk, z }
    },
    solved(h, api) {
      const vr = api.vpin('CATHODE') - api.vpin('ANODE')     // reverse voltage
      const iz = api.cur(h.brk), iff = api.cur(h.fwd)
      const i = iz - iff                                    // net current cathode → anode
      const p = Math.abs(vr * i)
      const name = api.obj.name || 'Zener'
      if (p > P_MAX) api.issue('power', 'error', `${name} dissipates ${fmtSI(p, 'W')}`,
        `A ${h.z.pn} is rated 1 W. Increase the series resistor: R ≥ (V_in − ${h.z.Vz} V) / ${fmtSI(P_MAX / h.z.Vz, 'A')}.`)
      else api.clearIssue('power')
      return { vz: vr, current: i, power: p, regulating: iz > 1e-3, part: h.z.pn }
    },
  },
  tests: [
    {
      name: '1N4728A (3.3 V) regulates: 5 V through 22 Ω holds ≈3.3 V, and a 330 Ω load barely moves it',
      run(kit) {
        const wires = [['R:1', 'U:5V'], ['R:2', 'Z:CATHODE'], ['Z:ANODE', 'U:GND1'], ['Z:CATHODE', 'U:A0']]
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 22 }, Z: { type: 'zener_diode', vz: '3.3' } }, wires)
        kit.step(0.02)
        // Datasheet: V_Z = 3.3 V at I_ZT = 76 mA, Z_ZT = 10 Ω.  I = (5 − 3.3) / 22 ≈ 77 mA ≈ I_ZT → V ≈ 3.3 V.
        const v0 = kit.state('Z').vz
        kit.near(v0, 3.3, 0.06, 'Zener voltage at ≈I_ZT')
        kit.near(kit.state('Z').current, (5 - 3.3) / 22, 0.004, 'Zener current')
        kit.near(kit.analogRead(14), Math.round(3.3 / 5 * 1023), 12, 'analogRead(A0)')
        // Add a 330 Ω load: it takes ≈10 mA, so the Zener current falls ≈10 mA and
        // V falls by ≈ ΔI·Z_ZT = 10 mA · 10 Ω ≈ 0.1 V. (The same 22 Ω / 330 Ω divider
        // without the Zener would sit at 4.69 V, so the Zener is what holds 3.3 V.)
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 22 }, Z: { type: 'zener_diode', vz: '3.3' }, L: { type: 'resistor', resistance: 330 } },
          [...wires, ['L:1', 'Z:CATHODE'], ['L:2', 'U:GND2']])
        kit.step(0.02)
        const v1 = kit.state('Z').vz
        kit.ok(v0 - v1 > 0.03 && v0 - v1 < 0.2, `load regulation ≈0.1 V (got ${(v0 - v1).toFixed(3)} V)`)
      },
    },
    {
      name: '1N4733A (5.1 V) does not break down on a 5 V rail; forward it drops ≈0.6 V',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 220 }, Z: 'zener_diode' },
          [['R:1', 'U:5V'], ['R:2', 'Z:ANODE'], ['Z:CATHODE', 'U:GND1']])
        kit.step(0.02)
        // Forward: I ≈ (5 − 0.62) / 220 ≈ 20 mA; V_F = Vt·ln(20 mA / 1 pA) + 20 mA · 0.5 Ω ≈ 0.61 + 0.01 V (datasheet ≤ 1.2 V at 200 mA).
        kit.between(-kit.state('Z').vz, 0.55, 0.85, 'forward voltage')
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 1000 }, Z: 'zener_diode' },
          [['R:1', 'U:5V'], ['R:2', 'Z:CATHODE'], ['Z:ANODE', 'U:GND1']])
        kit.step(0.02)
        // Reverse at 5 V, below V_Z = 5.1 V: it sits in the soft knee (model: ≈0.5 mA at ≈4.5 V), under I_ZK = 1 mA.
        kit.ok(kit.state('Z').current < 1e-3, `conducts less than I_ZK = 1 mA (got ${kit.state('Z').current})`)
        kit.ok(kit.state('Z').vz > 4.4, 'most of the supply stays across it')
      },
    },
    {
      name: 'warns over 1 W: a 3.3 V Zener across 5 V with no series resistor',
      run(kit) {
        kit.scene({ U: 'arduino', Z: { type: 'zener_diode', vz: '3.3' } }, [['Z:CATHODE', 'U:5V'], ['Z:ANODE', 'U:GND1']])
        kit.step(0.02)
        // Only the 5 V rail's 0.05 Ω and the Zener's own ≈10 Ω slope limit it:
        // 5 = 3.3 + 0.152·ln(I / 76 mA) + 8·(I − 76 mA) + 0.05·I  →  I ≈ 0.26 A,  P ≈ 5 V · 0.26 A ≈ 1.3 W > 1 W.
        kit.between(kit.state('Z').current, 0.2, 0.33, 'Zener current')
        kit.ok(kit.state('Z').power > 1, `power over 1 W (got ${kit.state('Z').power})`)
        kit.ok(kit.hasIssue('Z:power'), 'power issue raised')
      },
    },
  ],
})
