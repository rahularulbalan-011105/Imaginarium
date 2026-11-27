// ¼ W carbon-film resistor (Tinkercad "Resistor"). Body Ø2.4 × 6.3 mm, tinned
// Ø0.6 mm leads bent down at 0.4" (10.16 mm) spacing — fits a breadboard.
import { Group, CylinderGeometry, Mesh } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, cyl, at, lead, resistorBands, fmtSI } from '../../model.js'

const HALF = 0.508, BODY_Y = 0.42, BODY_L = 0.63, BODY_R = 0.12

export default definePart({
  type: 'resistor',
  label: 'Resistor',
  shortName: 'R',
  tinkercad: 'Resistor',
  category: 'basic',
  icon: '▭',
  desc: '¼ W carbon film · any value',
  purpose: 'Limits current. Every LED needs one in series (220 Ω from 5 V gives ≈14 mA). Set its value in Properties; the colour bands follow. Rated ¼ W — the simulator warns if it would overheat.',
  usage: 'LED current limiting · pull-up / pull-down · voltage dividers',
  spec: { dims_mm: { w: 10.8, h: 5.4, d: 2.4 }, mass_kg: 0.00025, power_W: 0.25, tolerance: 0.05, summary: '¼ W carbon film, ±5 %. Ohm’s law: I = V / R.' },
  props: {
    resistance: { type: 'number', label: 'Resistance', unit: 'Ω', default: 220, min: 0.1, max: 1e8 },
  },
  rebuildOn: ['resistance'],
  pins: [
    { name: '1', kind: 'passive', x: -HALF, y: 0.02, z: 0, r: 0.07, label: '1' },
    { name: '2', kind: 'passive', x: HALF, y: 0.02, z: 0, r: 0.07, label: '2' },
  ],
  build(obj) {
    const g = new Group()
    const body = cyl(BODY_R, BODY_L, mat(0xd9c39a, { rough: 0.7 }), { axis: 'x', seg: 20 })
    g.add(at(body, 0, BODY_Y, 0))
    // End caps bulge slightly, like the real moulded body.
    for (const s of [-1, 1]) g.add(at(cyl(BODY_R * 1.12, 0.12, mat(0xd9c39a, { rough: 0.7 }), { axis: 'x' }), s * (BODY_L / 2 - 0.06), BODY_Y, 0))
    const bands = resistorBands(obj.resistance ?? 220)
    const xs = [-0.2, -0.1, 0.0, 0.2]
    bands.forEach((color, i) => {
      const band = new Mesh(new CylinderGeometry(BODY_R * 1.02, BODY_R * 1.02, 0.05, 20), mat(color, { rough: 0.5 }))
      band.rotation.z = Math.PI / 2
      g.add(at(band, xs[i], BODY_Y, 0))
    })
    for (const s of [-1, 1]) {
      g.add(lead([s * BODY_L / 2, BODY_Y, 0], [s * HALF, BODY_Y, 0], { r: 0.03 }))
      g.add(lead([s * HALF, BODY_Y, 0], [s * HALF, 0, 0], { r: 0.03 }))
    }
    return g
  },
  sim: {
    circuit(api) { return { r: api.add(resistor(api.pin('1'), api.pin('2'), api.prop('resistance'))) } },
    solved(h, api) {
      const v = api.vpin('1') - api.vpin('2')
      const i = api.cur(h.r), p = Math.abs(v * i)
      if (p > 0.25) api.issue('power', 'error', `${api.obj.name} dissipates ${p.toFixed(2)} W`,
        `A ¼ W resistor would overheat at ${fmtSI(p, 'W')}. Use a larger value or a higher-wattage resistor.`)
      else api.clearIssue('power')
      return { voltage: v, current: i, power: p }
    },
  },
  tests: [
    {
      name: "Ohm's law: 1 kΩ from a HIGH pin to GND carries ≈4.9 mA",
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 1000 } }, [['R:1', 'U:D13'], ['R:2', 'U:GND1']])
        kit.pinMode(13, 'output'); kit.write(13, 1); kit.step(0.02)
        // 5 V through the pin's ≈25 Ω output resistance and the 1 kΩ load.
        kit.near(kit.state('R').current, 5 / 1025, 2e-5, 'current')
        kit.near(kit.state('R').voltage, 5 * 1000 / 1025, 0.01, 'voltage across R')
      },
    },
    {
      name: 'two 10 kΩ in series from 5 V halve the voltage (divider into analogRead)',
      run(kit) {
        kit.scene({ U: 'arduino', R1: { type: 'resistor', resistance: 10000 }, R2: { type: 'resistor', resistance: 10000 } },
          [['R1:1', 'U:5V'], ['R1:2', 'U:A0'], ['R2:1', 'U:A0'], ['R2:2', 'U:GND1']])
        kit.step(0.02)
        kit.near(kit.pinVoltage(14), 2.5, 0.01, 'A0 voltage')
        kit.near(kit.analogRead(14), 512, 2, 'analogRead(A0)')
      },
    },
    {
      name: 'warns when it would overheat (10 Ω straight across 5 V = 2.5 W)',
      run(kit) {
        kit.scene({ U: 'arduino', R: { type: 'resistor', resistance: 10 } }, [['R:1', 'U:5V'], ['R:2', 'U:GND1']])
        kit.step(0.02)
        kit.ok(kit.state('R').power > 2, 'power ≈ 2.5 W')
        kit.ok(kit.hasIssue('R:power'), 'an overheating issue is raised')
      },
    },
  ],
})
