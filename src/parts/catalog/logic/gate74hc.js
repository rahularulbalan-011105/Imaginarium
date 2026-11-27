// ─────────────────────────────────────────────────────────────────────────────
// 74HC gate family factory (NOT a part file). Each 74HC00/02/04/08/32/86 file
// calls makeGatePart() with its real DIP-14 pinout and its boolean function.
//
// Electrical model (NXP / TI 74HC datasheets, VCC = 4.5 V, 25 °C typical):
//   inputs   CMOS: LOW ≤ 0.3·VCC, HIGH ≥ 0.7·VCC, hysteresis band holds the last
//            level; input current ≈ 0 (±1 µA max) — read from the SOLVED voltage
//   outputs  push-pull from the chip's own VCC / GND pins:
//            VOH = 4.32 V typ at −4 mA → Ron(high) ≈ (4.5 − 4.32)/4 mA = 45 Ω
//            VOL = 0.15 V typ at  4 mA → Ron(low)  ≈ 0.15/4 mA        ≈ 37 Ω
//   supply   2 … 6 V operating, 7 V absolute maximum; ±25 mA per output and
//            ±50 mA through VCC/GND absolute maximum.
// The gates are evaluated inside the Newton loop (cmos.js logicBlock), so a
// gate feeding another gate settles within a single solve.
// ─────────────────────────────────────────────────────────────────────────────
import { definePart } from '../../definePart.js'
import { dipPins } from '../../model.js'
import { HC, logicBlock, dipBuild, dipDims } from './cmos.js'

export const HC_STAGE = { ronHi: 45, ronLo: 37 }

/**
 * @param {object} o
 * @param {string} o.type  @param {string} o.chip  e.g. '74HC00'
 * @param {string} o.label @param {string} o.tinkercad @param {string} o.fnName 'NAND'
 * @param {string[]} o.names       14 pin names, names[i] = pin i+1
 * @param {string[][]} o.gates     [[in1, in2?, out], …]
 * @param {(...bits:number[]) => number} o.fn
 */
