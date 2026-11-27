// NE555 timer (Tinkercad "555 Timer"), DIP-8: 1 GND · 2 TRIG · 3 OUT · 4 RESET ·
// 5 CTRL · 6 THR · 7 DIS · 8 VCC (TI NE555 datasheet SLFS022).
//
// Behavioural model, all of it in the circuit solver:
//   divider      the real 5 kΩ–5 kΩ–5 kΩ chain VCC → CTRL → (VCC/3 node) → GND,
//                so CTRL sits at 2/3 VCC and can be overridden from outside
//   comparators  THR > V(CTRL) resets the latch; TRIG < V(CTRL)/2 sets it
//                (trigger dominant, as on the real die)
//   RESET        below ≈0.7 V forces OUT low and the discharge on; the pin has
//                an internal bias (≈0.1–0.4 mA) so a floating RESET does not reset
//   discharge    NPN to GND, Ron ≈ 10 Ω (VCE(sat) ≈ 0.1 V at 10 mA), on while OUT is low
//   output       HIGH: Darlington from VCC, VOH = VCC − 1.45 V − 2.5 Ω·I
//                     (datasheet: VOH 3.3 V at −100 mA with VCC = 5 V)
//                LOW:  10 Ω to GND (VOL ≈ 0.1 V at 10 mA); rated ±200 mA
//   supply       ≈3 mA quiescent at 5 V (datasheet ICC 3 mA typ), 4.5–16 V, 18 V abs max
// The latch is evaluated before every 100 µs sub-step from the solved pin
// voltages (sim.transient), so RC timing comes out of the capacitor maths.
import { definePart } from '../../definePart.js'
import { resistor, sw, vsource } from '../../../circuit/mna.js'
import { dipPins } from '../../model.js'
import { dipBuild, dipDims, stampStage, stageCurrent } from '../logic/cmos.js'
import { benchCap } from './bench.js'

const STAGE = { ronHi: 2.5, dropHi: 1.45, ronLo: 10 }
const NAMES = ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC']
const KINDS = { GND: 'gnd', VCC: 'power', TRIG: 'analog', OUT: 'digital', RESET: 'digital', CTRL: 'analog', THR: 'analog', DIS: 'analog' }

/** Output stage element whose level q (1 / 0 / null) is set by the latch. */
function outStage(out, vcc, gnd) {
  return {
    kind: '555OUT', nodes: [out, vcc, gnd], q: null,
    stamp(sys, ctx, el) { stampStage(sys, out, vcc, gnd, el.q, STAGE) },
    currentOf(ctx, el) { return stageCurrent(ctx.v, out, vcc, gnd, el.q, STAGE) },
  }
}

