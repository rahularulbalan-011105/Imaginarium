// Ambient light sensor = NPN phototransistor in a 5 mm (T-1¾) package, two leads
// (Tinkercad "Ambient Light Sensor"). Sensitivity from the Vishay TEMT6000
// ambient-light phototransistor: Ica = 50 µA typ at 20 lux (illuminant A,
// VCE = 5 V) → 2.5 µA/lux; dark current ≈3 nA; VCEO 6 V; Ptot 100 mW.
// Model: Ebers-Moll NPN (β = 100) whose base is driven by a photocurrent
// Ica/(β+1), so the emitter carries Ica and the transistor saturates like the
// real one. Wire C to 5 V, E to A0 and 10 kΩ from A0 to GND.
import { Group, SphereGeometry, Mesh } from 'three'
import { definePart } from '../../definePart.js'
import { bjt, isource } from '../../../circuit/mna.js'
import { mat, cyl, at, lead, box, setGlow } from '../../model.js'

const HALF = 0.127, LEG = 0.5, R = 0.25, BF = 100
export const A_PER_LUX = 2.5e-6, DARK = 3e-9

export default definePart({
  type: 'ambient_light_sensor',
  label: 'Ambient Light Sensor (phototransistor)',
  shortName: 'ALS',
  tinkercad: 'Ambient Light Sensor',
  category: 'sensors',
  icon: '◐',
  desc: 'NPN phototransistor · ≈2.5 µA/lux (TEMT6000 class)',
  purpose: 'A transistor switched on by light: its collector-emitter current is ≈2.5 µA per lux. Wire C (collector, flat side / short leg) to 5 V and E (emitter) to A0 with a 10 kΩ resistor from A0 to GND: 100 lux gives ≈2.5 V; bright light saturates it near 5 V. Set the light in the sim bar.',
  usage: 'room-light sensing · automatic brightness · light/dark switches',
  spec: { dims_mm: { w: 5.8, h: 13.6, d: 5.8 }, mass_kg: 0.0003, sensitivity_A_per_lux: A_PER_LUX, darkCurrent_A: DARK, VCEO: 6, Ptot_W: 0.1,
    summary: 'I(C→E) ≈ 2.5 µA × lux until it saturates. C = collector, E = emitter.' },
  pins: [
    { name: 'C', kind: 'passive', label: 'C (collector)', x: -HALF, y: 0.02, z: 0, r: 0.06 },
    { name: 'E', kind: 'passive', label: 'E (emitter)', x: HALF, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    g.add(lead([-HALF, 0, 0], [-HALF, LEG + 0.05, 0], { r: 0.025 }))
    g.add(lead([HALF, 0, 0], [HALF, LEG + 0.05, 0], { r: 0.025 }))
    const clear = mat(0xe9eef2, { rough: 0.15, opacity: 0.55 })
    g.add(at(cyl(0.29, 0.1, clear), 0, LEG + 0.05, 0))                                       // flange
    g.add(box(0.06, 0.1, 0.4, mat(0xffffff, { opacity: 0.0 }), -0.29, LEG + 0.05, 0))          // flat marks the collector
    g.add(at(cyl(R, 0.51, clear), 0, LEG + 0.1 + 0.255, 0))
    const dome = new Mesh(new SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), clear)
    g.add(at(dome, 0, LEG + 0.61, 0))
    const die = box(0.08, 0.02, 0.08, mat(0x3a3020, { emissive: 0x000000 }), 0, LEG + 0.2, 0)
    die.name = 'die'
    g.add(die)
    return g
  },
  sim: {
    controls: [{ key: 'lux', kind: 'slider', label: 'Light', min: 0, max: 2000, step: 1, unit: 'lux', default: 100 }],
    circuit(api) {
      const c = api.pin('C'), e = api.pin('E'), b = api.node()
      return { q: api.add(bjt(c, b, e, { bf: BF, Is: 1e-14 })), ph: api.add(isource(c, b, 0)) }
    },
    beforeStep(h, api) {
      const l = api.control('lux')
      h.ph.I = (A_PER_LUX * Math.max(0, l == null ? 100 : Number(l)) + DARK) / (BF + 1)
    },
    solved(h, api) {
      const vce = api.vpin('C') - api.vpin('E')
      const ic = api.cur(h.q) + h.ph.I
      if (vce < -0.3) api.issue('reversed', 'warning', `${api.obj.name} is wired backwards`,
        'The emitter is more positive than the collector, so the phototransistor barely responds. Collector (flat side, short leg) goes to the positive supply.')
      else api.clearIssue('reversed')
      if (vce > 6) api.issue('vceo', 'error', `${api.obj.name}: ${vce.toFixed(1)} V across C–E`, 'VCEO is 6 V — it would break down.')
      else api.clearIssue('vceo')
      return { current: ic, vce, saturated: vce < 0.3 && ic > 0 }
    },
    visual(root, { solved, off }) {
      const d = root.getObjectByName('die')
      if (d) setGlow(d, 0xffd27a, off ? 0 : Math.min(1, (solved?.current ?? 0) / 2.5e-3) * 0.4)
    },
  },
  tests: [
    {
      name: 'emitter follower into 10 kΩ: 20 lux → 0.5 V, 100 lux → 2.5 V, 2000 lux → saturated near 5 V',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'ambient_light_sensor', R: { type: 'resistor', resistance: 10000 } },
          [['Q:C', 'U:5V'], ['Q:E', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.control('Q', 'lux', 20); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 0.5, 0.01, '50 µA × 10 kΩ')
        kit.control('Q', 'lux', 100); kit.step(0.02)
        kit.near(kit.pinVoltage(14), 2.5, 0.02, '250 µA × 10 kΩ'); kit.near(kit.analogRead(14), 512, 4)
        kit.control('Q', 'lux', 2000); kit.step(0.05)
        // 5 mA would need 50 V across 10 kΩ: it saturates, VCE(sat) ≈ 0.1 V.
        kit.between(kit.pinVoltage(14), 4.7, 5.0, 'saturated')
        kit.ok(kit.state('Q').saturated, 'saturation flagged')
      },
    },
    {
      name: 'end to end: analogRead tracks the light level',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', Q: 'ambient_light_sensor', R: { type: 'resistor', resistance: 10000 } },
          [['Q:C', 'U:5V'], ['Q:E', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.control('Q', 'lux', 40)
        const s = runSketch(kit, `void setup() { Serial.begin(9600); }
void loop() { Serial.println(analogRead(A0)); delay(10); }`)
        await s.run(150)
        s.stop()
        // 40 lux → 100 µA → 1.0 V → 1023/5 = 204.6.
        kit.near(Number(s.out[s.out.length - 1]), 205, 3)
      },
    },
    {
      name: 'warns when collector and emitter are swapped',
      run(kit) {
        kit.scene({ U: 'arduino', Q: 'ambient_light_sensor', R: { type: 'resistor', resistance: 10000 } },
          [['Q:E', 'U:5V'], ['Q:C', 'U:A0'], ['R:1', 'U:A0'], ['R:2', 'U:GND1']])
        kit.control('Q', 'lux', 100); kit.step(0.05)
        kit.ok(kit.hasIssue('Q:reversed'), 'reversed warning')
        kit.ok(kit.pinVoltage(14) < 0.5, 'reverse-mode current is tiny (βR = 1)')
      },
    },
  ],
})
