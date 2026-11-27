// Analog Devices TMP36 temperature sensor, TO-92 (Tinkercad "Temperature Sensor
// [TMP36]"). Datasheet: Vout = 0.5 V + 10 mV/°C (750 mV at 25 °C), −40…+125 °C,
// supply 2.7–5.5 V, quiescent current < 50 µA, absolute max +7 V. Pins with the
// flat face toward you: 1 +Vs, 2 Vout, 3 GND. Leads formed to 2.54 mm.
// Model: Vout is a source (≈100 Ω output resistance) that is live only while
// +Vs − GND is within the operating range; 100 kΩ quiescent load (50 µA at 5 V);
// a substrate diode GND → +Vs conducts (and overheats the part) when reversed.
import { Group, CylinderGeometry, Mesh } from 'three'
import { definePart } from '../../definePart.js'
import { vsource, resistor, addDiode } from '../../../circuit/mna.js'
import { mat, box, at, lead, textPlane } from '../../model.js'

const P = 0.254, LEG = 0.5, BR = 0.23, BH = 0.46, FLAT = 0.13
export const vOutAt = (tC) => 0.5 + 0.01 * tC

export default definePart({
  type: 'tmp36',
  label: 'Temperature Sensor TMP36',
  shortName: 'TMP',
  tinkercad: 'Temperature Sensor [TMP36]',
  category: 'sensors',
  icon: '🌡',
  desc: 'TMP36 · 0.5 V + 10 mV/°C · −40…125 °C',
  purpose: 'Outputs a voltage that rises 10 mV per °C (0.75 V at 25 °C). With the flat face toward you: left leg +Vs to 5 V, middle Vout to A0, right GND. In code: voltage = analogRead(A0) × 5.0 / 1024; °C = (voltage − 0.5) × 100. Set the temperature in the sim bar.',
  usage: 'thermometers · thermostats · over-temperature alarms',
  spec: { dims_mm: { w: 5.6, h: 9.6, d: 3.6 }, mass_kg: 0.0002, supply_V: '2.7–5.5', absMax_V: 7, Iq_A: 50e-6, range_C: '−40…125', accuracy_C: 2,
    summary: 'Vout = 0.5 V + 10 mV/°C. Pin 1 +Vs, 2 Vout, 3 GND (flat face toward you).' },
  pins: [
    { name: '+Vs', kind: 'power', x: -P, y: 0.02, z: 0, r: 0.06 },
    { name: 'Vout', kind: 'analog', x: 0, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
    { name: 'GND', kind: 'gnd', x: P, y: 0.02, z: 0, r: 0.06 },
  ],
  build() {
    const g = new Group()
    for (const [i, s] of [[0, -1], [1, 0], [2, 1]]) {
      void i
      g.add(lead([s * 0.127, LEG + 0.02, 0], [s * P, 0.3, 0], { r: 0.025 }))
      g.add(lead([s * P, 0.3, 0], [s * P, 0, 0], { r: 0.025 }))
    }
    const black = mat(0x1c1c1c, { rough: 0.75 })
    // D-shaped TO-92: rounded back (−Z), flat front face (+Z).
    const back = new Mesh(new CylinderGeometry(BR, BR, BH, 24, 1, false, Math.PI / 2, Math.PI), black)
    g.add(at(back, 0, LEG + BH / 2, 0))
    g.add(box(BR * 2, BH, FLAT, black, 0, LEG + BH / 2, FLAT / 2))
    const t = textPlane('TMP36', 0.4, 0.1, { fg: '#cfd2d6', bg: null })
    if (t) g.add(at(t, 0, LEG + BH * 0.6, FLAT + 0.002))
    return g
  },
  sim: {
    controls: [{ key: 'temp', kind: 'slider', label: 'Temperature', min: -40, max: 125, step: 1, unit: '°C', default: 25 }],
    circuit(api) {
      const vs = api.pin('+Vs'), out = api.pin('Vout'), gnd = api.pin('GND')
      return {
        out: api.add(vsource(out, gnd, 0, 100)),
        iq: api.add(resistor(vs, gnd, 100e3)),
        sub: addDiode(api, gnd, vs, { Rs: 5 }),
      }
    },
    beforeStep(h, api) {
      const vs = api.vpin('+Vs') - api.vpin('GND')
      const t = Math.max(-40, Math.min(125, Number(api.control('temp') ?? 25)))
      h.out.V = vs >= 2.7 ? Math.min(vOutAt(t), vs - 0.1) : 0
    },
    solved(h, api) {
      const vs = api.vpin('+Vs') - api.vpin('GND')
      const vout = api.vpin('Vout') - api.vpin('GND')
      const t = Number(api.control('temp') ?? 25)
      if (vs < -0.3) api.issue('reversed', 'error', `${api.obj.name} is wired backwards`,
        'GND is more positive than +Vs: current flows through the chip and it gets dangerously hot (a classic TMP36 mistake). With the flat face toward you, the LEFT leg is +Vs.')
      else api.clearIssue('reversed')
      if (vs > 7) api.issue('overvoltage', 'error', `${api.obj.name}: ${vs.toFixed(1)} V supply`, 'Absolute maximum is 7 V.')
      else if (vs > 5.5) api.issue('overvoltage', 'warning', `${api.obj.name}: ${vs.toFixed(1)} V supply`, 'The TMP36 is specified for 2.7–5.5 V.')
      else api.clearIssue('overvoltage')
      if (vs > 0.3 && vs < 2.7) api.issue('undervoltage', 'warning', `${api.obj.name} has only ${vs.toFixed(2)} V`, 'Below 2.7 V the TMP36 does not work; its output stays near 0 V.')
      else api.clearIssue('undervoltage')
      return { supply: vs, vout, temperature: t, powered: vs >= 2.7 && vs <= 7 }
    },
    readout({ solved }) { return solved ? `${solved.vout.toFixed(3)} V` : null },
  },
  code: {
    example: `// TMP36: +Vs to 5V, Vout to A0, GND to GND
void setup() {
  Serial.begin(9600);
}
void loop() {
  int reading = analogRead(A0);
  float voltage = reading * 5.0 / 1024.0;
  float temperatureC = (voltage - 0.5) * 100;
  Serial.println(temperatureC);
  delay(500);
}`,
  },
  blockly: {
    blocks: [{
      type: 'part_tmp36_celsius',
      message0: 'TMP36 temperature °C on pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map(p => [p, p]) }],
      output: 'Number', colour: '#14b8a6',
      tooltip: 'Reads a TMP36 powered from 5 V: (analogRead × 5 / 1024 − 0.5) × 100.',
    }],
    generators: {
      part_tmp36_celsius(block, gen, H) {
        return [`((analogRead(${block.getFieldValue('PIN')}) * 5.0 / 1024.0 - 0.5) * 100.0)`, H.Order.MULTIPLICATIVE]
      },
    },
  },
  tests: [
    {
      name: 'Vout = 0.5 V + 10 mV/°C on A0: 25 °C → 0.75 V, −40 °C → 0.10 V, 125 °C → 1.75 V',
      run(kit) {
        kit.scene({ U: 'arduino', T: 'tmp36' }, [['T:+Vs', 'U:5V'], ['T:Vout', 'U:A0'], ['T:GND', 'U:GND1']])
        kit.step(0.05)
        kit.near(kit.pinVoltage(14), 0.75, 0.002, '25 °C'); kit.near(kit.analogRead(14), 153, 1)
        kit.control('T', 'temp', -40); kit.step(0.05)
        kit.near(kit.pinVoltage(14), 0.10, 0.002, '−40 °C')
        kit.control('T', 'temp', 125); kit.step(0.05)
        kit.near(kit.pinVoltage(14), 1.75, 0.002, '125 °C')
        kit.ok(!kit.hasIssue('T:'), 'no issues when wired correctly')
      },
    },
    {
      name: 'end to end: the standard sketch formula prints ≈24.7 °C at 25 °C',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', T: 'tmp36' }, [['T:+Vs', 'U:5V'], ['T:Vout', 'U:A0'], ['T:GND', 'U:GND1']])
        const s = runSketch(kit, `void setup() { Serial.begin(9600); }
void loop() {
  int reading = analogRead(A0);
  float voltage = reading * 5.0 / 1024.0;
  float temperatureC = (voltage - 0.5) * 100;
  Serial.println(temperatureC);
  delay(20);
}`)
        await s.run(150)
        // 0.75 V → round(0.75/5 × 1023) = 153 → 153 × 5/1024 = 0.7471 V → 24.71 °C
        // (the /1024 vs /1023 and 10-bit step put it 0.3 °C low, as on a real Uno).
        kit.near(Number(s.out[s.out.length - 1]), 24.707, 0.05, '°C')
        kit.control('T', 'temp', 60)
        await s.run(150)
        // 1.10 V → 225 → 1.0986 V → 59.86 °C.
        kit.near(Number(s.out[s.out.length - 1]), 59.86, 0.05, '°C at 60')
        s.stop()
      },
    },
    {
      name: 'works from 3.3 V (in its 2.7–5.5 V range)',
      run(kit) {
        kit.scene({ U: 'arduino', T: 'tmp36' }, [['T:+Vs', 'U:3V3'], ['T:Vout', 'U:A0'], ['T:GND', 'U:GND1']])
        kit.control('T', 'temp', 30); kit.step(0.05)
        kit.near(kit.pinVoltage(14), 0.80, 0.002)
      },
    },
    {
      name: 'unpowered from a pin below 2.7 V reads ≈0 and warns; reversed supply is an error',
      run(kit) {
        // +Vs from a 2 V divider (5 V, 1.5k / 1k) → under-voltage.
        kit.scene({ U: 'arduino', T: 'tmp36', R1: { type: 'resistor', resistance: 1500 }, R2: { type: 'resistor', resistance: 1000 } },
          [['R1:1', 'U:5V'], ['R1:2', 'T:+Vs'], ['R2:1', 'T:+Vs'], ['R2:2', 'U:GND1'], ['T:Vout', 'U:A0'], ['T:GND', 'U:GND2']])
        kit.step(0.05)
        kit.near(kit.pinVoltage(14), 0, 0.01, 'no output'); kit.ok(kit.hasIssue('T:undervoltage'))
        kit.scene({ U: 'arduino', T: 'tmp36' }, [['T:GND', 'U:5V'], ['T:Vout', 'U:A0'], ['T:+Vs', 'U:GND1']])
        kit.step(0.05)
        kit.ok(kit.hasIssue('T:reversed'), 'reversed supply')
      },
    },
  ],
})
