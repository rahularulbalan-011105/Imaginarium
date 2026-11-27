// 5 V SPDT power relay (Tinkercad "Relay SPDT"), modelled on the common
// SRD-05VDC-SL-C sugar-cube relay. Datasheet: case 19.0 × 15.5 × 15.3 mm,
// coil 5 VDC 70 Ω ±10 % (≈71 mA, 0.36 W), must-operate ≤ 75 % (3.75 V),
// must-release ≥ 10 % (0.5 V), max coil voltage 120 % (6 V), contacts
// 10 A 30 VDC / 10 A 250 VAC, contact resistance ≤ 100 mΩ, operate ≤ 10 ms.
// Footprint (bottom view): COM at one end on the centre line, the two coil pins
// 2.0 mm further in, 12 mm apart; NO and NC at the far end, 12 mm apart,
// 14.2 mm from the coil pins. Pins are 3.3 mm long; here 3 mm show above y = 0.
//
// Circuit model: coil = 70 Ω + L (≈0.15 H, a typical measured value for this
// relay — not in the datasheet), so switching it off without a flyback diode
// really produces a large inductive spike. COM–NO and COM–NC are switches set
// from the coil current before each step, with pull-in / drop-out hysteresis
// at the must-operate / must-release currents (3.75 V / 70 Ω = 53.6 mA,
// 0.5 V / 70 Ω = 7.1 mA).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor, inductor, sw } from '../../../circuit/mna.js'
import { mat, box, at, textPlane, TIN, fmtSI } from '../../model.js'

const R_COIL = 70, L_COIL = 0.15
const I_PULL = 3.75 / R_COIL, I_DROP = 0.5 / R_COIL
const BODY_Y = 0.3, W = 1.9, H = 1.53, D = 1.55
const X_COM = -0.91, X_COIL = -0.71, X_CONT = 0.71, ZS = 0.6
const SPIKE_V = 12               // coil voltage well beyond any supply here = an unclamped inductive kick

// Board pins that drive a coil leg directly (learned on pin edges, where the
// bridge api can tell which board pin a part pin is wired to).
const pinDriven = new WeakMap()

