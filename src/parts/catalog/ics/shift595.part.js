// 74HC595 8-bit serial-in / parallel-out shift register with output latch
// (Tinkercad "Shift Register 74HC595"). DIP-16, TI SN74HC595 pinout:
//   1 QB · 2 QC · 3 QD · 4 QE · 5 QF · 6 QG · 7 QH · 8 GND
//   9 QH' · 10 SRCLR · 11 SRCLK · 12 RCLK · 13 OE · 14 SER · 15 QA · 16 VCC
//
//   SRCLK ↑   shift register ← SER (QA first stage … QH last); QH' = stage H
//   RCLK ↑    output latch ← shift register
//   SRCLR low clears the shift register (asynchronous, wins over SRCLK)
//   OE high   QA–QH high-impedance (QH' is never disabled)
// Edges come from sim.onPin (bit-banged digitalWrite) and sim.onClockBit
// (shiftOut()), two-phase across chips so a daisy chain (QH' → next SER)
// shifts correctly. The outputs are real push-pull stages from the chip's VCC
// in the solver: VOH 4.32 V / VOL 0.15 V at 6 mA (VCC 4.5 V) → Ron ≈ 30 / 25 Ω.
import { definePart } from '../../definePart.js'
import { dipPins } from '../../model.js'
import { HC, logicBlock, dipBuild, dipDims } from '../logic/cmos.js'

const NAMES = ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC']
const Q = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH']
const STAGE = { ronHi: 30, ronLo: 25 }
const KINDS = Object.fromEntries(NAMES.map(n => [n, n === 'VCC' ? 'power' : n === 'GND' ? 'gnd' : 'digital']))

// The run's shift-register state lives in the bridge's partState (written by
// the edge handlers); the solver side reaches it through the scene object.
const RUN = new WeakMap()
const stateOf = (obj) => RUN.get(obj)
const remember = (api) => { RUN.set(api.obj, api.state); api.state.sr ??= 0; api.state.latch ??= 0; return api.state }

function shiftEdge(api, serBit) {
  const st = remember(api)
  if (api.level('SRCLR') === 0) { st.sr = 0; return null }
  return () => { st.sr = ((st.sr << 1) | (serBit ? 1 : 0)) & 0xff }
}

