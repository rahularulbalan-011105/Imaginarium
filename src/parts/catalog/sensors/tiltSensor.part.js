// SW-520D ball tilt switch (Tinkercad "Tilt Sensor"). Ø5.8 × 12 mm can, two legs
// 2.54 mm apart. Upright, the metal balls rest on both contacts: CLOSED (≤10 Ω).
// Tilted past ≈45° they roll off: OPEN (≥10 MΩ). Rated ≤20 mA, ≤12 V DC.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { sw } from '../../../circuit/mna.js'
import { mat, cyl, at, lead } from '../../model.js'

const HALF = 0.127, LEG = 0.5, R = 0.29, H = 1.2

export default definePart({
  type: 'tilt_sensor',
  label: 'Tilt Sensor (SW-520D)',
  shortName: 'TILT',
  tinkercad: 'Tilt Sensor',
  category: 'sensors',
  icon: '⤢',
  desc: 'SW-520D ball switch · closed upright',
  purpose: 'A tiny can with metal balls inside: closed while upright, open when tilted. Wire one leg to a pin with INPUT_PULLUP and the other to GND: the pin reads LOW upright and HIGH when tilted. Tilt it in the sim bar.',
  usage: 'tip-over alarms · orientation detection',
  spec: { dims_mm: { w: 5.8, h: 17.0, d: 5.8 }, mass_kg: 0.0005, rating: '≤20 mA, ≤12 V DC', Ron_ohm: 10, Roff_ohm: 1e7,
    summary: 'Closed (≤10 Ω) upright, open (≥10 MΩ) when tilted more than ≈45°. Non-polar.' },
  pins: [
    { name: '1', kind: 'passive', x: -HALF, y: 0.02, z: 0, r: 0.06 },
    { name: '2', kind: 'passive', x: HALF, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    for (const s of [-1, 1]) g.add(lead([s * HALF, 0, 0], [s * HALF, LEG + 0.05, 0], { r: 0.025 }))
    const body = new Group()
    body.name = 'can'
    body.position.y = LEG
    body.add(at(cyl(R, 0.12, mat(0x111111, { rough: 0.8 })), 0, 0.06, 0))                // epoxy base
    body.add(at(cyl(R, H - 0.12, mat(0x8a8f96, { metal: 0.8, rough: 0.35 })), 0, 0.12 + (H - 0.12) / 2, 0))  // metal can
    body.add(at(cyl(R * 0.7, 0.01, mat(0x6b7078, { metal: 0.8 })), 0, H + 0.005 - 0.01, 0))   // crimped top
    g.add(body)
    return g
  },
  sim: {
    controls: [{ key: 'tilted', kind: 'toggle', label: 'Tilt', offLabel: 'Upright', onLabel: 'Tilted' }],
    circuit(api) { return { s: api.add(sw(api.pin('1'), api.pin('2'), { Ron: 10, Roff: 1e7, closed: true })) } },
    beforeStep(h, api) { h.s.closed = !api.control('tilted') },
    solved(h, api) {
      const i = Math.abs(api.cur(h.s))
      if (i > 0.02) api.issue('current', 'warning', `${api.obj.name} carries ${(i * 1000).toFixed(0)} mA`, 'The SW-520D is rated 20 mA; more pits its contacts. Use it as a logic input with a pull-up.')
      else api.clearIssue('current')
      return { closed: h.s.closed, current: i }
    },
    visual(root, { solved }) {
      const can = root.getObjectByName('can')
      if (can) can.rotation.z = solved && !solved.closed ? -0.8 : 0
    },
  },
  blockly: {
    blocks: [{
      type: 'part_tilt_sensor_tilted',
      message0: 'tilt sensor on pin %1 is tilted',
      args0: [{ type: 'field_number', name: 'PIN', value: 2, min: 0, max: 19, precision: 1 }],
      output: 'Boolean', colour: '#14b8a6',
      tooltip: 'True while an SW-520D wired between this pin and GND is tilted (open switch, the internal pull-up reads HIGH).',
    }],
    generators: {
      part_tilt_sensor_tilted(block, gen, H) {
        const pin = block.getFieldValue('PIN')
        H.setup(gen, `tilt_${pin}`, `pinMode(${pin}, INPUT_PULLUP);`)
        return [`(digitalRead(${pin}) == HIGH)`, H.Order.EQUALITY]
      },
    },
  },
  tests: [
    {
      name: 'INPUT_PULLUP pin reads LOW upright (closed) and HIGH tilted (open)',
      run(kit) {
        kit.scene({ U: 'arduino', T: 'tilt_sensor' }, [['T:1', 'U:D2'], ['T:2', 'U:GND1']])
        kit.pinMode(2, 'pullup'); kit.step(0.02)
        // Upright: 5 V × 10 Ω / (35 kΩ + 10 Ω) ≈ 1.4 mV.
        kit.near(kit.pinVoltage(2), 5 * 10 / 35010, 0.002, 'upright pin voltage')
        kit.equal(kit.digitalRead(2), 0)
        kit.control('T', 'tilted', 1); kit.step(0.02)
        kit.equal(kit.digitalRead(2), 1, 'tilted: open')
      },
    },
    {
      name: 'end to end: the sketch lights an LED when the sensor tips over',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', T: 'tilt_sensor', R: { type: 'resistor', resistance: 220 }, L: 'led' },
          [['T:1', 'U:D2'], ['T:2', 'U:GND1'], ['U:D13', 'R:1'], ['R:2', 'L:ANODE'], ['L:CATHODE', 'U:GND2']])
        const s = runSketch(kit, `void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, digitalRead(2)); delay(5); }`)
        await s.run(150)
        kit.ok(!(kit.led.L > 0), 'upright: LED off')
        kit.control('T', 'tilted', 1)
        await s.run(200)
        kit.ok(kit.led.L > 100, 'tilted: LED on')
        s.stop()
      },
    },
  ],
})
