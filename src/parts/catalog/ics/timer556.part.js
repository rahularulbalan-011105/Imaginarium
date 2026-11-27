// NE556 dual timer (Tinkercad "556 dual timer"), DIP-14 — two independent
// NE555s sharing only VCC and GND (TI NE556 datasheet SLFS023):
//   1 DIS1 · 2 THR1 · 3 CTRL1 · 4 RESET1 · 5 OUT1 · 6 TRIG1 · 7 GND
//   8 TRIG2 · 9 OUT2 · 10 RESET2 · 11 CTRL2 · 12 THR2 · 13 DIS2 · 14 VCC
// Each half is the 555 model of timer555Core.js (3 × 5 kΩ divider, trigger-
// dominant latch, 10 Ω discharge, VOH = VCC − 1.45 V, ±200 mA output).
// Supply: 4.5–16 V (18 V abs. max); ICC ≈ 6 mA typ at 5 V for both timers
// (3 mA each, as the 555), so each half keeps the 555's 1.9 kΩ + divider load.
import { definePart } from '../../definePart.js'
import { dipPins } from '../../model.js'
import { dipBuild, dipDims } from '../logic/cmos.js'
import { benchCap } from './bench.js'
import { timerCircuit, timerBeforeStep, timerSolved, timerReadout } from './timer555Core.js'

const NAMES = ['DIS1', 'THR1', 'CTRL1', 'RESET1', 'OUT1', 'TRIG1', 'GND', 'TRIG2', 'OUT2', 'RESET2', 'CTRL2', 'THR2', 'DIS2', 'VCC']
const KINDS = { GND: 'gnd', VCC: 'power' }
for (const k of [1, 2]) Object.assign(KINDS, { [`TRIG${k}`]: 'analog', [`OUT${k}`]: 'digital', [`RESET${k}`]: 'digital', [`CTRL${k}`]: 'analog', [`THR${k}`]: 'analog', [`DIS${k}`]: 'analog' })
const half = (k) => ({ GND: 'GND', VCC: 'VCC', TRIG: `TRIG${k}`, OUT: `OUT${k}`, RESET: `RESET${k}`, CTRL: `CTRL${k}`, THR: `THR${k}`, DIS: `DIS${k}` })
const LIM = [null,
  { pn: 'NE556', vmax: 16, vabs: 18, pins: 'pin 14 to 5V and pin 7 to GND', resetPin: 'pin 4' },
  { pn: 'NE556', vmax: 16, vabs: 18, pins: 'pin 14 to 5V and pin 7 to GND', resetPin: 'pin 10' }]

/** Astable wiring of one half: R1 VCC→DIS, R2 DIS→THR, THR=TRIG, RESET=VCC. */
function astableWires(k, r1, r2) {
  return [[`${r1}:1`, 'U:5V'], [`${r1}:2`, `T:DIS${k}`], [`${r2}:1`, `T:DIS${k}`], [`${r2}:2`, `T:THR${k}`], [`T:THR${k}`, `T:TRIG${k}`]]
}

