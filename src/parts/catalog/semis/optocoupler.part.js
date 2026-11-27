// 4N35 phototransistor optocoupler, DIP-6 (Tinkercad "Optocoupler").
// Vishay 4N35 datasheet: pin 1 anode, 2 cathode, 3 NC, 4 emitter, 5 collector,
// 6 base. Input IR LED: V_F 1.3 V typ / 1.5 V max at 10 mA (≈1.2 V at 10 mA
// on the typical curve), I_F 60 mA max, V_R 6 V max. Output: V_CEO 70 V,
// I_C 50 mA (abs. max), CTR ≥ 100 % at I_F = 10 mA, V_CE = 10 V;
// V_CE(sat) ≤ 0.3 V at I_C = 0.5 mA, I_F = 10 mA. Isolation 5000 V_RMS.
// Package: 300 mil DIP-6, body 8.5 × 6.5 × 3.4 mm.
//
// Circuit model: LED = diode (n = 1.8, V_F 1.2 V at 10 mA, Rs 1 Ω). The
// phototransistor is an Ebers-Moll NPN (β = 400) whose collector–base
// photocurrent is I_F·CTR/β, so in the active region I_C = CTR·I_F (100 %).
// The photocurrent follows the LED current of the previous solver step.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { addDiode, bjt, isource } from '../../../circuit/mna.js'
import { mat, box, cyl, at, textPlane, dipPins, dipPinXZ, TIN, fmtSI } from '../../model.js'

const CTR = 1.0, BETA = 400
const LED = { Is: 0.01 / Math.exp((1.2 - 0.01) / (1.8 * 0.025852)), n: 1.8, Rs: 1 }
const NAMES = ['ANODE', 'CATHODE', 'NC', 'EMITTER', 'COLLECTOR', 'BASE']
const LIFT = 0.33, BODY_H = 0.34, BODY_L = 0.85, BODY_D = 0.65

