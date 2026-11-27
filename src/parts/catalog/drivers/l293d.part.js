// L293D quadruple half-H driver (Tinkercad "H-bridge Motor Driver L293D").
// DIP-16, TI L293D pinout:
//   1 EN1,2 · 2 1A · 3 1Y · 4 GND · 5 GND · 6 2Y · 7 2A · 8 VCC2 (motor supply)
//   9 EN3,4 · 10 3A · 11 3Y · 12 GND · 13 GND · 14 4Y · 15 4A · 16 VCC1 (logic 5 V)
// The four GND pins are the copper heat-sink frame: one net inside the part.
//
// Output stage (datasheet, IO = ±0.6 A): VOH = VCC2 − 1.4 V typ, VOL = 1.2 V typ.
// Modelled as Darlington/saturation drops of 1.1 V (high) and 0.9 V (low) plus
// 0.5 Ω each, so at 0.6 A the drops are 1.4 V / 1.2 V. Output current comes out
// of VCC2 and returns through GND. Disabled (EN low) → high-impedance. The
// internal clamp diodes (L293D "D") go from GND to Y and from Y to VCC2.
//
// PWM: the solver sees a PWM pin as its average voltage. An input's duty is read
// as V(in)/V(VCC1) (≥ 0.9 → fully HIGH, ≤ 0.05 → LOW); the output then sits at
// the duty-weighted average of its HIGH and LOW levels, which is what a motor
// integrates. (Limitation: 3.3 V logic on a 5 V VCC1 reads as 66 % duty.)
import { definePart } from '../../definePart.js'
import { diode } from '../../../circuit/mna.js'
import { dipPins } from '../../model.js'
import { dipBuild, dipDims } from '../logic/cmos.js'
import { benchSupply } from '../ics/bench.js'

const NAMES = ['EN12', '1A', '1Y', 'GND1', 'GND2', '2Y', '2A', 'VCC2', 'EN34', '3A', '3Y', 'GND3', 'GND4', '4Y', '4A', 'VCC1']
const LABELS = { EN12: 'EN1,2', EN34: 'EN3,4', GND1: 'GND', GND2: 'GND', GND3: 'GND', GND4: 'GND' }
const KINDS = Object.fromEntries(NAMES.map(n => [n, /^VCC/.test(n) ? 'power' : /^GND/.test(n) ? 'gnd' : 'digital']))
const CH = [['EN12', '1A', '1Y'], ['EN12', '2A', '2Y'], ['EN34', '3A', '3Y'], ['EN34', '4A', '4Y']]
const DROP_HI = 1.1, DROP_LO = 0.9, R_OUT = 0.5
const I_CONT = 0.6, I_PEAK = 1.2

/** Duty 0…1 of an input from its (averaged) voltage. */
function dutyOf(v, vlogic) {
  const d = vlogic > 0 ? v / vlogic : 0
  return d >= 0.9 ? 1 : d <= 0.05 ? 0 : Math.min(1, d)
}

/** One half-H channel: output Y between VCC2 and GND, controlled by EN and A. */
function halfH(en, a, y, vcc1, vcc2, gnd) {
  const el = {
    kind: 'HALFH', nodes: [en, a, y, vcc1, vcc2, gnd], nonlinear: true,
    k: null,
    eval(v) {
      const vl = v(vcc1) - v(gnd)
      if (vl < 4.5) return null                             // logic supply missing → outputs off
      const de = dutyOf(v(en) - v(gnd), vl)
      if (de <= 0) return null                               // disabled → high-Z
      return de * dutyOf(v(a) - v(gnd), vl)                  // fraction of time Y is HIGH
    },
    stamp(sys, ctx, e) {
      const k = e.eval(ctx.v)
      if (k == null) return
      const g = 1 / R_OUT
      // High side: k·g from VCC2 with drop; low side: (1−k)·g to GND with drop.
      // Open-circuit Y = k·(VCC2 − 1.1) + (1 − k)·(GND + 0.9), source resistance 0.5 Ω.
      if (k > 0) { sys.conductance(y, vcc2, k * g); sys.current(y, vcc2, k * g * DROP_HI) }
      if (k < 1) { sys.conductance(y, gnd, (1 - k) * g); sys.current(gnd, y, (1 - k) * g * DROP_LO) }
    },
    update(ctx, e) { e.k = e.eval(ctx.v) },
    /** Current out of Y into the load (A). */
    out(v) {
      const k = el.k
      if (k == null) return 0
      const g = 1 / R_OUT
      return k * g * (v(vcc2) - DROP_HI - v(y)) - (1 - k) * g * (v(y) - v(gnd) - DROP_LO)
    },
  }
  return el
}

