// Parallax PING))) #28015 ultrasonic distance sensor (Tinkercad "Ultrasonic
// Distance Sensor (3-pin PING)"). Datasheet: 22 × 46 × 16 mm, 5 V DC ±10 %,
// 30 mA typ / 35 mA max, range 2 cm – 3 m, 3-pin header GND · 5V · SIG.
// Protocol: the host drives SIG HIGH ≥2 µs (5 µs typ) as the trigger, then makes
// SIG an input; the PING returns a HIGH echo whose width is the round-trip time
// of sound: 29.03 µs/cm each way at 343 m/s → width ≈ distance_cm × 58 µs
// (115 µs at 2 cm … 18.5 ms at 3 m). pulseIn(SIG, HIGH) reads it.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, PITCH, GOLD, BLACK, setGlow, textPlane } from '../../model.js'

const PCB_W = 4.57, PCB_H = 2.13, PCB_T = 0.16, PIN_L = 0.6, HDR = 0.25
const PCB_Y0 = PIN_L + HDR, CAN_R = 0.8, CAN_L = 1.2, CAN_X = 1.25
export const US_PER_CM = 58
export const RANGE_CM = [2, 300]

export default definePart({
  type: 'ping_sensor',
  label: 'Ultrasonic PING))) (3-pin)',
  shortName: 'PING',
  tinkercad: 'Ultrasonic Distance Sensor (3-pin PING)',
  category: 'sensors',
  icon: '📡',
  desc: 'Parallax 28015 · 2 cm–3 m · one SIG pin',
  purpose: 'Measures distance with an ultrasonic echo on ONE signal pin. Wire GND, 5V and SIG (to a digital pin). In code: pinMode(SIG, OUTPUT), pulse it HIGH for 5 µs, then pinMode(SIG, INPUT) and duration = pulseIn(SIG, HIGH); cm = duration / 29 / 2. Set the distance in the sim bar.',
  usage: 'obstacle avoidance · range finding · parking sensors',
  spec: { dims_mm: { w: 45.7, h: 29.8, d: 15.6 }, mass_kg: 0.009, supply_V: '4.5–5.5', current_mA: 30, range_cm: RANGE_CM, us_per_cm: US_PER_CM,
    summary: 'Echo width = 58 µs per cm of distance (round trip). Range 2–300 cm.' },
  pins: ['GND', '5V', 'SIG'].map((name, i) => ({ name, kind: name === 'GND' ? 'gnd' : name === '5V' ? 'power' : 'digital',
    x: (i - 1) * PITCH, y: 0.02, z: 0, r: 0.07, ldy: i % 2 ? 0.25 : 0 })),
  build() {
    const g = new Group()
    for (let i = 0; i < 3; i++) g.add(box(0.064, PIN_L + HDR + 0.1, 0.064, GOLD(), (i - 1) * PITCH, (PIN_L + HDR + 0.1) / 2, 0))
    g.add(box(3 * PITCH, HDR, PITCH, BLACK(), 0, PIN_L + HDR / 2, 0))                              // header plastic
    g.add(box(PCB_W, PCB_H, PCB_T, mat(0x1d4f91, { rough: 0.5 }), 0, PCB_Y0 + PCB_H / 2, 0))       // blue PCB
    const cy = PCB_Y0 + PCB_H / 2
    for (const s of [-1, 1]) {
      g.add(at(cyl(CAN_R, CAN_L, mat(0xb8bcc2, { metal: 0.85, rough: 0.35 }), { axis: 'z' }), s * CAN_X, cy, PCB_T / 2 + CAN_L / 2))
      g.add(at(cyl(CAN_R * 0.85, 0.01, mat(0x202020, { rough: 0.9 }), { axis: 'z' }), s * CAN_X, cy, PCB_T / 2 + CAN_L + 0.005))  // mesh
    }
    g.add(box(0.9, 0.5, 0.2, BLACK(), 0, cy - 0.2, -PCB_T / 2 - 0.1))                              // controller on the back
    const led = box(0.12, 0.08, 0.06, mat(0x1a4d1a, { emissive: 0x000000 }), 0, PCB_Y0 + PCB_H - 0.3, PCB_T / 2 + 0.03)
    led.name = 'act'
    g.add(led)
    const t = textPlane('PING)))', 1.2, 0.3, { fg: '#ffffff', bg: null })
    if (t) g.add(at(t, 0, PCB_Y0 + 0.45, PCB_T / 2 + 0.002))
    return g
  },
  sim: {
    controls: [{ key: 'distance', kind: 'slider', label: 'Distance', min: RANGE_CM[0], max: RANGE_CM[1], step: 1, unit: 'cm', default: 100 }],
    initState: () => ({ trig: 0 }),
    circuit(api) { return { load: api.add(resistor(api.pin('5V'), api.pin('GND'), 5 / 0.030)) } },
    solved(h, api) {
      const vs = api.vpin('5V') - api.vpin('GND')
      if (vs < -0.3) api.issue('reversed', 'error', `${api.obj.name} has 5V and GND swapped`, 'Reverse supply damages the PING))). Check the header labels: GND · 5V · SIG.')
      else api.clearIssue('reversed')
      if (vs > 6) api.issue('overvoltage', 'error', `${api.obj.name}: ${vs.toFixed(1)} V supply`, 'The PING))) runs on 5 V ±10 %.')
      else api.clearIssue('overvoltage')
      if (vs > 0.3 && vs < 4.5) api.issue('undervoltage', 'warning', `${api.obj.name} has only ${vs.toFixed(2)} V`, 'The PING))) needs 4.5–5.5 V (it does not work from 3.3 V): no echo comes back.')
      else api.clearIssue('undervoltage')
      return { supply: vs, powered: vs >= 4.5 && vs <= 6 }
    },
    // The trigger: a rising edge the sketch drives on the board pin SIG is wired to.
    onPin(api, { pin, level }) {
      if (level === 1 && pin === api.boardPin('SIG')) api.state.trig++
    },
    pulse(api) {
      const pin = api.boardPin('SIG')
      if (pin == null || !api.solved()?.powered || !api.state.trig) return {}
      const d = Math.max(RANGE_CM[0], Math.min(RANGE_CM[1], Number(api.control('distance') ?? 100)))
      return { [pin]: Math.round(d * US_PER_CM) }
    },
    visual(root, { solved, off }) {
      const led = root.getObjectByName('act')
      if (led) setGlow(led, 0x33ff55, !off && solved?.powered ? 0.6 : 0)
    },
  },
  code: {
    example: `// Parallax PING))): GND, 5V, SIG to pin 7
const int pingPin = 7;
void setup() {
  Serial.begin(9600);
}
void loop() {
  long duration, cm;
  pinMode(pingPin, OUTPUT);
  digitalWrite(pingPin, LOW);
  delayMicroseconds(2);
  digitalWrite(pingPin, HIGH);
  delayMicroseconds(5);
  digitalWrite(pingPin, LOW);
  pinMode(pingPin, INPUT);
  duration = pulseIn(pingPin, HIGH);
  cm = microsecondsToCentimeters(duration);
  Serial.println(cm);
  delay(100);
}
long microsecondsToCentimeters(long microseconds) {
  return microseconds / 29 / 2;
}`,
  },
  blockly: {
    blocks: [{
      type: 'part_ping_sensor_cm',
      message0: 'PING))) distance (cm) on pin %1',
      args0: [{ type: 'field_number', name: 'PIN', value: 7, min: 0, max: 19, precision: 1 }],
      output: 'Number', colour: '#14b8a6',
      tooltip: 'Triggers a 3-pin PING))) on this pin and returns the echo time / 58 (centimetres).',
    }],
    generators: {
      part_ping_sensor_cm(block, gen, H) {
        const pin = block.getFieldValue('PIN')
        H.define(gen, 'ping_read', `long pingReadCm(int pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(2);
  digitalWrite(pin, HIGH);
  delayMicroseconds(5);
  digitalWrite(pin, LOW);
  pinMode(pin, INPUT);
  return pulseIn(pin, HIGH) / 29 / 2;
}`)
        return [`pingReadCm(${pin})`, H.Order.ATOMIC]
      },
    },
  },
  tests: [
    {
      name: 'after a trigger on SIG the echo is distance × 58 µs (100 cm → 5800 µs); none before',
      run(kit) {
        kit.scene({ U: 'arduino', P: 'ping_sensor' }, [['P:GND', 'U:GND1'], ['P:5V', 'U:5V'], ['P:SIG', 'U:D7']])
        kit.step(0.02)
        kit.equal(kit.bridge.pulses()[7], undefined, 'no echo without a trigger')
        kit.pinMode(7, 'output'); kit.write(7, 0); kit.write(7, 1); kit.write(7, 0); kit.pinMode(7, 'input')
        kit.step(0.02)
        kit.equal(kit.bridge.pulses()[7], 5800, '100 cm')
        kit.control('P', 'distance', 2); kit.equal(kit.bridge.pulses()[7], 116, '2 cm (minimum)')
        kit.control('P', 'distance', 300); kit.equal(kit.bridge.pulses()[7], 17400, '3 m (maximum)')
        // 30 mA supply current: 5 V / 166.7 Ω.
        kit.ok(kit.state('P').powered, 'powered')
      },
    },
    {
      name: 'end to end: the classic Parallax PING sketch prints the distance in cm',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', P: 'ping_sensor' }, [['P:GND', 'U:GND1'], ['P:5V', 'U:5V'], ['P:SIG', 'U:D7']])
        kit.control('P', 'distance', 100)
        const s = runSketch(kit, `const int pingPin = 7;
void setup() { Serial.begin(9600); }
void loop() {
  long duration, cm;
  pinMode(pingPin, OUTPUT);
  digitalWrite(pingPin, LOW);
  delayMicroseconds(2);
  digitalWrite(pingPin, HIGH);
  delayMicroseconds(5);
  digitalWrite(pingPin, LOW);
  pinMode(pingPin, INPUT);
  duration = pulseIn(pingPin, HIGH);
  cm = microsecondsToCentimeters(duration);
  Serial.println(cm);
  delay(20);
}
long microsecondsToCentimeters(long microseconds) { return microseconds / 29 / 2; }`)
        await s.run(200)
        // 100 cm → 5800 µs → 5800 / 29 / 2 = 100.
        kit.equal(s.out[s.out.length - 1], '100\n', '100 cm')
        kit.control('P', 'distance', 57)
        await s.run(150)
        kit.equal(s.out[s.out.length - 1], '57\n', '57 cm')
        s.stop()
      },
    },
    {
      name: 'from 3.3 V (or unpowered) it returns no echo, and warns about the supply',
      run(kit) {
        kit.scene({ U: 'arduino', P: 'ping_sensor' }, [['P:GND', 'U:GND1'], ['P:5V', 'U:3V3'], ['P:SIG', 'U:D7']])
        kit.pinMode(7, 'output'); kit.write(7, 1); kit.write(7, 0); kit.step(0.02)
        kit.equal(kit.bridge.pulses()[7], undefined, 'no echo at 3.3 V')
        kit.ok(kit.hasIssue('P:undervoltage'))
        kit.scene({ U: 'arduino', P: 'ping_sensor' }, [['P:GND', 'U:GND1'], ['P:SIG', 'U:D7']])
        kit.pinMode(7, 'output'); kit.write(7, 1); kit.write(7, 0); kit.step(0.02)
        kit.equal(kit.bridge.pulses()[7], undefined, 'no echo unpowered')
      },
    },
  ],
})
