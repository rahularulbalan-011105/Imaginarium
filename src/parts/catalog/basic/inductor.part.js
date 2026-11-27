// Radial drum-core inductor (Tinkercad "Inductor"), default 1 mH.
// Modelled on the Bourns RLB0912 radial family: ferrite drum Ø8.5 × 10 mm,
// enamelled copper winding visible between the flanges, leads 5.0 mm apart.
// RLB0912-102K: 1 mH ±10 %, DCR ≈ 2.2 Ω, rated current ≈ 0.2 A.
// Circuit model: DCR in series with an ideal L (short in DC, backward-Euler
// companion in transient).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { inductor, resistor } from '../../../circuit/mna.js'
import { mat, cyl, at, lead, fmtSI } from '../../model.js'

const HALF = 0.25, LIFT = 0.05, FL_R = 0.425, FL_T = 0.12, CORE_H = 1.0

export default definePart({
  type: 'inductor',
  label: 'Inductor',
  shortName: 'L',
  tinkercad: 'Inductor',
  category: 'basic',
  icon: '∿',
  desc: 'Radial drum core · 1 mH · 0.2 A',
  purpose: 'A coil that resists changes of current: in steady DC it is just its wire resistance, but switching it on the current ramps up with τ = L/R, and switching it off makes a voltage spike (always give a coil a flyback diode). Used in filters and switch-mode supplies.',
  usage: 'LC filters · supply chokes · learning about τ = L/R',
  spec: {
    dims_mm: { w: 8.5, h: 10.5, d: 8.5 }, mass_kg: 0.002, dcr_ohm: 2.2, irated_A: 0.2,
    summary: 'Inductor: V = L·di/dt. In steady DC only its winding resistance (DCR) remains.',
  },
  props: {
    inductance: { type: 'number', label: 'Inductance', unit: 'mH', default: 1, min: 0.001, max: 1000 },
    dcr: { type: 'number', label: 'Winding resistance', unit: 'Ω', default: 2.2, min: 0.001, max: 1000 },
    ratedCurrent: { type: 'number', label: 'Rated current', unit: 'A', default: 0.2, min: 0.001, max: 30 },
  },
  pins: [
    { name: '1', kind: 'passive', x: -HALF, y: 0.02, z: 0, r: 0.06, label: '1' },
    { name: '2', kind: 'passive', x: HALF, y: 0.02, z: 0, r: 0.06, label: '2', ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    const ferrite = mat(0x2b2b2e, { rough: 0.85 })
    g.add(at(cyl(FL_R, FL_T, ferrite, { seg: 32 }), 0, LIFT + FL_T / 2, 0))                       // bottom flange
    g.add(at(cyl(FL_R, FL_T, ferrite, { seg: 32 }), 0, LIFT + CORE_H - FL_T / 2, 0))              // top flange
    g.add(at(cyl(0.2, CORE_H - 2 * FL_T, ferrite), 0, LIFT + CORE_H / 2, 0))                      // drum
    const copper = mat(0xb8662d, { metal: 0.7, rough: 0.35 })
    const winding = cyl(0.37, CORE_H - 2 * FL_T - 0.01, copper, { seg: 40 })
    winding.name = 'winding'
    g.add(at(winding, 0, LIFT + CORE_H / 2, 0))
    // Turns ridges, so it reads as wound wire.
    for (let i = 0; i < 9; i++) g.add(at(cyl(0.375, 0.035, copper, { seg: 40 }), 0, LIFT + FL_T + 0.05 + i * 0.075, 0))
    for (const s of [-1, 1]) g.add(lead([s * HALF, LIFT + 0.02, 0], [s * HALF, 0, 0], { r: 0.03 }))
    return g
  },
  sim: {
    transient: true,
    circuit(api) {
      const m = api.node()
      api.add(resistor(api.pin('1'), m, api.prop('dcr')))
      const l = api.add(inductor(m, api.pin('2'), api.prop('inductance') * 1e-3))
      return { l }
    },
    solved(h, api) {
      const i = api.cur(h.l), v = api.vpin('1') - api.vpin('2')
      const ir = api.prop('ratedCurrent')
      if (Math.abs(i) > ir) api.issue('overcurrent', 'warning', `${api.obj.name || 'Inductor'} carries ${fmtSI(Math.abs(i), 'A')}`,
        `It is rated ${fmtSI(ir, 'A')}: above that the core saturates (the inductance collapses) and the winding overheats.`)
      else api.clearIssue('overcurrent')
      return { current: i, voltage: v, energy: 0.5 * api.prop('inductance') * 1e-3 * i * i }
    },
    readout({ solved }) { return solved ? fmtSI(solved.current, 'A') : '' },
  },
  tests: [
    {
      name: 'steady DC: only the winding resistance limits current (5 V → 220 Ω → 1 mH)',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 220 }, L: 'inductor' },
          [['U:D13', 'R:1'], ['R:2', 'L:1'], ['L:2', 'U:GND1']])
        kit.pinMode(13, 'output'); kit.write(13, 1); kit.step(0.05)
        // I = 5 / (25 + 220 + 2.2 Ω) = 20.2 mA; V_L = I·DCR = 44 mV.
        kit.near(kit.state('L').current, 5 / 247.2, 0.1e-3, 'current')
        kit.near(kit.state('L').voltage, 5 / 247.2 * 2.2, 0.005, 'voltage = I·DCR')
      },
    },
    {
      name: 'current ramps with τ = L/R (100 mH, 100 Ω: τ ≈ 0.8 ms)',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 100 }, L: { type: 'inductor', inductance: 100, dcr: 2.2 } },
          [['U:D13', 'R:1'], ['R:2', 'L:1'], ['L:2', 'U:GND1']])
        kit.pinMode(13, 'output'); kit.write(13, 1)
        kit.step(0.0008)
        // R = 25 + 100 + 2.2 = 127.2 Ω, I∞ = 39.3 mA, τ = 0.1 H / 127.2 Ω = 0.786 ms.
        // i(0.8 ms) = I∞·(1 − e^(−0.8/0.786)) = 0.639·I∞ = 25.1 mA (backward Euler at 0.1 ms steps: 24.3 mA).
        const iInf = 5 / 127.2
        kit.near(kit.state('L').current, iInf * (1 - Math.exp(-0.8 / 0.786)), 0.08 * iInf, 'current after ≈1 τ')
        kit.step(0.02)
        kit.near(kit.state('L').current, iInf, 0.2e-3, 'settled at V/R')
      },
    },
    {
      name: 'warns above the rated current (straight across 5 V: 5 / 2.2 Ω ≈ 2.2 A)',
      run(kit) {
        kit.scene({ U: 'arduino', L: 'inductor' }, [['L:1', 'U:5V'], ['L:2', 'U:GND1']])
        kit.step(0.05)
        kit.near(kit.state('L').current, 5 / 2.25, 0.05, 'current limited only by DCR + rail')
        kit.ok(kit.hasIssue('L:overcurrent'), 'over-current warning')
      },
    },
  ],
})