export function makeGatePart({ type, chip, label, tinkercad, fnName, names, gates, fn, desc, extraTests = [] }) {
  const nIn = gates[0].length - 1
  const kinds = Object.fromEntries(names.map(n => [n, n === 'VCC' ? 'power' : n === 'GND' ? 'gnd' : 'digital']))
  const truth = nIn === 1 ? '0→' + fn(0) + ', 1→' + fn(1)
    : [[0, 0], [0, 1], [1, 0], [1, 1]].map(([a, b]) => `${a}${b}→${fn(a, b)}`).join(' ')

  return definePart({
    type, label, tinkercad, category: 'ics', shortName: chip, icon: '▦',
    desc: desc ?? `${gates.length}× ${nIn}-input ${fnName} · DIP-14 · 2–6 V CMOS`,
    purpose: `${chip}: ${gates.length} independent ${fnName} gates in one DIP-14. Pin 14 = VCC (2–6 V, use the Arduino 5V), pin 7 = GND. ` +
      `Inputs switch at 30 % / 70 % of VCC; every output drives its pin from the chip's own supply (≈45 Ω), so it can light an LED through 220 Ω ` +
      `or feed another gate's input. Tie unused inputs to VCC or GND. Truth table: ${truth}.`,
    usage: 'logic experiments · combining sensor signals · building XOR / latches from gates',
    spec: {
      dims_mm: dipDims(14), mass_kg: 0.001, vcc: '2–6 V (7 V abs. max)', ioh_mA: 4, io_abs_mA: 25,
      summary: `CMOS ${fnName}, tpd ≈ 8 ns at 5 V. VIL 0.3·VCC, VIH 0.7·VCC, VOH 4.32 V / VOL 0.15 V at 4 mA (VCC 4.5 V).`,
    },
    pins: dipPins(names, { kinds }),
    groundPin: 'GND',
    build: () => dipBuild(14, chip),
    sim: {
      circuit(api) {
        const vcc = api.pin('VCC'), gnd = api.pin('GND')
        const els = gates.map(g => api.add(logicBlock({
          ins: g.slice(0, -1).map(n => api.pin(n)), outs: [api.pin(g[g.length - 1])], vcc, gnd,
          stage: HC_STAGE, compute: (lv) => [fn(...lv)],
        })))
        return { els }
      },
      solved(h, api) {
        const vs = api.vpin('VCC') - api.vpin('GND')
        const anySignal = gates.some(g => g.some(n => api.connected(n)))
        if (anySignal && vs < HC.VCC_MIN) api.issue('unpowered', 'warning', `${api.obj.name || chip} has no supply`,
          `Wire pin 14 (VCC) to 5V and pin 7 (GND) to GND. A ${chip} needs 2–6 V; without it every output is dead (high-impedance).`)
        else api.clearIssue('unpowered')
        if (vs > HC.VCC_ABS) api.issue('overvoltage', 'error', `${api.obj.name || chip} has ${vs.toFixed(1)} V on VCC`,
          `74HC logic is rated 2–6 V (7 V absolute maximum). It would be destroyed — power it from 5 V.`)
        else api.clearIssue('overvoltage')
        // Floating CMOS inputs on a gate that is in use.
        const floating = []
        for (const g of gates) {
          if (!g.some(n => api.connected(n))) continue
          for (const n of g.slice(0, -1)) if (!api.connected(n)) floating.push(n)
        }
        if (floating.length) api.issue('floating', 'warning', `${api.obj.name || chip}: input ${floating.join(', ')} is not connected`,
          'A floating CMOS input picks up noise and can read HIGH or LOW at random (and makes the gate draw extra current). Tie it to VCC or GND.')
        else api.clearIssue('floating')
        const v = (n) => api.v(n)
        let iTot = 0, worst = 0
        const outputs = {}
        h.els.forEach((el, i) => {
          const name = gates[i][gates[i].length - 1]
          const I = el.outCurrent(0, v)
          iTot += Math.abs(I); worst = Math.max(worst, Math.abs(I))
          outputs[name] = el.state.q[0]
        })
        if (worst > HC.IO_ABS) api.issue('overcurrent', 'error', `${api.obj.name || chip} output carries ${(worst * 1000).toFixed(0)} mA`,
          'A 74HC output is rated ±25 mA absolute maximum (4 mA for the guaranteed levels). Add a series resistor (≥ 220 Ω for an LED).')
        else api.clearIssue('overcurrent')
        if (iTot > HC.ICC_ABS) api.issue('supply', 'warning', `${api.obj.name || chip} supplies ${(iTot * 1000).toFixed(0)} mA in total`,
          'VCC/GND of a 74HC chip are rated ±50 mA absolute maximum.')
        else api.clearIssue('supply')
        return { powered: vs >= HC.VCC_MIN, vcc: vs, outputs, current: iTot }
      },
      readout: ({ solved }) => (solved ? (solved.powered ? Object.entries(solved.outputs).map(([k, q]) => `${k}=${q ?? 'Z'}`).join(' ') : 'no VCC') : ''),
    },
    tests: [...gateTests({ type, chip, names, gates, fn, nIn }), ...extraTests],
  })
}

