// LM7805 fixed +5 V linear regulator (Tinkercad "Voltage Regulator LM7805"),
// TO-220: 1 IN · 2 GND (tab) · 3 OUT (TI LM340/LM7805 datasheet).
//
// Pass element in the solver, from IN to OUT:
//   regulating   V(OUT) = V(GND) + 5.00 V, output resistance 5 mΩ
//                (load regulation ≈ 4–10 mV over 5 mA … 1.5 A)
//   dropout      V(OUT) = V(IN) − 2.0 V when IN < 7 V
//   current lim  1.5 A (the internal limiter; peak ≈ 2.2 A on some makers' parts)
//   one-way      the pass transistor cannot sink: if OUT is pulled above 5 V it turns off
//   quiescent    ≈5 mA IN → GND (datasheet 5 mA typ, 8 mA max), as 1.8 kΩ (5 mA at 9 V)
// Issues: input too low (dropout), over-current, over-voltage (> 35 V), heat
// (TO-220 without heatsink ≈ 65 °C/W → > 2 W is too hot).
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { regulatorPass } from './regpass.js'
import { to220Build, to220Pins, TO220_DIMS } from './to220.js'
import { benchSupply } from './bench.js'

const VOUT = 5.0, VDROP = 2.0, ILIM = 1.5

export default definePart({
  type: 'regulator_lm7805',
  label: 'Voltage Regulator LM7805',
  shortName: '7805',
  tinkercad: 'Voltage Regulator LM7805',
  category: 'ics',
  icon: '⏚',
  desc: '+5 V linear regulator · TO-220 · 1.5 A · IN 7–35 V',
  purpose: 'Makes a steady 5 V from a higher supply (a 9 V battery, 12 V adapter). Facing the printed side: IN (left) – GND (middle) – OUT (right). ' +
    'It needs at least 7 V in (2 V dropout). Everything above 5 V is burnt as heat: P = (Vin − 5 V)·I, so keep it under ≈2 W without a heatsink.',
  usage: 'powering 5 V logic from 9–12 V · battery robots',
  spec: {
    dims_mm: TO220_DIMS, mass_kg: 0.002, vout: 5.0, vin: '7–35 V', dropout_V: 2.0, ilim_A: 1.5, iq_mA: 5,
    summary: '5.00 V ±4 %, dropout 2 V, current limit ≈1.5 A, quiescent 5 mA. Thermal: ≈65 °C/W without a heatsink.',
  },
  pins: to220Pins(['IN', 'GND', 'OUT'], { IN: 'power', GND: 'gnd', OUT: 'power' }),
  groundPin: 'GND',
  build: () => to220Build('LM7805'),
  sim: {
    circuit(api) {
      const nin = api.pin('IN'), gnd = api.pin('GND'), out = api.pin('OUT')
      api.add(resistor(nin, gnd, 1800))
      return { p: api.add(regulatorPass({ nin, out, ref: gnd, vRef: VOUT, vDrop: VDROP, iLim: ILIM })) }
    },
    solved(h, api) {
      const name = api.obj.name || 'LM7805'
      const g = api.vpin('GND'), vin = api.vpin('IN') - g, vout = api.vpin('OUT') - g
      const I = h.p.I, P = Math.max(0, (vin - vout) * I)
      if (vin > 35) api.issue('overvoltage', 'error', `${name} has ${vin.toFixed(1)} V at IN`, 'The LM7805 is rated for 35 V input maximum.')
      else api.clearIssue('overvoltage')
      if (h.p.mode === 'dropout' && vin > 0.5) api.issue('dropout', 'warning', `${name}: input ${vin.toFixed(2)} V is too low`,
        `A 7805 needs ≥ 7 V in (2 V dropout); the output has fallen to ${vout.toFixed(2)} V.`)
      else api.clearIssue('dropout')
      if (h.p.mode === 'limit') api.issue('overcurrent', 'error', `${name} is current-limiting at ${ILIM} A`,
        `The load wants more than ${ILIM} A, so the output collapsed to ${vout.toFixed(2)} V. Check for a short or a too-small load resistance.`)
      else api.clearIssue('overcurrent')
      if (P > 2) api.issue('heat', 'warning', `${name} dissipates ${P.toFixed(1)} W`, `≈${Math.round(25 + 65 * P)} °C without a heatsink: it will shut down. Lower the input voltage or add a heatsink.`)
      else api.clearIssue('heat')
      return { vin, vout, current: I, power: P, mode: h.p.mode }
    },
    readout: ({ solved }) => (solved ? `${solved.vout.toFixed(2)} V · ${(solved.current * 1000).toFixed(0)} mA` : ''),
  },
  tests: [
    {
      name: '9 V in, 100 Ω load → 5.00 V out, 50 mA, ≈55 mA from the input',
      run(kit) {
        kit.scene({ U: 'arduino', REG: 'regulator_lm7805', RL: { type: 'resistor', resistance: 100 } },
          [['REG:GND', 'U:GND1'], ['REG:OUT', 'RL:1'], ['RL:2', 'U:GND2']])
        const src = benchSupply(kit, 'REG:IN', 9)
        kit.step(0.05)
        kit.near(kit.vpin('REG', 'OUT'), 5.0, 0.01, 'Vout')
        kit.near(kit.state('RL').current, 0.05, 0.0005, 'load current')
        // Input current = 50 mA load + 9 V / 1.8 kΩ = 5 mA quiescent
        kit.near(kit.bridge.sim.circuit.voltageOf(kit.bridge.sim.nodeOf('REG:IN')), 9 - 0.055 * 0.05, 0.002, 'bench supply sag')
        kit.ok(!kit.hasIssue('REG:'), 'no issues; P = 4 V · 50 mA = 0.2 W')
        void src
      },
    },
    {
      name: 'input below 7 V drops out: 6 V in → ≈4.0 V out and a warning',
      run(kit) {
        kit.scene({ U: 'arduino', REG: 'regulator_lm7805', RL: { type: 'resistor', resistance: 100 } },
          [['REG:GND', 'U:GND1'], ['REG:OUT', 'RL:1'], ['RL:2', 'U:GND2']])
        benchSupply(kit, 'REG:IN', 6)
        kit.step(0.05)
        kit.near(kit.vpin('REG', 'OUT'), 4.0, 0.02, 'Vout = Vin − 2 V')
        kit.ok(kit.hasIssue('REG:dropout'), 'dropout warning')
      },
    },
    {
      name: 'a 1 Ω load hits the 1.5 A current limit (Vout = 1.5 V) and overheats',
      run(kit) {
        kit.scene({ U: 'arduino', REG: 'regulator_lm7805', RL: { type: 'resistor', resistance: 1 } },
          [['REG:GND', 'U:GND1'], ['REG:OUT', 'RL:1'], ['RL:2', 'U:GND2']])
        benchSupply(kit, 'REG:IN', 9)
        kit.step(0.05)
        kit.near(kit.vpin('REG', 'OUT'), 1.5, 0.01, 'Vout = 1.5 A · 1 Ω')
        kit.ok(kit.hasIssue('REG:overcurrent'), 'over-current issue')
        // Bench supply sags 50 mΩ · 1.505 A → Vin = 8.925 V; P = (8.925 − 1.5) V · 1.5 A = 11.14 W
        kit.near(kit.state('REG').power, 11.14, 0.03, 'dissipation')
        kit.ok(kit.hasIssue('REG:heat'), 'heat warning')
      },
    },
  ],
})
