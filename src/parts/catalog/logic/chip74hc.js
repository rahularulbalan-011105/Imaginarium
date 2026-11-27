// ─────────────────────────────────────────────────────────────────────────────
// 74HC chip factories for the wider logic family (NOT a part file):
//
//   makeGateChip()   N-input gate chips (74HC10/11/20/21/27) and Schmitt-trigger
//                    gates (74HC14/132). Same electrical model as gate74hc.js
//                    (cmos.js logicBlock, HC_STAGE output stages from the chip's
//                    own VCC/GND), any pinout, any input count, optional
//                    hysteresis thresholds.
//   makeSeqChip()    clocked / latched chips (74HC73/74/75/93/4017). The state
//                    machine `next(s, { p, c, d })` runs in TWO places:
//                      • sim.onPin — a board-pin edge, handled immediately with
//                        sample-then-commit across every chip (like the 595);
//                      • inside the solve (seqBlock) — an edge that comes from
//                        another chip's OUTPUT (a 555, another flip-flop, its own
//                        Q0 → CP1). Each Newton iteration recomputes a tentative
//                        state from the COMMITTED state + committed input levels
//                        (p) and the levels of this iteration (c); update()
//                        commits it after the accepted step. So ripple chains
//                        settle inside one solve, exactly like gates feeding gates.
//                    p = levels before the event, c = levels now, d = the levels
//                    data inputs are sampled from at a clock edge (pre-edge: p in
//                    the solve; in onPin the fresh pre-commit levels c).
//                    sim.drives reports the committed outputs, so a chip that
//                    reads a net another chip drives sees its logical level.
//   chipIssues()     VCC/GND missing, over-voltage, floating inputs, output and
//                    supply over-current — the checks every 74HC chip shares.
// ─────────────────────────────────────────────────────────────────────────────
import { definePart } from '../../definePart.js'
import { dipPins } from '../../model.js'
import { HC, levelOf, logicBlock, stampStage, stageCurrent, dipBuild, dipDims } from './cmos.js'
import { HC_STAGE } from './gate74hc.js'

/** 74HC Schmitt-trigger thresholds as fractions of VCC (74HC14/132, VCC = 5 V: VT+ ≈ 2.75 V, VT− ≈ 1.75 V). */
export const HC_SCHMITT = { VTN: 0.35, VTP: 0.55 }

const isNC = (n) => /^NC\d*$/.test(n)

/** DIP pin list with VCC/GND/NC kinds and display labels (Q̄ etc.). */
export function chipPins(names, labels = {}) {
  const kinds = Object.fromEntries(names.map(n => [n, n === 'VCC' ? 'power' : n === 'GND' ? 'gnd' : isNC(n) ? 'passive' : 'digital']))
  return dipPins(names, { kinds }).map(p => (labels[p.name] ? { ...p, label: labels[p.name] } : p))
}

/**
 * Shared checks. groups = [{ ins: [...input pins], pins: [...every pin of that unit] }]:
 * an input is "floating" only when its unit is in use. outs = [{ name, I }] (A).
 */
export function chipIssues(api, { chip, names, groups, outs, ioAbs = HC.IO_ABS, iccAbs = HC.ICC_ABS }) {
  const name = api.obj.name || chip
  const pinNo = (n) => names.indexOf(n) + 1
  const vs = api.vpin('VCC') - api.vpin('GND')
  const anySignal = names.some(n => n !== 'VCC' && n !== 'GND' && !isNC(n) && api.connected(n))
  if (anySignal && vs < HC.VCC_MIN) api.issue('unpowered', 'warning', `${name} has no supply`,
    `Wire pin ${pinNo('VCC')} (VCC) to 5V and pin ${pinNo('GND')} (GND) to GND. A ${chip} needs 2–6 V; without it every output is dead (high-impedance) and nothing is counted or stored.`)
  else api.clearIssue('unpowered')
  if (vs > HC.VCC_ABS) api.issue('overvoltage', 'error', `${name} has ${vs.toFixed(1)} V on VCC`,
    `74HC logic is rated 2–6 V (7 V absolute maximum). It would be destroyed — power it from 5 V.`)
  else api.clearIssue('overvoltage')
  const floating = []
  for (const g of groups) {
    if (!g.pins.some(n => api.connected(n))) continue
    for (const n of g.ins) if (!api.connected(n)) floating.push(n)
  }
  if (floating.length) api.issue('floating', 'warning', `${name}: input ${floating.join(', ')} is not connected`,
    'A floating CMOS input picks up noise and can read HIGH or LOW at random (and makes the chip draw extra current). Tie it to VCC or GND, or wire it to a pin.')
  else api.clearIssue('floating')
  let tot = 0, worst = 0, worstName = ''
  for (const o of outs) { const a = Math.abs(o.I); tot += a; if (a > worst) { worst = a; worstName = o.name } }
  if (worst > ioAbs) api.issue('overcurrent', 'error', `${name} output ${worstName} carries ${(worst * 1000).toFixed(0)} mA`,
    `A 74HC output is rated ±${(ioAbs * 1000).toFixed(0)} mA absolute maximum (4 mA for the guaranteed levels). Add a series resistor (≥ 220 Ω for an LED).`)
  else api.clearIssue('overcurrent')
  if (tot > iccAbs) api.issue('supply', 'warning', `${name} supplies ${(tot * 1000).toFixed(0)} mA in total`,
    `VCC/GND of a 74HC chip are rated ±${(iccAbs * 1000).toFixed(0)} mA absolute maximum.`)
  else api.clearIssue('supply')
  return { powered: vs >= HC.VCC_MIN, vcc: vs, current: tot }
}