export default definePart({
  type: 'relay_spdt',
  label: 'Relay SPDT',
  shortName: 'K',
  tinkercad: 'Relay SPDT',
  category: 'basic',
  icon: '⎍',
  desc: '5 V coil · SPDT 10 A · SRD-05VDC type',
  purpose: 'An electrically operated switch: current through the coil (≈70 mA at 5 V) pulls COM from NC over to NO, so a small circuit can switch a big separate one. An Arduino pin cannot supply 70 mA — drive the coil through a transistor (e.g. 2N2222A + 1 kΩ) and put a diode across the coil (band toward +) to absorb the spike when it turns off.',
  usage: 'switching lamps, pumps, motors or mains loads from a sketch (through a transistor)',
  spec: {
    dims_mm: { w: 19.0, h: 18.3, d: 15.5 }, mass_kg: 0.01,
    coil_V: 5, coil_ohm: R_COIL, mustOperate_V: 3.75, mustRelease_V: 0.5, contact: '10 A 30 VDC / 250 VAC',
    summary: 'Coil 5 V 70 Ω (needs a transistor driver + flyback diode). COM connects to NC at rest, to NO when energised.',
  },
  pins: [
    { name: 'COIL1', kind: 'passive', x: X_COIL, y: 0.02, z: -ZS, r: 0.07, label: 'coil' },
    { name: 'COIL2', kind: 'passive', x: X_COIL, y: 0.02, z: ZS, r: 0.07, label: 'coil' },
    { name: 'COM', kind: 'passive', x: X_COM, y: 0.02, z: 0, r: 0.07, label: 'COM', ldy: 0.25 },
    { name: 'NO', kind: 'passive', x: X_CONT, y: 0.02, z: -ZS, r: 0.07, label: 'NO' },
    { name: 'NC', kind: 'passive', x: X_CONT, y: 0.02, z: ZS, r: 0.07, label: 'NC' },
  ],
  build() {
    const g = new Group()
    g.add(box(W, H, D, mat(0x1f5fbf, { rough: 0.5 }), 0, BODY_Y + H / 2, 0))                 // sealed case
    g.add(box(W * 0.98, 0.06, D * 0.98, mat(0x174a96, { rough: 0.6 }), 0, BODY_Y + 0.03, 0)) // potting at the base
    const t = textPlane('SRD-05VDC-SL-C', W * 0.85, 0.2, { fg: '#ffffff', bg: null })
    if (t) { t.rotation.x = -Math.PI / 2; g.add(at(t, 0, BODY_Y + H + 0.002, -0.25)) }
    const t2 = textPlane('10A 30VDC  10A 250VAC', W * 0.85, 0.16, { fg: '#e5e7eb', bg: null })
    if (t2) { t2.rotation.x = -Math.PI / 2; g.add(at(t2, 0, BODY_Y + H + 0.002, 0.2)) }
    // Contact-diagram print on the front face.
    g.add(box(0.5, 0.02, 0.01, mat(0xffffff), 0.3, BODY_Y + 0.9, D / 2 + 0.006))
    for (const [x, z] of [[X_COIL, -ZS], [X_COIL, ZS], [X_COM, 0], [X_CONT, -ZS], [X_CONT, ZS]]) {
      g.add(box(0.06, BODY_Y + 0.02, 0.12, TIN(), x, (BODY_Y + 0.02) / 2, z))   // flat pins, to y = 0
    }
    return g
  },
  sim: {
    transient: true,
    circuit(api) {
      const m = api.node()
      const rc = api.add(resistor(api.pin('COIL1'), m, R_COIL))
      const lc = api.add(inductor(m, api.pin('COIL2'), L_COIL))
      const no = api.add(sw(api.pin('COM'), api.pin('NO'), { Ron: 0.05 }))
      const nc = api.add(sw(api.pin('COM'), api.pin('NC'), { Ron: 0.05, closed: true }))
      return { rc, lc, no, nc, energized: false, peak: 0, clicks: 0 }
    },
    beforeStep(h, api) {
      const i = Math.abs(api.cur(h.lc))
      if (!h.energized && i >= I_PULL) { h.energized = true; h.clicks++ }
      else if (h.energized && i <= I_DROP) h.energized = false
      h.no.closed = h.energized
      h.nc.closed = !h.energized
    },
    afterStep(h, api) {
      const v = Math.abs(api.vpin('COIL1') - api.vpin('COIL2'))
      if (v > h.peak) h.peak = v
    },
    onPin(api, { pin }) {
      const a = api.boardPin('COIL1'), b = api.boardPin('COIL2')
      if (a === pin || b === pin) pinDriven.set(api.obj, pin)
    },
    solved(h, api) {
      const i = api.cur(h.lc)
      const v = api.vpin('COIL1') - api.vpin('COIL2')
      const name = api.obj.name || 'Relay'
      const pin = pinDriven.get(api.obj)
      if (pin != null && Math.abs(i) > 0.005) api.issue('pindrive', 'warning', `${name}'s coil is driven straight from pin ${pin}`,
        'The coil needs ≈70 mA; an Arduino pin gives at most 20–40 mA, sags, and may not pull the relay in (and can be damaged). Drive the coil through an NPN transistor or MOSFET with a flyback diode.')
      else api.clearIssue('pindrive')
      // Latched: a spike lasts microseconds but has already done its damage.
      if (h.peak > SPIKE_V) api.issue('flyback', 'warning', `${name}'s coil made a ${h.peak.toFixed(0)} V spike when switched off`,
        'There is no flyback diode across the coil. Add a 1N4007 across COIL1/COIL2 with its band toward the + side; otherwise the spike destroys the driver transistor.')
      if (!h.energized && Math.abs(v) > 6 && h.peak <= SPIKE_V) api.issue('coilv', 'error', `${name}'s coil has ${Math.abs(v).toFixed(1)} V`, 'The 5 V coil is rated 6 V maximum (120 %).')
      else api.clearIssue('coilv')
      const ic = Math.max(Math.abs(api.cur(h.no)), Math.abs(api.cur(h.nc)))
      if (ic > 10) api.issue('contact', 'error', `${name}'s contacts carry ${fmtSI(ic, 'A')}`, 'The contacts are rated 10 A.')
      else api.clearIssue('contact')
      return { energized: h.energized, coilCurrent: i, coilVoltage: v, contactCurrent: ic, peakVoltage: h.peak, clicks: h.clicks }
    },
    readout({ solved }) { return solved ? (solved.energized ? 'ON (COM–NO)' : 'OFF (COM–NC)') : '' },
  },
  tests: [
    {
      name: 'end to end: sketch → 1 kΩ → 2N2222A drives the coil (with 1N4007 flyback); NO lights an LED, NC when released',
      async run(kit, { runSketch }) {
        kit.scene({
          U: 'arduino', K: 'relay_spdt', Q: 'npn_transistor', D: 'diode', RB: { type: 'resistor', resistance: 1000 },
          R1: { type: 'resistor', resistance: 220 }, R2: { type: 'resistor', resistance: 220 }, L1: 'led', L2: 'led',
        }, [
          ['U:D7', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'K:COIL1'], ['K:COIL2', 'Q:C'],
          ['D:CATHODE', 'K:COIL1'], ['D:ANODE', 'K:COIL2'],
          ['K:COM', 'U:5V'], ['K:NO', 'R1:1'], ['R1:2', 'L1:ANODE'], ['L1:CATHODE', 'U:GND2'],
          ['K:NC', 'R2:1'], ['R2:2', 'L2:ANODE'], ['L2:CATHODE', 'U:GND3'],
        ])
        kit.step(0.02)
        kit.equal(kit.state('K').energized, false, 'at rest')
        kit.between(kit.led.L2, 165, 195, 'NC LED on at rest')
        const s = runSketch(kit, `void setup() {
  pinMode(7, OUTPUT);
  digitalWrite(7, HIGH);
  delay(300);
  digitalWrite(7, LOW);
}
void loop() {
  delay(10);
}`)
        await s.run(150)
        const k = kit.state('K')
        // Coil: (5 − ≈0.07 V V_CE(sat)) / 70 Ω ≈ 70 mA ≥ 53.6 mA must-operate → pulled in.
        kit.near(k.coilCurrent, 4.93 / 70, 2e-3, 'coil current')
        kit.equal(k.energized, true, 'energised')
        kit.between(kit.led.L1, 165, 195, 'NO LED on')
        kit.ok(!(kit.led.L2 > 2), 'NC LED off')
        kit.ok(!kit.hasIssue('K:pindrive'), 'transistor-driven: no pin warning')
        await s.run(350)
        kit.equal(kit.state('K').energized, false, 'released after the pin goes LOW')
        kit.ok(!(kit.led.L1 > 2), 'NO LED off again')
        // The diode clamps the turn-off kick to ≈ −0.8 V.
        kit.ok(kit.state('K').peakVoltage < 6, `no spike with the flyback diode (peak ${kit.state('K').peakVoltage.toFixed(2)} V)`)
        kit.ok(!kit.hasIssue('K:flyback'), 'no flyback warning')
        s.stop()
      },
    },
    {
      name: 'without a flyback diode, switching off makes a large spike across the coil (flyback warning)',
      run(kit) {
        kit.scene({ U: 'arduino', K: 'relay_spdt', Q: 'npn_transistor', RB: { type: 'resistor', resistance: 1000 } },
          [['U:D7', 'RB:1'], ['RB:2', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'K:COIL1'], ['K:COIL2', 'Q:C']])
        kit.pinMode(7, 'output'); kit.write(7, 1); kit.step(0.05)
        kit.equal(kit.state('K').energized, true)
        kit.write(7, 0); kit.step(0.02)
        // V = L·di/dt: 70 mA interrupted in one 0.1 ms solver step through 0.15 H ≈ 100 V
        // (a real coil rings to ≈100–200 V until the transistor avalanches).
        kit.ok(kit.state('K').peakVoltage > 50, `spike (got ${kit.state('K').peakVoltage.toFixed(0)} V)`)
        kit.ok(kit.hasIssue('K:flyback'), 'flyback warning')
        kit.equal(kit.state('K').energized, false)
      },
    },
    {
      name: 'coil straight from a pin: warns, overloads the pin, and the sagging 3.7 V does not pull it in',
      run(kit) {
        kit.scene({ U: 'arduino', K: 'relay_spdt' }, [['U:D7', 'K:COIL1'], ['K:COIL2', 'U:GND1']])
        kit.pinMode(7, 'output'); kit.write(7, 1); kit.step(0.05)
        // I = 5 V / (25 Ω pin + 70 Ω) = 52.6 mA < 53.6 mA must-operate; coil sees 3.68 V < 3.75 V.
        kit.near(kit.state('K').coilCurrent, 5 / 95, 0.5e-3, 'coil current')
        kit.equal(kit.state('K').energized, false, 'not pulled in')
        kit.ok(kit.hasIssue('K:pindrive'), 'pin-drive warning')
        kit.ok(kit.hasIssue('pin:7:overcurrent'), 'pin over 40 mA')
      },
    },
    {
      name: 'pull-in / drop-out hysteresis (variable DC on the base through 10 kΩ)',
      run(kit) {
        // A bench supply sets the base drive (a PWM pin would switch the transistor fully
        // on and off — it cannot hold it in its active region).
        kit.scene({ U: 'arduino', P: { type: 'power_supply', voltage: 0, currentLimit: 1 }, K: 'relay_spdt', Q: 'npn_transistor', D: 'diode', RB: { type: 'resistor', resistance: 10000 } },
          [['P:POS', 'RB:1'], ['P:NEG', 'U:GND2'], ['RB:2', 'Q:B'], ['Q:E', 'U:GND1'], ['U:5V', 'K:COIL1'], ['K:COIL2', 'Q:C'], ['D:CATHODE', 'K:COIL1'], ['D:ANODE', 'K:COIL2']])
        // Active region: I_C = β·(V_B − V_BE) / (10 kΩ + r), β = 200, V_BE ≈ 0.74 V.
        kit.control('P', 'voltage', 2.94); kit.step(0.05)   // 200 · (2.94 − 0.74) / 10035 ≈ 44 mA < 53.6 mA
        kit.near(kit.state('K').coilCurrent, 0.044, 0.004, 'coil current with 2.94 V on the base resistor')
        kit.equal(kit.state('K').energized, false, 'below must-operate')
        kit.control('P', 'voltage', 3.92); kit.step(0.05)   // 200 · (3.92 − 0.75) / 10035 ≈ 63 mA > 53.6 mA
        kit.equal(kit.state('K').energized, true, 'pulls in')
        kit.control('P', 'voltage', 2.94); kit.step(0.05)   // back to 44 mA: still > 7.1 mA must-release
        kit.equal(kit.state('K').energized, true, 'holds in (hysteresis)')
        kit.control('P', 'voltage', 0); kit.step(0.05)
        kit.equal(kit.state('K').energized, false, 'releases below 7.1 mA')
      },
    },
  ],
})