export default definePart({
  type: 'motor_driver_l293d',
  label: 'H-bridge Motor Driver L293D',
  shortName: 'L293D',
  tinkercad: 'H-bridge Motor Driver L293D',
  category: 'drivers',
  icon: '⇄',
  desc: 'Dual H-bridge · DIP-16 · 600 mA per channel · 4.5–36 V motors',
  purpose: 'Drives two DC motors forwards and backwards. VCC1 (16) = 5V logic, VCC2 (8) = motor supply (4.5–36 V), all four GND pins to GND. ' +
    'Motor between 1Y (3) and 2Y (6). 1A (2) HIGH / 2A (7) LOW = forward, swapped = reverse, both the same = brake. ' +
    'EN1,2 (1) HIGH enables the pair; analogWrite() on EN sets the speed. Expect ≈2.6 V lost in the bridge.',
  usage: 'robot cars · two-motor drive · small steppers · solenoids',
  spec: {
    dims_mm: dipDims(16), mass_kg: 0.0015, vcc1: '4.5–7 V', vcc2: '4.5–36 V', iout_A: 0.6, ipeak_A: 1.2,
    summary: 'Per channel 600 mA continuous, 1.2 A peak. VOH = VCC2 − 1.4 V, VOL = 1.2 V at 0.6 A. Built-in clamp diodes. Inputs TTL (VIH 2.3 V).',
  },
  pins: dipPins(NAMES, { kinds: KINDS }).map(p => ({ ...p, label: LABELS[p.name] ?? p.name })),
  internal: [['GND1', 'GND2', 'GND3', 'GND4']],
  groundPin: 'GND1',
  build: () => dipBuild(16, 'L293D'),
  sim: {
    circuit(api) {
      const P = Object.fromEntries(NAMES.map(n => [n, api.pin(n)]))
      const ch = CH.map(([en, a, y]) => {
        const el = api.add(halfH(P[en], P[a], P[y], P.VCC1, P.VCC2, P.GND1))
        api.add(diode(P.GND1, P[y], { Is: 1e-12 }))         // clamp diode to GND
        api.add(diode(P[y], P.VCC2, { Is: 1e-12 }))         // clamp diode to VCC2
        return el
      })
      return { ch }
    },
    solved(h, api) {
      const name = api.obj.name || 'L293D'
      const g = api.vpin('GND1'), v1 = api.vpin('VCC1') - g, v2 = api.vpin('VCC2') - g
      const anyWired = NAMES.some(n => !/^(VCC|GND)/.test(n) && api.connected(n))
      if (anyWired && v1 < 4.5) api.issue('unpowered', 'warning', `${name}: VCC1 (pin 16) is ${v1.toFixed(1)} V`, 'Wire VCC1 to the Arduino 5V: without logic power every output is off.')
      else api.clearIssue('unpowered')
      if (anyWired && v1 >= 4.5 && v2 < 4.5) api.issue('nomotor', 'warning', `${name}: VCC2 (pin 8) is ${v2.toFixed(1)} V`, 'VCC2 is the motor supply (4.5–36 V). Wire a battery pack + to it.')
      else api.clearIssue('nomotor')
      if (v2 > 36 || v1 > 7) api.issue('overvoltage', 'error', `${name} supply too high (VCC1 ${v1.toFixed(1)} V, VCC2 ${v2.toFixed(1)} V)`, 'VCC1 is rated 4.5–7 V, VCC2 up to 36 V.')
      else api.clearIssue('overvoltage')
      const v = (n) => api.v(n)
      const I = h.ch.map(c => c.out(v))
      const worst = Math.max(...I.map(Math.abs))
      if (worst > I_PEAK) api.issue('overcurrent', 'error', `${name} channel carries ${worst.toFixed(2)} A`, 'The L293D is rated 1.2 A peak per channel; its thermal shutdown would trip. Use a smaller motor or an L298N.')
      else if (worst > I_CONT) api.issue('overcurrent', 'warning', `${name} channel carries ${worst.toFixed(2)} A`, 'Above the 600 mA continuous rating — fine for a start-up surge, not for continuous running.')
      else api.clearIssue('overcurrent')
      return { vcc1: v1, vcc2: v2, outputs: CH.map(([, , y], i) => ({ pin: y, k: h.ch[i].k, v: api.vpin(y) - g, i: I[i] })), current: I }
    },
    readout: ({ solved }) => (solved ? solved.outputs.map(o => `${o.pin} ${o.k == null ? 'Z' : o.v.toFixed(1) + 'V'}`).join(' · ') : ''),
  },
  blockly: {
    blocks: [{
      type: 'part_motor_driver_l293d_drive',
      message0: 'L293D motor EN %1 A %2 B %3 %4 speed %5',
      args0: [
        { type: 'field_number', name: 'EN', value: 9, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'IN1', value: 7, min: 0, max: 19, precision: 1 },
        { type: 'field_number', name: 'IN2', value: 8, min: 0, max: 19, precision: 1 },
        { type: 'field_dropdown', name: 'DIR', options: [['forward', 'FWD'], ['reverse', 'REV'], ['brake', 'BRAKE'], ['coast', 'COAST']] },
        { type: 'input_value', name: 'SPEED', check: 'Number' },
      ],
      inputsInline: true, previousStatement: null, nextStatement: null, colour: '#f59e0b',
      tooltip: 'Sets the two direction inputs of one L293D channel pair and the enable PWM (0–255; use a PWM pin for EN).',
    }],
    generators: {
      part_motor_driver_l293d_drive(block, gen, H) {
        const en = block.getFieldValue('EN'), a = block.getFieldValue('IN1'), b = block.getFieldValue('IN2'), dir = block.getFieldValue('DIR')
        const sp = gen.valueToCode(block, 'SPEED', H.Order.NONE) || '0'
        H.setup(gen, `l293d_${en}_${a}_${b}`, `pinMode(${en}, OUTPUT); pinMode(${a}, OUTPUT); pinMode(${b}, OUTPUT);`)
        const [va, vb] = { FWD: ['HIGH', 'LOW'], REV: ['LOW', 'HIGH'], BRAKE: ['HIGH', 'HIGH'], COAST: ['LOW', 'LOW'] }[dir] ?? ['LOW', 'LOW']
        const enLine = dir === 'COAST' ? `analogWrite(${en}, 0);` : dir === 'BRAKE' ? `analogWrite(${en}, 255);` : `analogWrite(${en}, ${sp});`
        return `digitalWrite(${a}, ${va});\ndigitalWrite(${b}, ${vb});\n${enLine}\n`
      },
    },
  },
  tests: (() => {
    // Motor (8 Ω armature) between 1Y and 2Y, VCC2 = 6 V bench supply (4 × AA), VCC1 = Arduino 5V.
    const scene = (kit) => {
      kit.scene({ U: 'arduino', D: 'motor_driver_l293d', M: 'motor_dc' }, [
        ['D:VCC1', 'U:5V'], ['D:GND1', 'U:GND1'], ['D:EN12', 'U:D9'], ['D:1A', 'U:D7'], ['D:2A', 'U:D8'],
        ['D:1Y', 'M:TERM_A'], ['D:2Y', 'M:TERM_B'],
      ])
      benchSupply(kit, 'D:VCC2', 6)
      ;[7, 8, 9].forEach(p => kit.pinMode(p, 'output'))
    }
    // Forward: Vm = (6 − 1.1 − 0.9) − I·(0.5 + 0.5), I = Vm / 8 Ω → Vm = 4 / (9/8) = 3.556 V, I = 0.444 A
    // motor_dc speed = Vm / 6 V · 255 = 151
    const VM = 4 / (9 / 8)
    return [
      {
        name: 'forward / reverse / brake: motor sees ≈3.56 V of a 6 V supply (2 × saturation drops)',
        run(kit) {
          scene(kit)
          kit.write(9, 1); kit.write(7, 1); kit.write(8, 0); kit.step(0.05)
          kit.near(kit.motor.M, Math.round(VM / 6 * 255), 4, 'forward speed')
          kit.near(kit.vpin('D', '1Y') - kit.vpin('D', '2Y'), VM, 0.05, 'motor voltage')
          kit.near(kit.state('D').current[0], VM / 8, 0.01, '1Y current ≈ 0.44 A')
          // VOH = 6 − 1.1 − 0.444·0.5 = 4.68 V (drop 1.32 V), VOL = 0.9 + 0.22 = 1.12 V
          kit.near(kit.vpin('D', '1Y'), 6 - 1.1 - 0.5 * VM / 8, 0.03, 'VOH')
          kit.near(kit.vpin('D', '2Y'), 0.9 + 0.5 * VM / 8, 0.03, 'VOL')
          kit.write(7, 0); kit.write(8, 1); kit.step(0.05)
          kit.near(kit.motor.M, -Math.round(VM / 6 * 255), 4, 'reverse speed')
          kit.write(7, 1); kit.step(0.05)
          kit.near(kit.motor.M, 0, 1, 'both HIGH = brake')
          kit.ok(!kit.hasIssue('D:'), 'no issues at 0.44 A')
        },
      },
      {
        name: 'EN low: outputs high-impedance, motor stops',
        run(kit) {
          scene(kit)
          kit.write(9, 0); kit.write(7, 1); kit.write(8, 0); kit.step(0.05)
          kit.near(kit.motor.M, 0, 1, 'disabled')
          kit.equal(kit.state('D').outputs[0].k, null, '1Y is high-Z')
        },
      },
      {
        name: 'PWM on EN (analogWrite 128) roughly halves the motor voltage',
        run(kit) {
          scene(kit)
          kit.write(7, 1); kit.write(8, 0); kit.analogWrite(9, 128); kit.step(0.05)
          // EN really switches at 490 Hz, so the motor sees the full drive for half of each
          // cycle: averaged Vm = duty · (full-on Vm). Full on: Voc(1Y) − VOL0 = 4 V → Vm = 4/(9/8) = 3.56 V;
          // sampled over 16 PWM phases, duty 128/255 resolves to 8/16 = 0.5 → Vm ≈ 1.78 V → speed ≈ 76.
          // (The instantaneous pin voltage at the end of a frame is HIGH or LOW — read the averaged state.)
          const vm = 0.5 * 4 / (9 / 8)
          kit.near(kit.state('M').voltage, vm, 0.05, 'averaged motor voltage')
          kit.near(kit.motor.M, Math.round(vm / 6 * 255), 4, 'half speed')
        },
      },
      {
        name: 'no logic supply (VCC1 open) → outputs off and an issue',
        run(kit) {
          kit.scene({ U: 'arduino', D: 'motor_driver_l293d', M: 'motor_dc' }, [
            ['D:GND1', 'U:GND1'], ['D:EN12', 'U:5V'], ['D:1A', 'U:5V'], ['D:2A', 'U:GND2'], ['D:1Y', 'M:TERM_A'], ['D:2Y', 'M:TERM_B']])
          benchSupply(kit, 'D:VCC2', 6)
          kit.step(0.05)
          kit.near(kit.motor.M, 0, 1, 'motor still')
          kit.ok(kit.hasIssue('D:unpowered'), 'unpowered issue')
        },
      },
      {
        name: 'end to end: a sketch drives the motor forward then reverse',
        async run(kit, { runSketch }) {
          scene(kit)
          const s = runSketch(kit, `void setup() {
  pinMode(9, OUTPUT); pinMode(7, OUTPUT); pinMode(8, OUTPUT);
  digitalWrite(7, HIGH); digitalWrite(8, LOW); analogWrite(9, 255);
}
void loop() { delay(10); }`)
          await s.run(120)
          kit.near(kit.motor.M, Math.round(VM / 6 * 255), 4, 'forward from the sketch')
          s.stop()
        },
      },
    ]
  })(),
})