export default definePart({
  type: 'optocoupler',
  label: 'Optocoupler',
  shortName: 'U',
  tinkercad: 'Optocoupler',
  category: 'semis',
  icon: '⇉',
  desc: '4N35 · DIP-6 · LED + phototransistor · CTR 100 %',
  purpose: 'Passes a signal by light, with no electrical connection between the two sides. Pins 1 (anode) and 2 (cathode) are an IR LED: drive it from a pin through ≈330 Ω (≈10 mA). Pins 5 (collector) and 4 (emitter) are a phototransistor that conducts up to ≈CTR × LED current: pull the collector up with 10 kΩ and it reads LOW when the LED is on.',
  usage: 'isolating a sketch from another supply · level shifting · noisy-input protection',
  spec: {
    dims_mm: { w: 8.5, h: 6.7, d: 7.9 }, mass_kg: 0.0005, ctr: '≥ 100 % at 10 mA', isolation_Vrms: 5000,
    summary: '4N35: 1 = anode, 2 = cathode, 4 = E, 5 = C, 6 = B. I_C ≈ CTR · I_F (100 % at 10 mA).',
  },
  pins: dipPins(NAMES, { kinds: { ANODE: 'passive', CATHODE: 'passive', NC: 'passive', EMITTER: 'passive', COLLECTOR: 'passive', BASE: 'passive' } }),
  build() {
    const g = new Group()
    g.add(box(BODY_L, BODY_H, BODY_D, mat(0x1c1c1c, { rough: 0.8 }), 0, LIFT + BODY_H / 2, 0))
    g.add(at(cyl(0.05, 0.02, mat(0x0a0a0a), { seg: 16 }), -BODY_L / 2 + 0.12, LIFT + BODY_H + 0.005, 0.18))  // pin-1 dot
    const t = textPlane('4N35', BODY_L * 0.7, 0.2, { fg: '#d1d5db', bg: null })
    if (t) { t.rotation.x = -Math.PI / 2; g.add(at(t, 0, LIFT + BODY_H + 0.004, 0)) }
    for (let pin = 1; pin <= 6; pin++) {
      const { x, z } = dipPinXZ(6, pin)
      const sgn = z > 0 ? 1 : -1
      g.add(box(0.12, 0.04, 0.1, TIN(), x, LIFT + 0.1, sgn * (BODY_D / 2 + 0.03)))            // shoulder
      g.add(box(0.05, LIFT + 0.1, 0.025, TIN(), x, (LIFT + 0.1) / 2, z + sgn * 0.0))           // leg to y = 0
    }
    return g
  },
  sim: {
    circuit(api) {
      const led = addDiode(api, api.pin('ANODE'), api.pin('CATHODE'), LED)
      const C = api.pin('COLLECTOR'), B = api.pin('BASE'), E = api.pin('EMITTER')
      const q = api.add(bjt(C, B, E, { Is: 1e-14, bf: BETA, br: 1 }))
      const iph = api.add(isource(C, B, 0))
      return { led, q, iph }
    },
    beforeStep(h, api) {
      const iF = Math.max(0, api.cur(h.led))
      h.iph.I = iF * CTR / BETA
    },
    solved(h, api) {
      const iF = api.cur(h.led), ic = api.cur(h.q)
      const vf = api.vpin('ANODE') - api.vpin('CATHODE')
      const vce = api.vpin('COLLECTOR') - api.vpin('EMITTER')
      const name = api.obj.name || '4N35'
      if (iF > 0.06) api.issue('if', 'error', `${name} LED current is ${fmtSI(iF, 'A')}`,
        'The 4N35 input LED is rated 60 mA. Use a series resistor: R = (V − 1.2 V) / 10 mA (≈330 Ω from 5 V).')
      else api.clearIssue('if')
      if (-vf > 6) api.issue('vr', 'error', `${name} LED is reverse-biased by ${(-vf).toFixed(1)} V`, 'The input LED tolerates only 6 V reverse.')
      else api.clearIssue('vr')
      if (ic > 0.05) api.issue('ic', 'error', `${name} output current is ${fmtSI(ic, 'A')}`, 'The phototransistor is rated 50 mA collector current.')
      else api.clearIssue('ic')
      return { ledCurrent: iF, ledVoltage: vf, ic, vce, ctr: iF > 1e-6 ? ic / iF : 0, on: ic > 1e-4 }
    },
  },
  tests: [
    {
      name: 'CTR: 10.7 mA in the LED gives ≈10.7 mA collector current (active region, 100 Ω emitter resistor)',
      run(kit) {
        kit.scene({ U: 'arduino', O: 'optocoupler', RI: { type: 'resistor', resistance: 330 }, RE: { type: 'resistor', resistance: 100 } },
          [['U:D7', 'RI:1'], ['RI:2', 'O:ANODE'], ['O:CATHODE', 'U:GND1'], ['O:COLLECTOR', 'U:5V'], ['O:EMITTER', 'RE:1'], ['RE:2', 'U:GND2'], ['O:EMITTER', 'U:A0']])
        kit.pinMode(7, 'output'); kit.write(7, 1); kit.step(0.1)
        // I_F = (5 − 1.2 V) / (330 + 25 + 1 Ω) = 10.7 mA (V_F ≈ 1.2 V typ at 10 mA).
        const o = kit.state('O')
        kit.near(o.ledCurrent, 3.8 / 356, 0.2e-3, 'LED current')
        kit.between(o.ledVoltage, 1.15, 1.3, 'LED forward voltage')
        // CTR 100 % → I_C ≈ 10.7 mA (+0.25 % base share of I_E) → V(A0) = I_E · 100 Ω ≈ 1.07 V, V_CE ≈ 3.9 V (active).
        kit.near(o.ctr, 1.0, 0.03, 'current transfer ratio')
        kit.near(kit.pinVoltage(14), 1.07, 0.04, 'emitter voltage on A0')
        kit.write(7, 0); kit.step(0.1)
        kit.ok(kit.state('O').ic < 1e-6, 'dark: no output current')
      },
    },
    {
      name: 'end to end: a sketch drives the LED on D7 and reads the isolated output on D2 (10 kΩ pull-up)',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', O: 'optocoupler', RI: { type: 'resistor', resistance: 330 }, RP: { type: 'resistor', resistance: 10000 }, RL: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['U:D7', 'RI:1'], ['RI:2', 'O:ANODE'], ['O:CATHODE', 'U:GND1'], ['U:5V', 'RP:1'], ['RP:2', 'O:COLLECTOR'], ['O:COLLECTOR', 'U:D2'], ['O:EMITTER', 'U:GND2'],
            ['U:D13', 'RL:1'], ['RL:2', 'L:ANODE'], ['L:CATHODE', 'U:GND3']])
        const s = runSketch(kit, `void setup() {
  pinMode(7, OUTPUT);
  pinMode(2, INPUT);
  pinMode(13, OUTPUT);
  digitalWrite(7, LOW);
  delay(200);
  digitalWrite(7, HIGH);
}
void loop() {
  if (digitalRead(2) == LOW) { digitalWrite(13, HIGH); } else { digitalWrite(13, LOW); }
  delay(5);
}`)
        await s.run(120)
        kit.equal(kit.digitalRead(2), 1, 'LED off: the pull-up holds D2 HIGH')
        kit.ok(!(kit.led.L > 2), 'indicator off')
        await s.run(300)
        // I_F ≈ 10.7 mA can sink 10.7 mA ≫ (5 V / 10 kΩ = 0.5 mA) → saturated, V_CE(sat) ≤ 0.3 V.
        kit.ok(kit.state('O').vce < 0.3, `output saturated (V_CE = ${kit.state('O').vce.toFixed(3)} V)`)
        kit.equal(kit.digitalRead(2), 0, 'LED on: D2 reads LOW')
        kit.between(kit.led.L, 150, 185, 'indicator LED lit by the sketch')
        s.stop()
      },
    },
    {
      name: 'error when the input LED is driven without a resistor',
      run(kit) {
        kit.scene({ U: 'arduino', O: 'optocoupler' }, [['U:D7', 'O:ANODE'], ['O:CATHODE', 'U:GND1']])
        kit.pinMode(7, 'output'); kit.write(7, 1); kit.step(0.05)
        // (5 − ≈1.3 V) / (25 + 1 Ω) ≈ 0.14 A ≫ 60 mA.
        kit.ok(kit.state('O').ledCurrent > 0.06, 'LED current over 60 mA')
        kit.ok(kit.hasIssue('O:if'), 'LED over-current issue')
      },
    },
  ],
})