const SPEC_BASE = { mass_kg: 0.001, vcc: '2–6 V (7 V abs. max)', ioh_mA: 4, io_abs_mA: 25 }

// ── gate chips ──────────────────────────────────────────────────────────────
/**
 * @param {object} o  { type, chip, label, tinkercad, fnName, names, gates: [[in…, out]], fn, schmitt?, desc?, extraTests? }
 */
export function makeGateChip({ type, chip, label, tinkercad, fnName, names, gates, fn, schmitt = false, desc, extraTests = [] }) {
  const nIn = gates[0].length - 1
  const no = (n) => names.indexOf(n) + 1
  const vil = schmitt ? HC_SCHMITT.VTN : HC.VIL, vih = schmitt ? HC_SCHMITT.VTP : HC.VIH
  const kind = nIn === 1 ? 'inverter' : `${nIn}-input ${fnName}`
  const combos = Array.from({ length: 2 ** nIn }, (_, k) => Array.from({ length: nIn }, (_, j) => (k >> (nIn - 1 - j)) & 1))
  const truth = combos.map(c => `${c.join('')}→${fn(...c)}`).join(' ')
  const thresholds = schmitt
    ? `Schmitt-trigger inputs: an input must rise past VT+ ≈ 55 % of VCC (2.75 V at 5 V) to read HIGH and fall below VT− ≈ 35 % (1.75 V) to read LOW, ` +
      'so a slow or noisy signal (RC delay, sensor, switch bounce) gives one clean edge.'
    : 'Inputs switch at 30 % / 70 % of VCC.'
  const groups = gates.map(g => ({ ins: g.slice(0, -1), pins: g }))
  return definePart({
    type, label: label ?? tinkercad, tinkercad, category: 'ics', shortName: chip, icon: '▦',
    desc: desc ?? `${gates.length}× ${kind} · DIP-14 · 2–6 V CMOS`,
    purpose: `${chip}: ${gates.length} independent ${kind} gates in one DIP-14. Pin ${no('VCC')} = VCC (2–6 V, use the Arduino 5V), pin ${no('GND')} = GND. ` +
      `${thresholds} Every output drives its pin from the chip's own supply (≈45 Ω), so it can light an LED through 220 Ω or feed another gate. ` +
      `Tie unused inputs to VCC or GND. Truth table: ${truth}.`,
    usage: schmitt ? 'cleaning slow or noisy signals · debouncing · RC oscillators' : 'logic experiments · combining several sensor signals · decoders',
    spec: {
      ...SPEC_BASE, dims_mm: dipDims(14),
      summary: schmitt
        ? `CMOS ${fnName} with Schmitt inputs: VT+ ≈ 0.55·VCC, VT− ≈ 0.35·VCC (hysteresis ≈ 1 V at 5 V). VOH 4.32 V / VOL 0.15 V at 4 mA (VCC 4.5 V).`
        : `CMOS ${fnName}, tpd ≈ 10 ns at 5 V. VIL 0.3·VCC, VIH 0.7·VCC, VOH 4.32 V / VOL 0.15 V at 4 mA (VCC 4.5 V).`,
    },
    pins: chipPins(names),
    groundPin: 'GND',
    build: () => dipBuild(14, chip),
    sim: {
      circuit(api) {
        const vcc = api.pin('VCC'), gnd = api.pin('GND')
        const els = gates.map(g => api.add(logicBlock({
          ins: g.slice(0, -1).map(n => api.pin(n)), outs: [api.pin(g[g.length - 1])], vcc, gnd,
          stage: HC_STAGE, vil, vih, compute: (lv) => [fn(...lv)],
        })))
        return { els }
      },
      solved(h, api) {
        const v = (n) => api.v(n)
        const outputs = {}
        const outs = h.els.map((el, i) => {
          const name = gates[i][gates[i].length - 1]
          outputs[name] = el.state.q[0]
          return { name, I: el.outCurrent(0, v) }
        })
        return { ...chipIssues(api, { chip, names, groups, outs }), outputs }
      },
      readout: ({ solved }) => (solved ? (solved.powered ? Object.entries(solved.outputs).map(([k, q]) => `${k}=${q ?? 'Z'}`).join(' ') : 'no VCC') : ''),
    },
    tests: [...gateTests({ type, chip, gates, fn, nIn, combos, schmitt }), ...extraTests],
  })
}