export default definePart({
  type: 'timer_555',
  label: '555 Timer',
  shortName: '555',
  tinkercad: '555 Timer',
  category: 'ics',
  icon: '⏱',
  desc: 'NE555 · DIP-8 · 4.5–16 V · astable / monostable',
  purpose: 'The classic timer. Astable (blinker): R1 from VCC to DIS (7), R2 from DIS to THR (6), THR tied to TRIG (2), C from THR to GND; ' +
    'f = 1.44 / ((R1 + 2·R2)·C). Monostable: R from VCC to DIS+THR, C to GND, pull TRIG low to start a pulse of 1.1·R·C. ' +
    'Tie RESET (4) to VCC. OUT (3) sources or sinks up to 200 mA, plenty for an LED through 220 Ω.',
  usage: 'LED blinkers · tone generators · debouncing · one-shot delays · PWM',
  spec: {
    dims_mm: dipDims(8), mass_kg: 0.0005, vcc: '4.5–16 V (18 V abs. max)', iout_mA: 200,
    summary: 'Thresholds 2/3·VCC (THR) and 1/3·VCC (TRIG) from an internal 3 × 5 kΩ divider. VOH ≈ VCC − 1.7 V at 100 mA, VOL ≈ 0.1 V at 10 mA.',
  },
  pins: dipPins(NAMES, { kinds: KINDS }),
  groundPin: 'GND',
  build: () => dipBuild(8, 'NE555'),
  sim: {
    transient: true,
    maxDt: 1e-4,
    circuit(api) {
      const P = Object.fromEntries(NAMES.map(n => [n, api.pin(n)]))
      const n3 = api.node()                                      // the VCC/3 tap of the divider
      api.add(resistor(P.VCC, P.CTRL, 5000))
      api.add(resistor(P.CTRL, n3, 5000))
      api.add(resistor(n3, P.GND, 5000))
      api.add(resistor(P.VCC, P.GND, 1900))                      // rest of ICC: 5 V / 1.9 kΩ + 0.33 mA divider ≈ 3 mA
      api.add(vsource(P.RESET, P.GND, 1.4, 12000))               // RESET input bias (pin reads ≈1.4 V when left open)
      const dis = api.add(sw(P.DIS, P.GND, { Ron: 10, Roff: 1e9 }))
      const out = api.add(outStage(P.OUT, P.VCC, P.GND))
      return { P, n3, dis, out, q: 0, edges: [] }
    },
    beforeStep(h, api) {
      const g = api.vpin('GND')
      const vcc = api.vpin('VCC') - g
      let q = h.q
      if (vcc < 3) q = null                                       // not running
      else if (api.vpin('RESET') - g < 0.7) q = 0
      else {
        const vc = api.vpin('CTRL') - g
        if (api.vpin('TRIG') - g < vc / 2) q = 1                  // trigger comparator (dominant)
        else if (api.vpin('THR') - g > vc) q = 0                  // threshold comparator
        else if (q == null) q = 0
      }
      if (q !== h.q) {
        if (q === 1 || h.q === 1) { h.edges.push({ t: api.t, q }); if (h.edges.length > 12) h.edges.shift() }
        h.q = q
      }
      h.out.q = q
      h.dis.closed = q === 0
    },
    solved(h, api) {
      const g = api.vpin('GND'), vcc = api.vpin('VCC') - g
      const name = api.obj.name || '555'
      if (vcc > 16) api.issue('overvoltage', vcc > 18 ? 'error' : 'warning', `${name} has ${vcc.toFixed(1)} V on VCC`, 'The NE555 is rated 4.5–16 V (18 V absolute maximum).')
      else api.clearIssue('overvoltage')
      const anyWired = NAMES.some(n => n !== 'VCC' && n !== 'GND' && api.connected(n))
      if (anyWired && vcc < 4.5) api.issue('unpowered', 'warning', `${name} is not powered`, `VCC−GND is ${vcc.toFixed(2)} V. Wire pin 8 to 5V and pin 1 to GND (the NE555 needs 4.5–16 V).`)
      else api.clearIssue('unpowered')
      if (anyWired && !api.connected('RESET')) api.issue('reset', 'warning', `${name}: RESET (pin 4) is not connected`, 'Tie RESET to VCC. Left open it may pick up noise and reset the timer.')
      else api.clearIssue('reset')
      const iout = api.cur(h.out)
      if (Math.abs(iout) > 0.2) api.issue('overcurrent', 'error', `${name} output carries ${(Math.abs(iout) * 1000).toFixed(0)} mA`, 'The 555 output is rated ±200 mA. Use a resistor or a transistor for the load.')
      else api.clearIssue('overcurrent')
      // Measure the waveform like a scope: last rising edges and the high time after them.
      const rises = h.edges.filter(e => e.q === 1).map(e => e.t)
      let period = null, highTime = null
      if (rises.length >= 2) period = rises[rises.length - 1] - rises[rises.length - 2]
      for (let i = h.edges.length - 1; i > 0; i--) {
        if (h.edges[i].q !== 1 && h.edges[i - 1].q === 1) { highTime = h.edges[i].t - h.edges[i - 1].t; break }
      }
      return {
        running: h.q != null, out: h.q, vout: api.vpin('OUT') - g, vcc, iout,
        period, freq: period ? 1 / period : null, highTime, duty: period && highTime != null ? highTime / period : null,
      }
    },
    readout: ({ solved }) => (!solved ? '' : !solved.running ? 'off' : solved.freq ? `${solved.freq.toFixed(2)} Hz · ${(solved.duty * 100).toFixed(0)} %` : `OUT ${solved.out ? 'HIGH' : 'LOW'}`),
  },
  tests: [
    {
      name: 'astable R1 = 1 kΩ, R2 = 10 kΩ, C = 10 µF oscillates at 1.44/((R1+2R2)C) ≈ 6.86 Hz, duty ≈ 52 %, blinking an LED',
      run(kit) {
        kit.scene({
          U: 'arduino', T: 'timer_555', R1: { type: 'resistor', resistance: 1000 }, R2: { type: 'resistor', resistance: 10000 },
          RL: { type: 'resistor', resistance: 220 }, L: 'led',
        }, [
          ['T:VCC', 'U:5V'], ['T:RESET', 'U:5V'], ['T:GND', 'U:GND1'],
          ['R1:1', 'U:5V'], ['R1:2', 'T:DIS'], ['R2:1', 'T:DIS'], ['R2:2', 'T:THR'], ['T:THR', 'T:TRIG'],
          ['T:OUT', 'RL:1'], ['RL:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2'],
        ])
        benchCap(kit, 'T:THR', 10e-6)
        kit.step(1.0)                                            // first (longer) charge from 0 V
        // f = 1.44 / ((1k + 2·10k)·10 µF) = 1.44 / 0.21 s = 6.857 Hz; T = 145.6 ms
        // t_high = 0.693·(R1+R2)·C = 76.2 ms, t_low = 0.693·R2·C = 69.3 ms → duty = 11/21 = 52.4 %
        let rises = 0, prev = kit.vpin('T', 'OUT') > 2, lit = 0, dark = 0
        for (let i = 0; i < 180; i++) {                          // 3 s of frames
          kit.step(1 / 60)
          const hi = kit.vpin('T', 'OUT') > 2
          if (hi && !prev) rises++
          prev = hi
          if (kit.led.L > 60) lit++; else if (!(kit.led.L > 5)) dark++
        }
        const s = kit.state('T')
        kit.between(s.freq, 6.857 * 0.9, 6.857 * 1.1, 'frequency (Hz)')
        kit.between(s.duty, 0.50, 0.55, 'duty cycle')
        kit.between(rises, 19, 22, 'rising edges counted in 3 s (≈20.6)')
        kit.ok(lit > 40 && dark > 40, `LED blinks (lit ${lit} / dark ${dark} frames)`)
        // VOH with ≈7 mA LED load: 5 − 1.45 − 2.5 Ω·7 mA ≈ 3.53 V
        kit.ok(!kit.hasIssue('T:'), 'no issues')
      },
    },
    {
      name: 'monostable R = 10 kΩ, C = 10 µF: a short TRIG pulse gives one 1.1·R·C = 110 ms output pulse',
      run(kit) {
        kit.scene({ U: 'arduino', T: 'timer_555', R: { type: 'resistor', resistance: 10000 } }, [
          ['T:VCC', 'U:5V'], ['T:RESET', 'U:5V'], ['T:GND', 'U:GND1'],
          ['R:1', 'U:5V'], ['R:2', 'T:DIS'], ['T:DIS', 'T:THR'], ['T:TRIG', 'U:D2'],
        ])
        benchCap(kit, 'T:THR', 10e-6)
        kit.pinMode(2, 'output'); kit.write(2, 1)
        kit.step(0.6)                                            // let any power-up pulse finish
        kit.equal(kit.state('T').out, 0, 'idle: OUT low')
        kit.near(kit.vpin('T', 'THR'), 0, 0.02, 'idle: C held discharged')
        kit.write(2, 0); kit.step(1 / 60); kit.write(2, 1)       // 16.7 ms trigger pulse
        kit.step(0.05)
        kit.equal(kit.state('T').out, 1, 'during the pulse: OUT high')
        // Unloaded VOH = VCC − 1.45 V
        kit.near(kit.state('T').vout, 3.55, 0.05, 'VOH')
        kit.step(0.4)
        kit.equal(kit.state('T').out, 0, 'after the pulse: OUT low again')
        // t = R·C·ln 3 = 1.0986 · 10 kΩ · 10 µF = 109.9 ms
        kit.near(kit.state('T').highTime, 0.1099, 0.011, 'pulse width (s)')
      },
    },
    {
      name: 'RESET low holds OUT low and discharge on; floating RESET warns',
      run(kit) {
        kit.scene({ U: 'arduino', T: 'timer_555', R: { type: 'resistor', resistance: 1000 } }, [
          ['T:VCC', 'U:5V'], ['T:GND', 'U:GND1'], ['T:RESET', 'U:D3'], ['T:TRIG', 'U:GND2'], ['R:1', 'U:5V'], ['R:2', 'T:DIS'],
        ])
        kit.pinMode(3, 'output'); kit.write(3, 0); kit.step(0.05)
        kit.equal(kit.state('T').out, 0, 'TRIG low but RESET low → OUT low')
        kit.near(kit.vpin('T', 'DIS'), 5 * 10 / 1010, 0.01, 'discharge transistor on (≈10 Ω)')
        kit.write(3, 1); kit.step(0.05)
        kit.equal(kit.state('T').out, 1, 'RESET high, TRIG low → OUT high')
        kit.scene({ U: 'arduino', T: 'timer_555' }, [['T:VCC', 'U:5V'], ['T:GND', 'U:GND1'], ['T:TRIG', 'U:GND2']])
        kit.step(0.05)
        kit.equal(kit.state('T').out, 1, 'open RESET does not reset')
        kit.ok(kit.hasIssue('T:reset'), 'warns to tie RESET to VCC')
      },
    },
  ],
})
