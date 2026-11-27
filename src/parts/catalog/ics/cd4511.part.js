// CD4511B BCD-to-7-segment latch/decoder/driver (Tinkercad "BCD to 7-Segment
// Decoder CD4511"). DIP-16, TI CD4511B pinout:
//   1 B · 2 C · 3 LT · 4 BI · 5 LE · 6 D · 7 A · 8 VSS
//   9 e · 10 d · 11 c · 12 b · 13 a · 14 g · 15 f · 16 VDD
//
//   LT low    lamp test: all segments ON (overrides everything)
//   BI low    blanking: all segments OFF
//   LE low    latch transparent (outputs follow DCBA); LE high holds the code
//             present when LE went high
//   codes 10–15 blank; 6 and 9 are drawn WITHOUT tails (6 has no a, 9 no d)
// Outputs are active HIGH NPN emitter followers for common-cathode displays:
// VOH ≈ VDD − 0.6 V − 40 Ω·I (datasheet VDD 5 V: 4.1 V min at 0 mA, sourcing up
// to 25 mA), LOW is a weak NMOS (≈600 Ω; IOL 0.64 mA at 0.4 V). Inputs are
// CMOS (0.3 / 0.7·VDD), evaluated inside the solve. VDD 3–18 V (20 V abs max).
import { definePart } from '../../definePart.js'
import { dipPins } from '../../model.js'
import { logicBlock, dipBuild, dipDims } from '../logic/cmos.js'

const NAMES = ['B', 'C', 'LT', 'BI', 'LE', 'D', 'A', 'VSS', 'e', 'd', 'c', 'b', 'a', 'g', 'f', 'VDD']
const SEG = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const KINDS = Object.fromEntries(NAMES.map(n => [n, n === 'VDD' ? 'power' : n === 'VSS' ? 'gnd' : 'digital']))
const STAGE = { ronHi: 40, dropHi: 0.6, ronLo: 600 }
// abcdefg per BCD digit (CD4511B truth table — no tails on 6 and 9)
const FONT = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '0011111', '1110000', '1111111', '1110011']
  .map(s => [...s].map(Number))

/** Segments for a code with lamp-test / blanking (exported for the Blockly tooltip and tests). */
export function cd4511Segments(code, { lt = 1, bi = 1 } = {}) {
  if (!lt) return SEG.map(() => 1)
  if (!bi || code > 9) return SEG.map(() => 0)
  return FONT[code]
}