// ── scenarios shared by every gate chip ─────────────────────────────────────
function gateTests({ type, chip, gates, fn, nIn }) {
  const power = [['X:VCC', 'U:5V'], ['X:GND', 'U:GND1']]
  const combos = nIn === 1 ? [[0], [1]] : [[0, 0], [0, 1], [1, 0], [1, 1]]
  return [
    {
      name: `truth table of all ${gates.length} gates (inputs from pins, outputs read back on pins)`,
      run(kit) {
        // Each gate's inputs and output on their own Uno pins: D2… in order.
        let pin = 2
        const map = gates.map(g => ({ ins: g.slice(0, -1).map(() => pin++), out: pin++ }))
        const wires = [...power]
        gates.forEach((g, i) => {
          g.slice(0, -1).forEach((n, k) => wires.push([`X:${n}`, `U:D${map[i].ins[k]}`]))
          wires.push([`X:${g[g.length - 1]}`, `U:D${map[i].out}`])
        })
        kit.scene({ U: 'arduino', X: type }, wires)
        for (const m of map) { m.ins.forEach(p => kit.pinMode(p, 'output')); kit.pinMode(m.out, 'input') }
        for (const c of combos) {
          for (const m of map) m.ins.forEach((p, k) => kit.write(p, c[k]))
          kit.step(1 / 60)
          gates.forEach((g, i) => {
            const want = fn(...c)
            kit.equal(kit.digitalRead(map[i].out), want, `${chip} ${g[g.length - 1]} for inputs ${c.join('')}`)
            // Unloaded CMOS output sits at the rail: 5 V or 0 V.
            kit.near(kit.pinVoltage(map[i].out), want ? 5 : 0, 0.05, `${g[g.length - 1]} voltage`)
          })
        }
        kit.ok(!kit.hasIssue('X:floating'), 'no floating-input warning when every input is wired')
      },
    },
    {
      name: 'an output lights an LED through 220 Ω (≈11 mA, VOH ≈ 4.5 V)',
      run(kit) {
        const g = gates[0], out = g[g.length - 1]
        // Inputs chosen so the output is HIGH.
        const highIn = combos.find(c => fn(...c) === 1)
        const wires = [...power, [`X:${out}`, 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2']]
        g.slice(0, -1).forEach((n, k) => wires.push([`X:${n}`, highIn[k] ? 'U:5V' : 'U:GND3']))
        kit.scene({ U: 'arduino', X: type, R: { type: 'resistor', resistance: 220 }, L: 'led' }, wires)
        kit.step(0.05)
        // I = (5 − ≈1.9 V red LED) / (220 Ω + 45 Ω Ron + 8 Ω LED Rs) ≈ 11 mA → Vout = 5 − 11 mA·45 Ω ≈ 4.5 V.
        kit.between(kit.state('R').current, 0.009, 0.0125, 'LED current')
        kit.between(kit.vpin('X', out), 4.4, 4.65, 'loaded VOH')
        kit.between(kit.led.L, 100, 170, 'LED brightness')
      },
    },
    {
      name: 'one gate drives the next gate (output → input chain)',
      run(kit) {
        const [g1, g2] = gates
        const o1 = g1[g1.length - 1], o2 = g2[g2.length - 1]
        const wires = [...power, [`X:${g1[0]}`, 'U:D2'], [`X:${o1}`, `X:${g2[0]}`], [`X:${o2}`, 'U:D4']]
        if (nIn === 2) { wires.push([`X:${g1[1]}`, 'U:D3']); wires.push([`X:${g2[1]}`, 'U:D5']) }
        kit.scene({ U: 'arduino', X: type }, wires)
        ;[2, 3, 5].forEach(p => kit.pinMode(p, 'output')); kit.pinMode(4, 'input')
        const cases = nIn === 1 ? [[0], [1]] : [[0, 0, 0], [0, 1, 1], [1, 1, 0], [1, 0, 1], [1, 1, 1]]
        for (const c of cases) {
          kit.write(2, c[0]); if (nIn === 2) { kit.write(3, c[1]); kit.write(5, c[2]) }
          kit.step(1 / 60)
          const mid = nIn === 1 ? fn(c[0]) : fn(c[0], c[1])
          const want = nIn === 1 ? fn(mid) : fn(mid, c[2])
          kit.equal(kit.digitalRead(4), want, `chain for ${c.join('')}`)
        }
      },
    },
    {
      name: 'no output and an issue when VCC is not wired',
      run(kit) {
        const g = gates[0], out = g[g.length - 1]
        const highIn = combos.find(c => fn(...c) === 1)
        const wires = [['X:GND', 'U:GND1'], [`X:${out}`, 'R:1'], ['R:2', 'U:GND2']]
        g.slice(0, -1).forEach((n, k) => wires.push([`X:${n}`, highIn[k] ? 'U:5V' : 'U:GND3']))
        kit.scene({ U: 'arduino', X: type, R: { type: 'resistor', resistance: 1000 } }, wires)
        kit.step(0.05)
        kit.near(kit.vpin('X', out), 0, 0.01, 'dead output')
        kit.ok(kit.hasIssue('X:unpowered'), 'unpowered issue raised')
      },
    },
    {
      name: 'warns about a floating input of a gate in use',
      run(kit) {
        const g = gates[0]
        kit.scene({ U: 'arduino', X: type }, [...power, [`X:${g[g.length - 1]}`, 'U:D4'], ...(nIn === 2 ? [[`X:${g[0]}`, 'U:D2']] : [])])
        kit.step(0.02)
        kit.ok(kit.hasIssue('X:floating'), 'floating-input warning')
      },
    },
  ]
}
