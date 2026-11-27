// CR2032 lithium coin cell (Ø20 × 3.2 mm, IEC CR2032) in a through-hole holder
// with two tinned legs at 0.6" (15.24 mm) — fits straight into a breadboard
// (Tinkercad "Coin Cell 3V Battery").
//
// Li/MnO2, 3.0 V nominal, ≈225 mAh. Its internal resistance is HIGH: the 1 kHz
// ohmic part is ≈10–20 Ω fresh, and under a sustained mA-level load the cell's
// polarisation adds roughly as much again (TI app note SWRA349 "Coin cells and
// peak current draw"). We lump both into one DC resistance of 40 Ω
// (≈15 Ω ohmic + ≈25 Ω polarisation). That is why the classic "LED throwie"
// — a red LED straight across the cell, no resistor — works: the cell itself
// limits the current to ≈25 mA, and a dead short only draws 3 / 40 = 75 mA.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, box, cyl, at, lead, textPlane, TIN } from '../../model.js'
import { batterySim, batteryReadout } from './battery.js'

const V = 3.0, R_INT = 40, I_MAX = 0.03
const LEG_X = 0.762                       // 0.6" leg spacing
const LEG_H = 0.3, BASE_H = 0.35, COIN_T = 0.32, COIN_R = 1.0

export default definePart({
  type: 'battery_coin_cr2032',
  label: 'Coin Cell 3V Battery',
  shortName: 'CR2032',
  tinkercad: 'Coin Cell 3V Battery',
  category: 'power',
  icon: '🪙',
  desc: 'CR2032 lithium · 3 V · ≈40 Ω under load',
  purpose: 'A small 3 V lithium cell in a holder with two legs. Its high internal resistance (≈40 Ω under load) limits the current by itself, so an LED placed straight across it lights without burning out — the "LED throwie". It cannot run motors or an Arduino.',
  usage: 'LED throwies · low-power sensors · RTC backup',
  spec: {
    dims_mm: { w: 25, h: 10.2, d: 21 }, mass_kg: 0.005,
    chemistry: 'Li/MnO2', emf_V: V, rInt_ohm: R_INT, capacity_mAh: 225, cell_mm: { dia: 20, thick: 3.2 },
    summary: '3 V EMF behind ≈40 Ω (ohmic + polarisation). Short-circuit current only ≈75 mA.',
  },
  groundPin: 'NEG',
  pins: [
    { name: 'POS', kind: 'power', label: '+', x: LEG_X, y: 0.02, z: 0, r: 0.08 },
    { name: 'NEG', kind: 'gnd', label: '−', x: -LEG_X, y: 0.02, z: 0, r: 0.08, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    const top = LEG_H + BASE_H
    // Black moulded holder base with a round recess wall.
    g.add(box(2.5, BASE_H, 2.1, mat(0x1d1d1d, { rough: 0.8 }), 0, LEG_H + BASE_H / 2, 0))
    g.add(at(cyl(1.05, 0.12, mat(0x262626, { rough: 0.8 }), { seg: 32 }), 0, top + 0.06, 0))
    // The coin: stainless + face up, with the engraved rim.
    const coin = cyl(COIN_R, COIN_T, mat(0xc7ccd1, { metal: 0.9, rough: 0.25 }), { seg: 40 })
    g.add(at(coin, 0, top + COIN_T / 2, 0))
    g.add(at(cyl(COIN_R * 0.86, 0.01, mat(0xb4b9be, { metal: 0.9, rough: 0.35 }), { seg: 40 }), 0, top + COIN_T + 0.005, 0))
    // Spring-steel + clip over the coin (contacts the top face) down to the + leg.
    g.add(box(0.9, 0.04, 0.7, TIN(), 0.6, top + COIN_T + 0.03, 0))
    g.add(box(0.06, COIN_T + 0.1, 0.7, TIN(), 1.05, top + COIN_T / 2, 0))
    // Legs down to y = 0.
    for (const s of [-1, 1]) g.add(lead([s * LEG_X, LEG_H + 0.05, 0], [s * LEG_X, 0, 0], { r: 0.03 }))
    const t = textPlane('CR2032 3V', 1.5, 0.35, { fg: '#4b5563', bg: null })
    if (t) { t.rotation.x = -Math.PI / 2; g.add(at(t, 0, top + COIN_T + 0.012, 0.35)) }
    return g
  },
  sim: { ...batterySim({ V, rInt: R_INT, iMax: I_MAX, what: 'CR2032 coin cell' }), readout: batteryReadout },
  tests: [
    {
      name: 'LED throwie: a red LED straight across the cell draws ≈26 mA and does not burn out',
      run(kit) {
        kit.scene({ C: 'battery_coin_cr2032', L: 'led' }, [['C:POS', 'L:ANODE'], ['L:CATHODE', 'C:NEG']])
        kit.step(0.05)
        // Hand calc: 3 − 40·I = Vled(I). Red LED ≈1.95 V at 26 mA (1.74 V knee
        // + 2·Vt·ln(I/20 mA) + 8 Ω·I) → I = (3 − 1.95) / 40 ≈ 26 mA.
        kit.between(kit.state('L').current, 0.024, 0.028, 'LED current')
        kit.between(kit.state('C').voltage, 1.85, 2.05, 'cell terminal voltage sags to the LED voltage')
        kit.ok(!kit.hasIssue('L:overcurrent'), 'the LED is not over-driven')
        kit.ok(!kit.hasIssue('C:short') && !kit.hasIssue('C:overload'), 'no battery issue')
      },
    },
    {
      name: 'a short circuit only draws 3 / 40 = 75 mA (still flagged)',
      run(kit) {
        kit.scene({ C: 'battery_coin_cr2032' }, [['C:POS', 'C:NEG']])
        kit.step(0.05)
        kit.near(kit.state('C').current, 0.075, 1e-4, 'short-circuit current')
        kit.ok(kit.hasIssue('C:short'), 'short-circuit issue')
      },
    },
    {
      name: '10 kΩ load: 3·10000/10040 = 2.988 V',
      run(kit) {
        kit.scene({ C: 'battery_coin_cr2032', R: { type: 'resistor', resistance: 10000 } }, [['C:POS', 'R:1'], ['R:2', 'C:NEG']])
        kit.step(0.05)
        kit.near(kit.state('R').voltage, 3 * 10000 / 10040, 1e-3)
      },
    },
  ],
})
