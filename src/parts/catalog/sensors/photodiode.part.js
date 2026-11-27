// BPW34-style silicon PIN photodiode (Tinkercad "Photodiode"). Vishay BPW34:
// 5.4 × 4.3 × 3.2 mm, 7.5 mm² sensitive area, leads 5.08 mm apart.
// Reverse light current Ira ≈ 75 µA at 1 klx (illuminant A, VR = 5 V) → 75 nA/lux;
// open-circuit voltage ≈ 350 mV at 1 klx; dark current ≈ 2 nA; VR max 60 V.
// Model: junction diode (Is set so Voc(1 klx) = 350 mV) + photocurrent source
// K → A + 2.5 GΩ leakage. Use it reverse-biased (K to +5 V, A to a load resistor).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { diode, isource, resistor } from '../../../circuit/mna.js'
import { mat, box, at, lead } from '../../model.js'

const HALF = 0.254, LEG = 0.40, W = 0.54, H = 0.43, D = 0.32
export const A_PER_LUX = 75e-9
const VT = 0.025852
// Is from Voc = Vt·ln(Iph/Is + 1) at 1 klx: Is = 75 µA / (e^(0.35/Vt) − 1).
export const IS = 75e-6 / (Math.exp(0.35 / VT) - 1)

export default definePart({
  type: 'photodiode',
  label: 'Photodiode (BPW34)',
  shortName: 'PD',
  tinkercad: 'Photodiode',
  category: 'sensors',
  icon: '◪',
  desc: 'BPW34 · 75 nA/lux reverse photocurrent',
  purpose: 'Makes a current proportional to the light on it. Reverse-bias it: cathode (K) to 5 V, anode (A) to A0 and a 10 kΩ resistor from A0 to GND — 1000 lux gives ≈75 µA, so ≈0.75 V on A0. Unbiased it makes up to ≈0.35 V by itself (photovoltaic). Set the light in the sim bar.',
  usage: 'fast light detection · light meters · IR remote / beam sensing',
  spec: { dims_mm: { w: 5.4, h: 8.3, d: 3.2 }, mass_kg: 0.0002, sensitivity_A_per_lux: A_PER_LUX, Voc_1klx: 0.35, darkCurrent_A: 2e-9, VRmax: 60,
    summary: 'Photocurrent ≈ 75 nA × lux (reverse bias). K is the cathode (marked lead).' },
  pins: [
    { name: 'A', kind: 'passive', label: 'A (anode)', x: -HALF, y: 0.02, z: 0, r: 0.06 },
    { name: 'K', kind: 'passive', label: 'K (cathode)', x: HALF, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    for (const s of [-1, 1]) g.add(lead([s * HALF, 0, 0], [s * HALF, LEG + 0.05, 0], { r: 0.025 }))
    g.add(box(W, H, D, mat(0xd8dde3, { rough: 0.2, opacity: 0.75 }), 0, LEG + H / 2, 0))   // clear epoxy
    const chip = box(0.265, 0.265, 0.01, mat(0x1b2a4a, { rough: 0.3, metal: 0.3 }), 0, LEG + H / 2 + 0.02, D / 2 + 0.002)
    chip.name = 'chip'
    g.add(chip)
    g.add(box(0.08, 0.06, D * 0.9, mat(0x333333), W / 2 - 0.06, LEG + 0.03, 0))              // cathode mark
    return g
  },
  sim: {
    controls: [{ key: 'lux', kind: 'slider', label: 'Light', min: 0, max: 10000, step: 1, unit: 'lux', default: 100 }],
    circuit(api) {
      const a = api.pin('A'), k = api.pin('K')
      return {
        d: api.add(diode(a, k, { Is: IS, n: 1 })),
        ph: api.add(isource(k, a, 0)),
        leak: api.add(resistor(a, k, 2.5e9)),
      }
    },
    beforeStep(h, api) { const l = api.control('lux'); h.ph.I = A_PER_LUX * Math.max(0, l == null ? 100 : Number(l)) },
    solved(h, api) {
      const vak = api.vpin('A') - api.vpin('K')
      const iDiode = api.cur(h.d)
      // External current INTO the anode can only come from a forward bias — the
      // photocurrent always leaves through the anode.
      const iOut = h.ph.I - iDiode - vak / 2.5e9
      if (iOut < -1e-4) api.issue('forward', 'warning', `${api.obj.name} is forward-biased`,
        'Current is flowing anode → cathode, so it acts as an ordinary diode and ignores light. Swap the legs: K (cathode) to the positive side.')
      else api.clearIssue('forward')
      if (-vak > 60) api.issue('breakdown', 'error', `${api.obj.name}: ${(-vak).toFixed(0)} V reverse`, 'The BPW34 is rated 60 V reverse.')
      else api.clearIssue('breakdown')
      // Photocurrent delivered to the outside (reverse direction, out of the anode).
      return { photocurrent: h.ph.I, current: iOut, vak }
    },
  },
  tests: [
    {
      name: 'reverse-biased into 10 kΩ: 1000 lux → 75 µA → 0.75 V (analogRead 153); dark → ≈0',
      run(kit) {
        kit.scene({ U: 'arduino', P: 'photodiode', R: { type: 'resistor', resistance: 10000 } },
          [['P:K', 'U:5V'], ['P:A', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.control('P', 'lux', 1000); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 0.75, 0.005, '75 µA × 10 kΩ'); kit.near(kit.analogRead(14), 153, 1)
        kit.control('P', 'lux', 0); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 0, 0.001, 'dark (≈2 nA × 10 kΩ = 20 µV)')
      },
    },
    {
      name: 'photovoltaic: unbiased into A0 alone it makes Voc ≈ 0.35 V at 1000 lux',
      run(kit) {
        kit.scene({ U: 'arduino', P: 'photodiode' }, [['P:A', 'U:A0'], ['P:K', 'U:GND1']])
        kit.control('P', 'lux', 1000); kit.step(0.05)
        // A0's 10 MΩ input draws 35 nA of 75 µA — negligible, so V ≈ Voc = 0.35 V.
        kit.near(kit.pinVoltage(14), 0.35, 0.01, 'Voc')
        kit.control('P', 'lux', 100); kit.step(0.05)
        // Voc falls by Vt·ln(10) = 59.5 mV per decade of light.
        kit.near(kit.pinVoltage(14), 0.35 - VT * Math.log(10), 0.01, 'Voc at 100 lux')
      },
    },
    {
      name: 'warns when wired backwards (forward-biased from 5 V through 1 kΩ)',
      run(kit) {
        kit.scene({ U: 'arduino', P: 'photodiode', R: { type: 'resistor', resistance: 1000 } },
          [['P:A', 'U:5V'], ['P:K', 'R:1'], ['R:2', 'U:GND1']])
        kit.step(0.05)
        kit.ok(kit.hasIssue('P:forward'), 'forward-bias warning')
      },
    },
  ],
})
