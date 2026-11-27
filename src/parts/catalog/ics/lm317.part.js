// LM317 adjustable positive regulator (Tinkercad "Voltage Regulator LM317"),
// TO-220: 1 ADJ · 2 OUT (tab) · 3 IN (TI LM317 datasheet SLVS044).
//
// The pass element keeps V(OUT) − V(ADJ) = VREF = 1.25 V, so with R1 (OUT→ADJ)
// and R2 (ADJ→GND):   Vout = 1.25 V · (1 + R2/R1) + IADJ · R2,   IADJ = 50 µA
// (flows out of ADJ, supplied from IN). Dropout ≈1.5 V (datasheet 1.5–2.5 V
// depending on current), current limit 2.2 A typ (1.5 A minimum), and it needs
// ≥ 3.5 mA (typ; 10 mA max) of load to stay in regulation — R1 = 240 Ω gives 5.2 mA.
import { definePart } from '../../definePart.js'
import { isource } from '../../../circuit/mna.js'
import { regulatorPass } from './regpass.js'
import { to220Build, to220Pins, TO220_DIMS } from './to220.js'
import { benchSupply } from './bench.js'

const VREF = 1.25, IADJ = 50e-6, VDROP = 1.5, ILIM = 2.2, IMIN = 0.0035

export default definePart({
  type: 'regulator_lm317',
  label: 'Voltage Regulator LM317',
  shortName: 'LM317',
  tinkercad: 'Voltage Regulator LM317',
  category: 'ics',
  icon: '⏚',
  desc: 'Adjustable regulator 1.25–37 V · TO-220 · 1.5 A',
  purpose: 'Any output voltage from two resistors. Facing the print: ADJ (left) – OUT (middle) – IN (right). ' +
    'R1 = 240 Ω from OUT to ADJ, R2 from ADJ to GND: Vout = 1.25 V × (1 + R2/R1). 720 Ω gives 5 V, 1.5 kΩ ≈ 9 V. ' +
    'Feed IN at least 1.5–2 V above the output you want.',
  usage: 'adjustable bench supplies · odd voltages (3.3 V, 9 V, 12 V) · constant-current LED drivers (R between OUT and ADJ)',
  spec: {
    dims_mm: TO220_DIMS, mass_kg: 0.002, vref: 1.25, iadj_uA: 50, dropout_V: 1.5, ilim_A: 2.2, vin_vout_max: 40,
    summary: 'Vout = 1.25·(1 + R2/R1) + 50 µA·R2. Dropout ≈1.5 V, current limit 1.5 A min / 2.2 A typ, minimum load 3.5 mA.',
  },
  pins: to220Pins(['ADJ', 'OUT', 'IN'], { ADJ: 'analog', OUT: 'power', IN: 'power' }),
  build: () => to220Build('LM317'),
  sim: {
    circuit(api) {
      const nin = api.pin('IN'), adj = api.pin('ADJ'), out = api.pin('OUT')
      api.add(isource(nin, adj, IADJ))
      return { p: api.add(regulatorPass({ nin, out, ref: adj, vRef: VREF, vDrop: VDROP, iLim: ILIM })) }
    },
    solved(h, api) {
      const name = api.obj.name || 'LM317'
      const vin = api.vpin('IN'), vout = api.vpin('OUT'), I = h.p.I
      if (vin - vout > 40) api.issue('overvoltage', 'error', `${name}: ${(vin - vout).toFixed(1)} V between IN and OUT`, 'The LM317 allows 40 V input-to-output at most.')
      else api.clearIssue('overvoltage')
      if (h.p.mode === 'dropout' && vin > 0.5) api.issue('dropout', 'warning', `${name}: input ${vin.toFixed(2)} V is too low`,
        `IN must be ≈1.5 V above the set output; the output fell to ${vout.toFixed(2)} V.`)
      else api.clearIssue('dropout')
      if (h.p.mode === 'limit') api.issue('overcurrent', 'error', `${name} is current-limiting at ${ILIM} A`, 'The load draws more than the regulator can supply — check for a short.')
      else api.clearIssue('overcurrent')
      if (h.p.mode === 'reg' && I < IMIN) api.issue('minload', 'warning', `${name} load is only ${(I * 1000).toFixed(1)} mA`,
        'The LM317 needs 3.5–10 mA of load to regulate; keep R1 at 240 Ω (or less).')
      else api.clearIssue('minload')
      const P = Math.max(0, (vin - vout) * I)
      if (P > 2) api.issue('heat', 'warning', `${name} dissipates ${P.toFixed(1)} W`, 'A TO-220 without a heatsink gets too hot above ≈2 W.')
      else api.clearIssue('heat')
      return { vin, vout, vadj: api.vpin('ADJ'), current: I, power: P, mode: h.p.mode }
    },
    readout: ({ solved }) => (solved ? `${solved.vout.toFixed(2)} V · ${(solved.current * 1000).toFixed(0)} mA` : ''),
  },
  tests: [
    {
      name: 'R1 = 240 Ω, R2 = 720 Ω, 9 V in → 1.25·(1 + 720/240) + 50 µA·720 = 5.036 V',
      run(kit) {
        kit.scene({ U: 'arduino', REG: 'regulator_lm317', R1: { type: 'resistor', resistance: 240 }, R2: { type: 'resistor', resistance: 720 } },
          [['REG:OUT', 'R1:1'], ['R1:2', 'REG:ADJ'], ['R2:1', 'REG:ADJ'], ['R2:2', 'U:GND1']])
        benchSupply(kit, 'REG:IN', 9)
        kit.step(0.05)
        kit.near(kit.vpin('REG', 'OUT'), 5.036, 0.01, 'Vout')
        kit.near(kit.vpin('REG', 'OUT') - kit.vpin('REG', 'ADJ'), 1.25, 0.002, 'VREF across R1')
        kit.near(kit.state('R2').current, 1.25 / 240 + 50e-6, 2e-6, 'R2 carries R1 current + IADJ')
        kit.ok(!kit.hasIssue('REG:'), 'no issues (5.2 mA ≥ minimum load)')
      },
    },
    {
      name: 'holds 5.04 V with a 50 Ω (100 mA) extra load; drops out at 6 V in → 4.5 V',
      run(kit) {
        const wires = [['REG:OUT', 'R1:1'], ['R1:2', 'REG:ADJ'], ['R2:1', 'REG:ADJ'], ['R2:2', 'U:GND1'], ['REG:OUT', 'RL:1'], ['RL:2', 'U:GND2']]
        const spec = { U: 'arduino', REG: 'regulator_lm317', R1: { type: 'resistor', resistance: 240 }, R2: { type: 'resistor', resistance: 720 }, RL: { type: 'resistor', resistance: 50 } }
        kit.scene(spec, wires)
        benchSupply(kit, 'REG:IN', 9)
        kit.step(0.05)
        kit.near(kit.vpin('REG', 'OUT'), 5.036, 0.01, 'loaded Vout')
        kit.scene(spec, wires)
        benchSupply(kit, 'REG:IN', 6)
        kit.step(0.05)
        kit.near(kit.vpin('REG', 'OUT'), 4.5, 0.02, 'dropout: Vin − 1.5 V')
        kit.ok(kit.hasIssue('REG:dropout'), 'dropout warning')
      },
    },
  ],
})