export default definePart({
  type: 'decoder_cd4511',
  label: 'BCD to 7-Segment Decoder CD4511',
  shortName: '4511',
  tinkercad: 'BCD to 7-Segment Decoder CD4511',
  category: 'ics',
  icon: '8',
  desc: 'BCD → 7-segment latch/decoder/driver · DIP-16 · 3–18 V · 25 mA outputs',
  purpose: 'Shows a digit 0–9 on a COMMON-CATHODE 7-segment display from 4 pins. A (7) = 1, B (1) = 2, C (2) = 4, D (6) = 8. ' +
    'Outputs a–g (13, 12, 11, 10, 9, 15, 14) each go to a segment through a 220–470 Ω resistor. ' +
    'Tie LT (3) and BI (4) to VDD and LE (5) to GND (or use LE to freeze the digit). VDD (16) to 5V, VSS (8) to GND.',
  usage: 'counters · scoreboards · dice · clocks',
  spec: {
    dims_mm: dipDims(16), mass_kg: 0.0012, vdd: '3–18 V (20 V abs. max)', iout_mA: 25,
    summary: 'Active-high segment outputs sourcing up to 25 mA. LT lamp test, BI blanking, LE latch. Inputs > 9 blank the display.',
  },
  pins: dipPins(NAMES, { kinds: KINDS }),
  groundPin: 'VSS',
  build: () => dipBuild(16, 'CD4511'),
  sim: {
    circuit(api) {
      const el = api.add(logicBlock({
        ins: ['A', 'B', 'C', 'D', 'LT', 'BI', 'LE'].map(n => api.pin(n)),
        outs: SEG.map(n => api.pin(n)), vcc: api.pin('VDD'), gnd: api.pin('VSS'), vMin: 3, stage: STAGE,
        compute: (lv, st) => {
          const code = lv[6] ? (st.latch ?? 0) : lv[0] + 2 * lv[1] + 4 * lv[2] + 8 * lv[3]
          return cd4511Segments(code, { lt: lv[4], bi: lv[5] })
        },
        commit: (lv, st) => { if (st.powered && !lv[6]) st.latch = lv[0] + 2 * lv[1] + 4 * lv[2] + 8 * lv[3] },
      }))
      return { el }
    },
    solved(h, api) {
      const name = api.obj.name || 'CD4511'
      const vs = api.vpin('VDD') - api.vpin('VSS')
      const anyWired = NAMES.some(n => n !== 'VDD' && n !== 'VSS' && api.connected(n))
      if (anyWired && vs < 3) api.issue('unpowered', 'warning', `${name} has no supply`, 'Wire VDD (pin 16) to 5V and VSS (pin 8) to GND (3–18 V).')
      else api.clearIssue('unpowered')
      if (vs > 18) api.issue('overvoltage', vs > 20 ? 'error' : 'warning', `${name} has ${vs.toFixed(1)} V on VDD`, 'The CD4511B is rated 3–18 V (20 V absolute maximum).')
      else api.clearIssue('overvoltage')
      const open = ['A', 'B', 'C', 'D', 'LT', 'BI', 'LE'].filter(n => !api.connected(n))
      if (anyWired && open.length) api.issue('floating', 'warning', `${name}: ${open.join(', ')} not connected`,
        'Floating CMOS inputs read at random. Tie LT and BI to VDD, LE to GND, and wire A–D.')
      else api.clearIssue('floating')
      const v = (n) => api.v(n)
      const I = SEG.map((_, i) => h.el.outCurrent(i, v))
      const worst = Math.max(...I.map(Math.abs))
      if (worst > 0.025) api.issue('overcurrent', 'error', `${name} segment output carries ${(worst * 1000).toFixed(0)} mA`, 'Each CD4511 output is rated 25 mA. Use a 220–470 Ω resistor per segment.')
      else api.clearIssue('overcurrent')
      const q = h.el.state.q
      const lit = SEG.filter((_, i) => q[i] === 1).join('')
      const digit = FONT.findIndex(f => f.every((b, i) => b === (q[i] === 1 ? 1 : 0)))
      return { powered: vs >= 3, segments: lit, digit: digit >= 0 ? digit : null, latch: h.el.state.latch ?? 0, current: I }
    },
    readout: ({ solved }) => (solved ? (solved.powered ? `shows ${solved.digit ?? (solved.segments || 'blank')}` : 'no VDD') : ''),
  },
  blockly: {
    blocks: [{
      type: 'part_decoder_cd4511_show',
      message0: 'CD4511 show digit %1 on pins A %2 B %3 C %4 D %5',
      args0: [
        { type: 'input_value', name: 'DIGIT', check: 'Number' },
        { type: 'field_number', name: 'A', value: 2, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'B', value: 3, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'C', value: 4, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'D', value: 5, min: 0, max: 19, precision: 1 },
      ],
      inputsInline: true, previousStatement: null, nextStatement: null, colour: '#475569',
      tooltip: 'Writes the digit (0–9) to the CD4511 BCD inputs: A = bit 0 … D = bit 3. 10–15 blank the display.',
    }],
    generators: {
      part_decoder_cd4511_show(block, gen, H) {
        const pins = ['A', 'B', 'C', 'D'].map(k => block.getFieldValue(k))
        const v = gen.valueToCode(block, 'DIGIT', H.Order.NONE) || '0'
        H.setup(gen, `cd4511_${pins.join('_')}`, pins.map(p => `pinMode(${p}, OUTPUT);`).join(' '))
        return pins.map((p, i) => `digitalWrite(${p}, ((${v}) >> ${i}) & 1);`).join('\n') + '\n'
      },
    },
  },
  tests: (() => {
    // Segments a–g → 470 Ω → red LED → GND (a stand-in for a common-cathode display).
    const build = (kit, extra = {}) => {
      const spec = { U: 'arduino', DEC: 'decoder_cd4511' }
      const wires = [['DEC:VDD', 'U:5V'], ['DEC:VSS', 'U:GND1'], ['DEC:A', 'U:D2'], ['DEC:B', 'U:D3'], ['DEC:C', 'U:D4'], ['DEC:D', 'U:D5'],
        ['DEC:LE', 'U:D6'], ['DEC:LT', 'U:D7'], ['DEC:BI', extra.bi ?? 'U:5V']]
      SEG.forEach(s => {
        spec[`R${s}`] = { type: 'resistor', resistance: 470 }; spec[`L${s}`] = 'led'
        wires.push([`DEC:${s}`, `R${s}:1`], [`R${s}:2`, `L${s}:ANODE`], [`L${s}:CATHODE`, 'U:GND2'])
      })
      kit.scene(spec, wires)
      ;[2, 3, 4, 5, 6, 7].forEach(p => kit.pinMode(p, 'output'))
      kit.write(6, 0); kit.write(7, 1)
    }
    const show = (kit, n) => { [2, 3, 4, 5].forEach((p, i) => kit.write(p, (n >> i) & 1)); kit.step(1 / 30) }
    const litSegs = (kit) => SEG.filter(s => kit.led[`L${s}`] > 30).join('')
    return [
      {
        name: 'decodes 0–9 (no tails on 6 and 9) and lights the right segment LEDs',
        run(kit) {
          build(kit)
          const want = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'cdefg', 'abc', 'abcdefg', 'abcfg']
          for (let n = 0; n <= 9; n++) {
            show(kit, n)
            kit.equal(kit.state('DEC').segments, want[n], `segments for ${n}`)
            kit.equal(litSegs(kit), want[n], `LEDs for ${n}`)
            kit.equal(kit.state('DEC').digit, n, 'digit')
          }
          // Lit segment: (5 − 0.6 − 1.9 V LED) / (470 + 40 + 8 Ω) ≈ 4.8 mA; VOH = 4.4 − 40 Ω·4.8 mA ≈ 4.21 V
          kit.near(kit.state('Ra').current, 0.0048, 0.0006, 'segment current')
          kit.ok(!kit.hasIssue('DEC:'), 'no issues')
        },
      },
      {
        name: 'codes 10–15 blank; LT low lights all; BI low blanks',
        run(kit) {
          build(kit, { bi: 'U:D8' })
          kit.pinMode(8, 'output'); kit.write(8, 1)
          for (let n = 10; n <= 15; n++) { show(kit, n); kit.equal(litSegs(kit), '', `code ${n} blank`) }
          show(kit, 1)
          kit.write(7, 0); kit.step(1 / 30)
          kit.equal(litSegs(kit), 'abcdefg', 'lamp test')
          kit.write(7, 1); kit.write(8, 0); kit.step(1 / 30)
          kit.equal(litSegs(kit), '', 'blanking')
          kit.write(8, 1); kit.step(1 / 30)
          kit.equal(litSegs(kit), 'bc', 'back to 1')
        },
      },
      {
        name: 'LE high latches the digit; inputs changing while latched are ignored',
        run(kit) {
          build(kit)
          show(kit, 7)
          kit.write(6, 1); kit.step(1 / 30)
          show(kit, 2)
          kit.equal(kit.state('DEC').digit, 7, 'still 7 while LE is high')
          kit.write(6, 0); kit.step(1 / 30)
          kit.equal(kit.state('DEC').digit, 2, 'follows again once LE is low')
        },
      },
      {
        name: 'end to end: a sketch writes 4 to DCBA and the decoder shows 4',
        async run(kit, { runSketch }) {
          build(kit)
          const s = runSketch(kit, `void setup() {
  for (int p = 2; p <= 7; p++) pinMode(p, OUTPUT);
  digitalWrite(6, LOW);
  digitalWrite(7, HIGH);
  int n = 4;
  digitalWrite(2, n & 1); digitalWrite(3, (n >> 1) & 1); digitalWrite(4, (n >> 2) & 1); digitalWrite(5, (n >> 3) & 1);
}
void loop() { delay(10); }`)
          await s.run(120)
          s.stop()
          kit.equal(kit.state('DEC').digit, 4, 'shows 4')
          kit.equal(litSegs(kit), 'bcfg', 'segments b c f g')
        },
      },
    ]
  })(),
})