export default definePart({
  type: 'timer_556',
  label: '556 Dual Timer',
  shortName: '556',
  tinkercad: '556 dual timer',
  category: 'ics',
  icon: '⏱',
  desc: 'NE556 · DIP-14 · two independent 555 timers · 4.5–16 V',
  purpose: 'Two complete 555 timers in one chip; they share only VCC (14) and GND (7). Timer 1 uses pins 1–6 (DIS, THR, CTRL, RESET, OUT, TRIG), ' +
    'timer 2 pins 8–13 (TRIG, OUT, RESET, CTRL, THR, DIS). Wire each half exactly like a 555: astable f = 1.44 / ((R1 + 2·R2)·C). ' +
    'Tie both RESETs (4 and 10) to VCC. Classic uses: two blinkers at different rates, or one timer gating the other (a warbling siren).',
  usage: 'dual blinkers · siren / tone gating · pulse delay + width',
  spec: {
    dims_mm: dipDims(14), mass_kg: 0.001, vcc: '4.5–16 V (18 V abs. max)', iout_mA: 200, icc_mA: 6,
    summary: 'Two NE555s: thresholds 2/3·VCC and 1/3·VCC from each half\'s 3 × 5 kΩ divider, ±200 mA outputs, ≈6 mA supply current at 5 V.',
  },
  pins: dipPins(NAMES, { kinds: KINDS }),
  groundPin: 'GND',
  build: () => dipBuild(14, 'NE556'),
  sim: {
    transient: true,
    maxDt: 1e-4,
    circuit(api) { return { a: timerCircuit(api, half(1)), b: timerCircuit(api, half(2)) } },
    beforeStep(h, api) { timerBeforeStep(h.a, api); timerBeforeStep(h.b, api) },
    solved(h, api) {
      const name = api.obj.name || '556'
      const a = timerSolved(h.a, api, { sfx: '1', who: `${name} timer 1`, lim: LIM[1] })
      const b = timerSolved(h.b, api, { sfx: '2', who: `${name} timer 2`, lim: LIM[2], checkSupply: false })
      return { a, b, vcc: a.vcc }
    },
    readout: ({ solved }) => (solved ? `1: ${timerReadout(solved.a)} · 2: ${timerReadout(solved.b)}` : ''),
  },
  tests: [
    {
      name: 'both halves as astables: timer 1 (1 k/10 k/10 µF) ≈ 6.86 Hz, timer 2 (1 k/4.7 k/10 µF) ≈ 13.8 Hz, each blinking its own LED',
      run(kit) {
        kit.scene({
          U: 'arduino', T: 'timer_556',
          A1: { type: 'resistor', resistance: 1000 }, A2: { type: 'resistor', resistance: 10000 },
          B1: { type: 'resistor', resistance: 1000 }, B2: { type: 'resistor', resistance: 4700 },
          RA: { type: 'resistor', resistance: 220 }, RB: { type: 'resistor', resistance: 220 }, LA: 'led', LB: 'led',
        }, [
          ['T:VCC', 'U:5V'], ['T:GND', 'U:GND1'], ['T:RESET1', 'U:5V'], ['T:RESET2', 'U:5V'],
          ...astableWires(1, 'A1', 'A2'), ...astableWires(2, 'B1', 'B2'),
          ['T:OUT1', 'RA:1'], ['RA:2', 'LA:ANODE'], ['LA:CATHODE', 'U:GND2'],
          ['T:OUT2', 'RB:1'], ['RB:2', 'LB:ANODE'], ['LB:CATHODE', 'U:GND3'],
        ])
        benchCap(kit, 'T:THR1', 10e-6); benchCap(kit, 'T:THR2', 10e-6)
        kit.step(1.0)                                           // first (longer) charges from 0 V
        let litA = 0, darkA = 0, litB = 0, darkB = 0
        for (let i = 0; i < 120; i++) {                         // 2 s of frames
          kit.step(1 / 60)
          if (kit.led.LA > 60) litA++; else if (!(kit.led.LA > 5)) darkA++
          if (kit.led.LB > 60) litB++; else if (!(kit.led.LB > 5)) darkB++
        }
        const { a, b } = kit.state('T')
        // Timer 1: f = 1.44 / ((1k + 2·10k)·10 µF) = 1.44 / 0.21 s = 6.857 Hz; duty = 11/21 = 52.4 %
        kit.between(a.freq, 6.857 * 0.9, 6.857 * 1.1, 'timer 1 frequency (Hz)')
        kit.between(a.duty, 0.50, 0.55, 'timer 1 duty')
        // Timer 2: f = 1.44 / ((1k + 2·4.7k)·10 µF) = 1.44 / 0.104 s = 13.85 Hz; duty = 5.7/10.4 = 54.8 %
        kit.between(b.freq, 13.85 * 0.9, 13.85 * 1.1, 'timer 2 frequency (Hz)')
        kit.between(b.duty, 0.52, 0.58, 'timer 2 duty')
        kit.ok(litA > 20 && darkA > 20 && litB > 20 && darkB > 20, `both LEDs blink (A ${litA}/${darkA}, B ${litB}/${darkB})`)
        kit.ok(!kit.hasIssue('T:'), 'no issues')
      },
    },
    {
      name: 'the halves are independent: RESET2 LOW holds OUT2 low while timer 1 keeps running',
      run(kit) {
        kit.scene({
          U: 'arduino', T: 'timer_556', A1: { type: 'resistor', resistance: 1000 }, A2: { type: 'resistor', resistance: 10000 },
          B1: { type: 'resistor', resistance: 1000 }, B2: { type: 'resistor', resistance: 4700 },
        }, [
          ['T:VCC', 'U:5V'], ['T:GND', 'U:GND1'], ['T:RESET1', 'U:5V'], ['T:RESET2', 'U:D4'],
          ...astableWires(1, 'A1', 'A2'), ...astableWires(2, 'B1', 'B2'),
        ])
        benchCap(kit, 'T:THR1', 10e-6); benchCap(kit, 'T:THR2', 10e-6)
        kit.pinMode(4, 'output'); kit.write(4, 0)
        kit.step(1.5)
        const s = kit.state('T')
        kit.between(s.a.freq, 6.857 * 0.9, 6.857 * 1.1, 'timer 1 still oscillates')
        kit.equal(s.b.out, 0, 'timer 2 held in reset')
        // Discharge on: THR2 is pulled toward 0 through R2 = 4.7 kΩ by the 10 Ω discharge → ≈0 V.
        kit.ok(kit.vpin('T', 'THR2') < 0.05, 'timer 2 capacitor held discharged')
        kit.write(4, 1); kit.step(1.5)
        kit.between(kit.state('T').b.freq, 13.85 * 0.9, 13.85 * 1.1, 'timer 2 runs once RESET2 is HIGH')
      },
    },
  ],
})