const POWER = [['X:VCC', 'U:5V'], ['X:GND', 'U:GND1']]

function gateTests({ type, chip, gates, fn, nIn, combos, schmitt }) {
  const outOf = (g) => g[g.length - 1]
  const tests = [
    {
      name: `truth table of all ${gates.length} gates, all ${combos.length} input combinations (each gate gets a different combination)`,
      run(kit) {
        let pin = 2
        const map = gates.map(g => ({ ins: g.slice(0, -1).map(() => pin++), out: pin++ }))
        const wires = [...POWER]
        gates.forEach((g, i) => {
          g.slice(0, -1).forEach((n, k) => wires.push([`X:${n}`, `U:D${map[i].ins[k]}`]))
          wires.push([`X:${outOf(g)}`, `U:D${map[i].out}`])
        })
        kit.scene({ U: 'arduino', X: type }, wires)
        for (const m of map) { m.ins.forEach(p => kit.pinMode(p, 'output')); kit.pinMode(m.out, 'input') }
        for (let k = 0; k < combos.length; k++) {
          const per = gates.map((_, i) => combos[(k + i) % combos.length])
          map.forEach((m, i) => m.ins.forEach((p, j) => kit.write(p, per[i][j])))
          kit.step(1 / 60)
          gates.forEach((g, i) => {
            const want = fn(...per[i])
            kit.equal(kit.digitalRead(map[i].out), want, `${chip} ${outOf(g)} for inputs ${per[i].join('')}`)
            kit.near(kit.pinVoltage(map[i].out), want ? 5 : 0, 0.05, `${outOf(g)} voltage (unloaded CMOS output at the rail)`)
          })
        }
        kit.ok(!kit.hasIssue('X:floating'), 'no floating-input warning when every input is wired')
        kit.ok(!kit.hasIssue('X:unpowered'), 'powered')
      },
    },
    {
      name: 'an output lights an LED through 220 Ω (≈11 mA, VOH ≈ 4.5 V)',
      run(kit) {
        const g = gates[0]
        const highIn = combos.find(c => fn(...c) === 1)
        const wires = [...POWER, [`X:${outOf(g)}`, 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2']]
        g.slice(0, -1).forEach((n, k) => wires.push([`X:${n}`, highIn[k] ? 'U:5V' : 'U:GND3']))
        kit.scene({ U: 'arduino', X: type, R: { type: 'resistor', resistance: 220 }, L: 'led' }, wires)
        kit.step(0.05)
        // I = (5 − ≈1.9 V red LED) / (220 Ω + 45 Ω Ron + 8 Ω LED Rs) ≈ 11 mA → Vout = 5 − 11 mA·45 Ω ≈ 4.5 V.
        kit.between(kit.state('R').current, 0.009, 0.0125, 'LED current')
        kit.between(kit.vpin('X', outOf(g)), 4.4, 4.65, 'loaded VOH')
        kit.between(kit.led.L, 100, 170, 'LED brightness')
      },
    },
    {
      name: 'one gate drives the next gate (output → input chain settles in one solve)',
      run(kit) {
        const [g1, g2] = gates
        const ins1 = g1.slice(0, -1).map((_, k) => 2 + k)
        const restPin = 2 + nIn, outPin = 3 + nIn
        const wires = [...POWER, [`X:${outOf(g1)}`, `X:${g2[0]}`], [`X:${outOf(g2)}`, `U:D${outPin}`]]
        g1.slice(0, -1).forEach((n, k) => wires.push([`X:${n}`, `U:D${ins1[k]}`]))
        g2.slice(1, -1).forEach(n => wires.push([`X:${n}`, `U:D${restPin}`]))
        kit.scene({ U: 'arduino', X: type }, wires)
        ins1.forEach(p => kit.pinMode(p, 'output')); kit.pinMode(restPin, 'output'); kit.pinMode(outPin, 'input')
        for (const c of combos) for (const b of nIn > 1 ? [0, 1] : [0]) {
          c.forEach((bit, k) => kit.write(ins1[k], bit)); kit.write(restPin, b)
          kit.step(1 / 60)
          const want = fn(fn(...c), ...Array(nIn - 1).fill(b))
          kit.equal(kit.digitalRead(outPin), want, `chain for ${c.join('')} / ${b}`)
        }
      },
    },
    {
      name: 'no output and an issue when VCC is not wired',
      run(kit) {
        const g = gates[0]
        const highIn = combos.find(c => fn(...c) === 1)
        const wires = [['X:GND', 'U:GND1'], [`X:${outOf(g)}`, 'R:1'], ['R:2', 'U:GND2']]
        g.slice(0, -1).forEach((n, k) => wires.push([`X:${n}`, highIn[k] ? 'U:5V' : 'U:GND3']))
        kit.scene({ U: 'arduino', X: type, R: { type: 'resistor', resistance: 1000 } }, wires)
        kit.step(0.05)
        kit.near(kit.vpin('X', outOf(g)), 0, 0.01, 'dead output')
        kit.ok(kit.hasIssue('X:unpowered'), 'unpowered issue raised')
      },
    },
    {
      name: 'warns about a floating input of a gate in use',
      run(kit) {
        const g = gates[0]
        kit.scene({ U: 'arduino', X: type }, [...POWER, [`X:${outOf(g)}`, 'U:D4'], ...(nIn > 1 ? [[`X:${g[0]}`, 'U:D2']] : [])])
        kit.step(0.02)
        kit.ok(kit.hasIssue('X:floating'), 'floating-input warning')
      },
    },
  ]
  if (schmitt) tests.push({
    name: 'slow ramp on a Schmitt input: switches at VT+ ≈ 2.75 V going up and VT− ≈ 1.75 V going down',
    run(kit) {
      const g = gates[0], inp = g[0], out = outOf(g)
      // Potentiometer as the ramp: T1 = 5 V, T2 = GND, so V(W) = 5 V · (1 − position).
      const wires = [...POWER, ['P:T1', 'U:5V'], ['P:T2', 'U:GND2'], ['P:W', `X:${inp}`], [`X:${out}`, 'U:D7']]
      g.slice(1, -1).forEach(n => wires.push([`X:${n}`, 'U:5V']))           // other inputs at the non-controlling level
      kit.scene({ U: 'arduino', X: type, P: 'potentiometer' }, wires)
      kit.pinMode(7, 'input')
      const others = Array(nIn - 1).fill(1)
      const outLow = fn(0, ...others), outHigh = fn(1, ...others)
      kit.ok(outLow !== outHigh, 'output follows the ramped input')
      kit.control('P', 'position', 100); kit.step(1 / 60)
      kit.equal(kit.digitalRead(7), outLow, 'input at 0 V')
      let up = null, down = null
      for (let pct = 100; pct >= 0; pct--) {                                 // 0 → 5 V in 50 mV steps
        kit.control('P', 'position', pct); kit.step(1 / 60)
        if (up == null && kit.digitalRead(7) === outHigh) up = kit.vpin('P', 'W')
      }
      for (let pct = 0; pct <= 100; pct++) {                                 // 5 → 0 V
        kit.control('P', 'position', pct); kit.step(1 / 60)
        if (down == null && kit.digitalRead(7) === outLow) down = kit.vpin('P', 'W')
      }
      kit.ok(up != null && down != null, 'output switched both ways')
      // VT+ = 0.55 · 5 V = 2.75 V, VT− = 0.35 · 5 V = 1.75 V (one 50 mV ramp step of slack).
      kit.between(up, 2.70, 2.85, 'rising threshold VT+')
      kit.between(down, 1.65, 1.80, 'falling threshold VT−')
      kit.between(up - down, 0.9, 1.1, 'hysteresis ≈ 1 V')
    },
  })
  return tests
}

// ── clocked / latched chips ─────────────────────────────────────────────────
/** Circuit element that runs a chip's state machine inside the solve (see header). */
function seqBlock({ pinNode, ins, outs, vcc, gnd, init, next, out, stage, vil = HC.VIL, vih = HC.VIH }) {
  const inN = ins.map(pinNode), outN = outs.map(pinNode)
  const nulls = () => outs.map(() => null)
  const el = {
    kind: 'LOGIC', nodes: [...inN, ...outN, vcc, gnd], nonlinear: true,
    state: { s: init(), lv: Object.fromEntries(ins.map(n => [n, 0])), q: nulls(), powered: false, vs: 0 },
  }
  const evaluate = (v) => {
    const st = el.state
    const vs = v(vcc) - v(gnd)
    if (!(vs >= HC.VCC_MIN)) return { vs, powered: false, s: init(), lv: st.lv, q: nulls() }
    const c = {}
    ins.forEach((n, i) => { c[n] = levelOf(v(inN[i]) - v(gnd), vs, st.lv[n], vil, vih) })
    // Just powered up: no edge yet (the real chip wakes in an arbitrary state; ours in init()).
    const p = st.powered ? st.lv : c
    const s = next(st.s, { p, c, d: p })
    return { vs, powered: true, s, lv: c, q: out(s, c) }
  }
  el.stamp = (sys, ctx) => { const r = evaluate(ctx.v); outN.forEach((o, i) => stampStage(sys, o, vcc, gnd, r.q[i], stage)) }
  el.update = (ctx) => { const r = evaluate(ctx.v); Object.assign(el.state, { s: r.s, lv: r.lv, q: r.q, powered: r.powered, vs: r.vs }) }
  el.outCurrent = (i, v) => stageCurrent(v, outN[i], vcc, gnd, el.state.q[i], stage)
  return el
}

/**
 * @param {object} o
 * @param {string[]} o.names   DIP pin names, names[i] = pin i+1
 * @param {string[]} o.ins @param {string[]} o.outs
 * @param {() => any} o.init
 * @param {(s, lv:{p,c,d}) => any} o.next   pure: returns a NEW state
 * @param {(s, c) => (0|1)[]} o.out          output levels in `outs` order
 * @param {object[]} o.groups               [{ ins, pins }] for the floating-input check
 * @param {(s) => string} [o.show]          readout text of a state
 */
export function makeSeqChip({ type, chip, label, tinkercad, names, labels = {}, ins, outs, init, next, out, groups, show, desc, purpose, usage, summary, tests, stage = HC_STAGE }) {
  const n = names.length
  const ELS = new WeakMap()                      // scene object → its solver element (shared with onPin / drives)
  return definePart({
    type, label: label ?? tinkercad, tinkercad, category: 'ics', shortName: chip, icon: '▦',
    desc, purpose, usage,
    spec: { ...SPEC_BASE, dims_mm: dipDims(n), mass_kg: n > 14 ? 0.0012 : 0.001, summary },
    pins: chipPins(names, labels),
    groundPin: 'GND',
    build: () => dipBuild(n, chip),
    sim: {
      circuit(api) {
        const el = api.add(seqBlock({ pinNode: (p) => api.pin(p), ins, outs, vcc: api.pin('VCC'), gnd: api.pin('GND'), init, next, out, stage }))
        ELS.set(api.obj, el)
        return { el }
      },
      // A board-pin edge: every chip samples first, then all commit (two-phase).
      onPin(api, { pin, level }) {
        const el = ELS.get(api.obj)
        if (!el?.state.powered) return
        const hit = new Set(ins.filter(p => api.boardPin(p) === pin))
        if (!hit.size) return
        const st = el.state
        const c = {}
        for (const p of ins) c[p] = hit.has(p) ? level : api.level(p)
        const s = next(st.s, { p: st.lv, c, d: c })
        return () => { st.s = s; st.lv = c; st.q = out(s, c) }
      },
      drives(state, obj) {
        const el = ELS.get(obj)
        if (!el?.state.powered) return null
        return Object.fromEntries(outs.map((p, i) => [p, el.state.q[i]]))
      },
      solved(h, api) {
        const v = (x) => api.v(x)
        const q = h.el.state.q
        const r = chipIssues(api, { chip, names, groups, outs: outs.map((p, i) => ({ name: p, I: h.el.outCurrent(i, v) })) })
        return { ...r, outputs: Object.fromEntries(outs.map((p, i) => [p, q[i]])), s: h.el.state.s }
      },
      readout: ({ solved }) => (!solved ? '' : !solved.powered ? 'no VCC' : show ? show(solved.s) : outs.map(p => `${p}=${solved.outputs[p] ?? 'Z'}`).join(' ')),
    },
    tests,
  })
}

/** Edge helpers for next(): rising / falling between p and c. */
export const rise = (lv, n) => !lv.p[n] && !!lv.c[n]
export const fall = (lv, n) => !!lv.p[n] && !lv.c[n]
