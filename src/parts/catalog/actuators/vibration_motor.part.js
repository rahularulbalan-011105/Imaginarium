// 10 mm coin vibration motor (Tinkercad "Vibration Motor"), Adafruit #1201 /
// Precision Microdrives 310-class: Ø10 × 2.7 mm, rated 3 V, operating 2–5 V.
// Adafruit's measured draw — 60 mA @ 3 V, 80 mA @ 4 V, 100 mA @ 5 V — is a
// near-constant 50 Ω running load, so the solver sees a 50 Ω resistor. It
// starts spinning (vibrating) above ≈2.0 V. The flying leads are shown ending
// in two tinned tips 2.54 mm apart, pushed into a breadboard.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, lead, TIN } from '../../model.js'

const R_RUN = 50, V_START = 2.0, V_RATED = 3.0, V_MAX = 5.0
const COIN_Y = 0.25, COIN_H = 0.27
const PZ = 0.75                         // lead tips 7.5 mm in front of the coin centre

export default definePart({
  type: 'vibration_motor',
  label: 'Vibration Motor',
  shortName: 'VIB',
  tinkercad: 'Vibration Motor',
  category: 'actuators',
  icon: '📳',
  desc: '10 mm coin · 3 V · ≈60 mA (50 Ω)',
  purpose: 'A tiny motor with an off-centre weight that buzzes when powered. It needs 60–100 mA — more than an Arduino pin can give (40 mA max) — so switch it with an NPN transistor (and a flyback diode) from 5 V or 3.3 V. Red lead + , blue lead −.',
  usage: 'haptic feedback · alarms · wearables',
  spec: {
    dims_mm: { w: 10, h: 5.2, d: 13.0 }, mass_kg: 0.0009,
    rated_V: V_RATED, range_V: [2, 5], current_mA: { '3V': 60, '4V': 80, '5V': 100 }, resistance_ohm: R_RUN,
    summary: 'Behaves as ≈50 Ω while running; starts above ≈2 V; rated 3 V, 5 V max.',
  },
  pins: [
    { name: '+', kind: 'power', x: -0.127, y: 0.02, z: PZ, r: 0.06, label: '+ (red)' },
    { name: '-', kind: 'gnd', x: 0.127, y: 0.02, z: PZ, r: 0.06, label: '− (blue)', ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    const motor = new Group(); motor.name = 'coin'
    motor.add(at(cyl(0.5, COIN_H, mat(0xb8bcc2, { metal: 0.8, rough: 0.3 }), { seg: 32 }), 0, COIN_Y + COIN_H / 2, 0))
    motor.add(at(cyl(0.42, 0.01, mat(0xdfe2e6, { metal: 0.6, rough: 0.4 }), { seg: 32 }), 0, COIN_Y + COIN_H + 0.005, 0))
    motor.add(at(cyl(0.5, 0.02, mat(0x222222), { seg: 32 }), 0, COIN_Y - 0.01, 0))          // adhesive foam
    g.add(motor)
    // Leads: red (+) and blue (−) from the coin edge down to the breadboard.
    for (const [x, color] of [[-0.127, 0xd32f2f], [0.127, 0x1e5bd8]]) {
      const m = mat(color, { rough: 0.6 })
      g.add(lead([x * 0.6, COIN_Y + 0.1, 0.45], [x, COIN_Y + 0.1, PZ - 0.05], { r: 0.025, material: m }))
      g.add(lead([x, COIN_Y + 0.1, PZ - 0.05], [x, 0.08, PZ], { r: 0.025, material: m }))
      g.add(box(0.04, 0.1, 0.04, TIN(), x, 0.05, PZ))
    }
    return g
  },
  sim: {
    circuit(api) { return { r: api.add(resistor(api.pin('+'), api.pin('-'), R_RUN)) } },
    solved(h, api) {
      const v = api.vpin('+') - api.vpin('-'), i = api.cur(h.r)
      const name = api.obj.name || 'Vibration motor'
      if (Math.abs(v) > V_MAX * 1.05) api.issue('overvoltage', 'error', `${name} has ${Math.abs(v).toFixed(1)} V across it`,
        `It is rated ${V_RATED} V (${V_MAX} V max); the brushes and coil overheat.`)
      else api.clearIssue('overvoltage')
      const mag = Math.abs(v)
      const running = mag >= V_START
      // Speed ∝ voltage: ≈12 000 rpm at the rated 3 V.
      return { voltage: v, current: i, running, rpm: running ? Math.round(12000 * mag / V_RATED) : 0, intensity: running ? Math.min(1, mag / V_MAX) : 0 }
    },
    visual(root, { solved, off }) {
      const coin = root.getObjectByName('coin')
      if (!coin) return
      if (off || !solved?.running) { coin.position.set(0, 0, 0); coin.rotation.y = 0; return }
      const a = 0.025 * solved.intensity
      coin.position.set((Math.random() - 0.5) * a, 0, (Math.random() - 0.5) * a)
      coin.rotation.y += 0.3 * solved.intensity
    },
    readout({ solved }) { return solved ? `${Math.abs(solved.voltage).toFixed(2)} V · ${(Math.abs(solved.current) * 1000).toFixed(0)} mA${solved.running ? ' · buzzing' : ''}` : '' },
  },
  tests: [
    {
      name: 'switched from 5 V it draws ≈100 mA and vibrates',
      run(kit) {
        kit.scene({ U: 'arduino', M: 'vibration_motor' }, [['M:+', 'U:5V'], ['M:-', 'U:GND1']])
        kit.step(0.05)
        // 5 V / (50 Ω + 0.05 Ω supply) ≈ 99.9 mA (Adafruit: 100 mA @ 5 V).
        kit.near(kit.state('M').current, 0.0999, 0.001, 'running current')
        kit.ok(kit.state('M').running, 'vibrating')
        kit.ok(!kit.hasIssue('pin:'), 'no pin over-current from the 5 V rail')
      },
    },
    {
      name: 'driven straight from a pin: ≈67 mA over the 40 mA pin limit, issue raised',
      run(kit) {
        kit.scene({ U: 'arduino', M: 'vibration_motor' }, [['M:+', 'U:D9'], ['M:-', 'U:GND1']])
        kit.pinMode(9, 'output'); kit.write(9, 1); kit.step(0.05)
        // 5 V / (25 Ω pin + 50 Ω) = 66.7 mA; the motor sees 3.33 V.
        kit.near(kit.state('M').current, 0.0667, 0.001, 'current from the pin')
        kit.near(kit.state('M').voltage, 3.33, 0.02, 'voltage across the motor')
        kit.ok(kit.hasIssue('pin:9:overcurrent'), 'pin over-current issue')
      },
    },
    {
      name: 'below the ≈2 V start voltage it does not spin (100 Ω in series from 5 V)',
      run(kit) {
        kit.scene({ U: 'arduino', M: 'vibration_motor', R: { type: 'resistor', resistance: 100 } },
          [['U:5V', 'R:1'], ['R:2', 'M:+'], ['M:-', 'U:GND1']])
        kit.step(0.05)
        // 5 · 50 / (100 + 50) = 1.67 V < 2 V.
        kit.near(kit.state('M').voltage, 1.667, 0.01, 'divided voltage')
        kit.equal(kit.state('M').running, false, 'stalled')
      },
    },
    {
      name: 'end to end: a sketch pulses the motor through the pin (and trips the pin limit)',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', M: 'vibration_motor' }, [['M:+', 'U:D6'], ['M:-', 'U:GND1']])
        const s = runSketch(kit, `void setup() { pinMode(6, OUTPUT); }
void loop() { digitalWrite(6, HIGH); delay(20); }`)
        await s.run(120)
        kit.ok(kit.state('M').running, 'buzzing')
        kit.ok(kit.hasIssue('pin:6:overcurrent'), 'pin over-current reported')
        s.stop()
      },
    },
  ],
})