export default definePart({
  type: 'shift_register_74hc595',
  label: 'Shift Register 74HC595',
  shortName: '595',
  tinkercad: 'Shift Register 74HC595',
  category: 'ics',
  icon: '⇶',
  desc: '8-bit shift register + latch · DIP-16 · 2–6 V',
  purpose: 'Turns 3 Arduino pins into 8 outputs. SER (14) = data, SRCLK (11) = clock, RCLK (12) = latch. ' +
    'digitalWrite(latch, LOW); shiftOut(data, clock, MSBFIRST, value); digitalWrite(latch, HIGH). ' +
    'Tie SRCLR (10) to 5V and OE (13) to GND. QA–QH (15, 1–7) each light an LED through 220 Ω. ' +
    "Chain more chips by wiring QH' (9) to the next chip's SER and sharing the clock and latch.",
  usage: 'LED rows and bar graphs · 7-segment displays · more outputs from few pins',
  spec: {
    dims_mm: dipDims(16), mass_kg: 0.0012, vcc: '2–6 V (7 V abs. max)', iout_abs_mA: 35, icc_abs_mA: 70,
    summary: 'Shift on SRCLK ↑, latch on RCLK ↑, SRCLR active-low clear, OE active-low enable. Outputs ±6 mA rated (±35 mA abs. max), 70 mA total.',
  },
  pins: dipPins(NAMES, { kinds: KINDS }),
  groundPin: 'GND',
  build: () => dipBuild(16, '74HC595'),
  sim: {
    initState: () => ({ sr: 0, latch: 0 }),
    circuit(api) {
      const obj = api.obj
      const outs = [...Q, "QH'"].map(n => api.pin(n))
      const el = api.add(logicBlock({
        ins: [api.pin('OE'), api.pin('SRCLR')], outs, vcc: api.pin('VCC'), gnd: api.pin('GND'), stage: STAGE,
        compute: (lv) => {
          const st = stateOf(obj) ?? { sr: 0, latch: 0 }
          const q = Q.map((_, i) => (lv[0] ? null : (st.latch >> i) & 1))
          q.push((st.sr >> 7) & 1)                            // QH' follows stage H, always enabled
          return q
        },
        // Asynchronous clear while SRCLR is held low (by a pin or tied to GND),
        // judged on the voltages of the step just solved.
        commit: (lv, est) => { const st = stateOf(obj); if (st && est.powered && lv[1] === 0) st.sr = 0 },
      }))
      return { el }
    },
    onPin(api, { pin, level }) {
      if (pin === api.boardPin('SRCLR') && level === 0) { remember(api).sr = 0; return }
      if (level !== 1) return
      if (pin === api.boardPin('SRCLK')) return shiftEdge(api, api.level('SER'))
      if (pin === api.boardPin('RCLK')) { const st = remember(api); return () => { st.latch = st.sr } }
    },
    onClockBit(api, { data, clock, bit }) {
      if (api.boardPin('SRCLK') !== clock) return
      const ser = api.boardPin('SER') === data ? bit : api.level('SER')
      return shiftEdge(api, ser)
    },
    drives: (state) => ({ "QH'": ((state?.sr ?? 0) >> 7) & 1 }),
    solved(h, api) {
      const name = api.obj.name || '74HC595'
      const vs = api.vpin('VCC') - api.vpin('GND')
      const anyWired = NAMES.some(n => n !== 'VCC' && n !== 'GND' && api.connected(n))
      if (anyWired && vs < HC.VCC_MIN) api.issue('unpowered', 'warning', `${name} has no supply`, 'Wire pin 16 (VCC) to 5V and pin 8 (GND) to GND.')
      else api.clearIssue('unpowered')
      if (vs > HC.VCC_ABS) api.issue('overvoltage', 'error', `${name} has ${vs.toFixed(1)} V on VCC`, 'The 74HC595 is rated 2–6 V (7 V absolute maximum).')
      else api.clearIssue('overvoltage')
      const open = ['SRCLR', 'OE', 'SER', 'SRCLK', 'RCLK'].filter(n => !api.connected(n))
      if (anyWired && open.length) api.issue('floating', 'warning', `${name}: ${open.join(', ')} not connected`,
        'Floating CMOS inputs read at random. Tie SRCLR to 5V and OE to GND (or to pins), and wire SER/SRCLK/RCLK to the Arduino.')
      else api.clearIssue('floating')
      const v = (n) => api.v(n)
      let tot = 0, worst = 0
      for (let i = 0; i < 9; i++) { const I = Math.abs(h.el.outCurrent(i, v)); tot += I; worst = Math.max(worst, I) }
      if (worst > 0.035) api.issue('overcurrent', 'error', `${name} output carries ${(worst * 1000).toFixed(0)} mA`, 'Each 74HC595 output is rated ±35 mA absolute maximum. Use a 220 Ω+ resistor per LED.')
      else api.clearIssue('overcurrent')
      if (tot > 0.07) api.issue('supply', 'warning', `${name} supplies ${(tot * 1000).toFixed(0)} mA in total`, 'VCC/GND are rated 70 mA: with 8 LEDs lit use 470 Ω–1 kΩ resistors.')
      else api.clearIssue('supply')
      const st = stateOf(api.obj) ?? { sr: 0, latch: 0 }
      const q = h.el.state.q
      return { powered: vs >= HC.VCC_MIN, enabled: q[0] !== null, shift: st.sr, latch: st.latch, outputs: Q.map((_, i) => q[i]), current: tot }
    },
    readout: ({ solved }) => (solved ? `latch 0b${solved.latch.toString(2).padStart(8, '0')}${solved.enabled ? '' : ' (OE off)'}` : ''),
  },
  blockly: {
    blocks: [{
      type: 'part_shift_register_74hc595_shift_out',
      message0: 'shift out byte %1 to 74HC595 data %2 clock %3 latch %4',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'field_number', name: 'DATA', value: 11, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'CLOCK', value: 12, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'LATCH', value: 8, min: 0, max: 19, precision: 1 },
      ],
      inputsInline: true, previousStatement: null, nextStatement: null, colour: '#475569',
      tooltip: 'Latch LOW, shiftOut(data, clock, MSBFIRST, value), latch HIGH: bit 7 ends on QH, bit 0 on QA.',
    }],
    generators: {
      part_shift_register_74hc595_shift_out(block, gen, H) {
        const d = block.getFieldValue('DATA'), c = block.getFieldValue('CLOCK'), l = block.getFieldValue('LATCH')
        const v = gen.valueToCode(block, 'VALUE', H.Order.NONE) || '0'
        H.setup(gen, `hc595_${d}_${c}_${l}`, `pinMode(${d}, OUTPUT); pinMode(${c}, OUTPUT); pinMode(${l}, OUTPUT);`)
        return `digitalWrite(${l}, LOW);\nshiftOut(${d}, ${c}, MSBFIRST, ${v});\ndigitalWrite(${l}, HIGH);\n`
      },
    },
  },
  tests: [
    {
      name: 'end to end: shiftOut(MSBFIRST, 0b10110001) + latch lights exactly the LEDs on QA, QE, QF, QH',
      async run(kit, { runSketch }) {
        const spec = { U: 'arduino', S: 'shift_register_74hc595' }
        const wires = [['S:VCC', 'U:5V'], ['S:GND', 'U:GND1'], ['S:SRCLR', 'U:5V'], ['S:OE', 'U:GND2'],
          ['S:SER', 'U:D11'], ['S:SRCLK', 'U:D12'], ['S:RCLK', 'U:D8']]
        Q.forEach((q, i) => {
          spec[`R${i}`] = { type: 'resistor', resistance: 220 }; spec[`L${i}`] = 'led'
          wires.push([`S:${q}`, `R${i}:1`], [`R${i}:2`, `L${i}:ANODE`], [`L${i}:CATHODE`, 'U:GND3'])
        })
        kit.scene(spec, wires)
        const s = runSketch(kit, `int dataPin = 11;
int clockPin = 12;
int latchPin = 8;
void setup() {
  pinMode(dataPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
  pinMode(latchPin, OUTPUT);
  digitalWrite(latchPin, LOW);
  shiftOut(dataPin, clockPin, MSBFIRST, 0b10110001);
  digitalWrite(latchPin, HIGH);
}
void loop() {
  delay(10);
}`)
        await s.run(150)
        s.stop()
        // MSBFIRST: bit 7 is shifted in first and ends on QH; bit 0 ends on QA.
        // 0b10110001 → QA=1 QB=0 QC=0 QD=0 QE=1 QF=1 QG=0 QH=1
        const want = [1, 0, 0, 0, 1, 1, 0, 1]
        want.forEach((on, i) => {
          // (5 − 1.9 V) / (220 + 30 + 8 Ω) ≈ 12 mA → ≈150 of 255
          if (on) kit.between(kit.led[`L${i}`], 110, 200, `LED on ${Q[i]}`)
          else kit.ok(!(kit.led[`L${i}`] > 0), `LED on ${Q[i]} dark`)
        })
        kit.equal(kit.state('S').latch, 0b10110001, 'latched byte')
        kit.ok(!kit.hasIssue('S:'), 'no issues (4 LEDs ≈ 48 mA < 70 mA)')
      },
    },
    {
      name: 'bit-banged SRCLK/RCLK edges shift and latch; nothing shows before RCLK ↑',
      run(kit) {
        kit.scene({ U: 'arduino', S: 'shift_register_74hc595' }, [['S:VCC', 'U:5V'], ['S:GND', 'U:GND1'], ['S:SRCLR', 'U:5V'], ['S:OE', 'U:GND2'],
          ['S:SER', 'U:D11'], ['S:SRCLK', 'U:D12'], ['S:RCLK', 'U:D8']])
        ;[11, 12, 8].forEach(p => { kit.pinMode(p, 'output'); kit.write(p, 0) })
        for (const b of [0, 1, 0, 1, 0, 1, 1, 0]) { kit.write(11, b); kit.write(12, 1); kit.write(12, 0) }   // 0b01010110
        kit.step(0.02)
        Q.forEach(q => kit.near(kit.vpin('S', q), 0, 0.01, `${q} still 0 before latch`))
        kit.write(8, 1); kit.write(8, 0); kit.step(0.02)
        Q.forEach((q, i) => kit.near(kit.vpin('S', q), (0b01010110 >> i) & 1 ? 5 : 0, 0.01, `${q} after latch`))
      },
    },
    {
      name: "daisy chain: QH' → second chip's SER, two shiftOut bytes land on the right chips",
      run(kit) {
        kit.scene({ U: 'arduino', S1: 'shift_register_74hc595', S2: 'shift_register_74hc595' }, [
          ['S1:VCC', 'U:5V'], ['S1:GND', 'U:GND1'], ['S1:SRCLR', 'U:5V'], ['S1:OE', 'U:GND2'],
          ['S2:VCC', 'U:5V'], ['S2:GND', 'U:GND1'], ['S2:SRCLR', 'U:5V'], ['S2:OE', 'U:GND2'],
          ['S1:SER', 'U:D11'], ['S1:SRCLK', 'U:D12'], ['S2:SRCLK', 'U:D12'], ['S1:RCLK', 'U:D8'], ['S2:RCLK', 'U:D8'],
          ["S1:QH'", 'S2:SER'],
        ])
        ;[11, 12, 8].forEach(p => { kit.pinMode(p, 'output'); kit.write(p, 0) })
        kit.shiftOut(11, 12, 'MSB', 0xA5)                     // pushed on into the second chip
        kit.shiftOut(11, 12, 'MSB', 0x3C)                     // stays in the first chip
        kit.write(8, 1); kit.write(8, 0); kit.step(0.02)
        kit.equal(kit.state('S1').latch, 0x3C, 'first chip')
        kit.equal(kit.state('S2').latch, 0xA5, 'second chip')
        Q.forEach((q, i) => {
          kit.near(kit.vpin('S1', q), (0x3C >> i) & 1 ? 5 : 0, 0.01, `S1 ${q}`)
          kit.near(kit.vpin('S2', q), (0xA5 >> i) & 1 ? 5 : 0, 0.01, `S2 ${q}`)
        })
      },
    },
    {
      name: 'OE high turns the outputs off (high-Z); SRCLR low clears the shift register',
      run(kit) {
        kit.scene({ U: 'arduino', S: 'shift_register_74hc595', R: { type: 'resistor', resistance: 220 }, L: 'led' }, [
          ['S:VCC', 'U:5V'], ['S:GND', 'U:GND1'], ['S:SRCLR', 'U:D10'], ['S:OE', 'U:D9'],
          ['S:SER', 'U:D11'], ['S:SRCLK', 'U:D12'], ['S:RCLK', 'U:D8'], ['S:QA', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2']])
        ;[11, 12, 8, 9, 10].forEach(p => kit.pinMode(p, 'output'))
        kit.write(10, 1); kit.write(9, 0)
        kit.shiftOut(11, 12, 'MSB', 0xFF); kit.write(8, 1); kit.write(8, 0); kit.step(0.05)
        kit.ok(kit.led.L > 110, 'QA LED lit')
        kit.write(9, 1); kit.step(0.05)
        kit.ok(!(kit.led.L > 0), 'OE high → LED off')
        kit.near(kit.vpin('S', 'QB'), 0, 0.01, 'QB floating (high-Z)')
        kit.near(kit.vpin('S', "QH'"), 5, 0.01, "QH' is not disabled by OE")
        kit.write(9, 0); kit.write(10, 0); kit.step(0.02); kit.write(10, 1)
        kit.write(8, 1); kit.write(8, 0); kit.step(0.05)
        kit.equal(kit.state('S').latch, 0, 'cleared register latched as 0')
        kit.ok(!(kit.led.L > 0), 'LED off after clear')
      },
    },
  ],
})
