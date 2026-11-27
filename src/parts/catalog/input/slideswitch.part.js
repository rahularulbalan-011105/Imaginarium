// SPDT slide switch, SS12D00G4 style (Tinkercad "Slideswitch"). Body 8.6 × 3.6 ×
// 3.5 mm with a 4 mm lever, three legs on the 2.54 mm breadboard pitch:
// T1 · COM · T2. Lever toward T1 joins COM–T1; toward T2 joins COM–T2.
// Rating 0.5 A 50 V DC, contact resistance ≤ 30 mΩ (datasheet).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { sw } from '../../../circuit/mna.js'
import { mat, box, TIN, BLACK } from '../../model.js'

const P = 0.254, LEG = 0.35, BASE_T = 0.15, COVER_T = 0.20, LEVER = 0.40, TRAVEL = 0.10

export default definePart({
  type: 'slideswitch',
  label: 'Slide Switch (SPDT)',
  shortName: 'SW',
  tinkercad: 'Slideswitch',
  category: 'input',
  icon: '⇆',
  desc: 'SS12D00 SPDT · 0.5 A 50 V · 2.54 mm',
  purpose: 'Connects its middle leg (COM) to T1 or to T2, depending on the lever. Wire COM to a pin, T1 to GND and T2 to 5 V and the pin reads LOW or HIGH; or use it to switch a supply on and off. Flip it in the sim bar while the simulation runs.',
  usage: 'on/off switches · mode selection',
  spec: { dims_mm: { w: 8.6, h: 11.0, d: 3.6 }, mass_kg: 0.0006, rating: '0.5 A 50 V DC', contact_mOhm: 30,
    summary: 'SPDT: COM joins T1 (lever left) or T2 (lever right). Break-before-make.' },
  pins: [
    { name: 'T1', kind: 'passive', x: -P, y: 0.02, z: 0, r: 0.06 },
    { name: 'COM', kind: 'passive', x: 0, y: 0.02, z: 0, r: 0.06, ldy: 0.25 },
    { name: 'T2', kind: 'passive', x: P, y: 0.02, z: 0, r: 0.06 },
  ],
  build() {
    const g = new Group()
    for (const x of [-P, 0, P]) g.add(box(0.05, LEG, 0.03, TIN(), x, LEG / 2, 0))          // flat legs to y = 0
    g.add(box(0.86, BASE_T, 0.36, BLACK(), 0, LEG + BASE_T / 2, 0))                     // moulded base
    g.add(box(0.86, COVER_T, 0.36, TIN(), 0, LEG + BASE_T + COVER_T / 2, 0))             // steel cover
    const top = LEG + BASE_T + COVER_T
    g.add(box(0.40, 0.004, 0.17, mat(0x0a0a0a), 0, top + 0.002, 0))                      // lever slot
    const lever = box(0.15, LEVER, 0.15, mat(0x202020, { rough: 0.8 }), -TRAVEL, top + LEVER / 2, 0)
    lever.name = 'lever'
    g.add(lever)
    return g
  },
  sim: {
    controls: [{ key: 'pos', kind: 'toggle', label: 'Lever', offLabel: 'COM–T1', onLabel: 'COM–T2' }],
    circuit(api) {
      return {
        a: api.add(sw(api.pin('COM'), api.pin('T1'), { Ron: 0.03, closed: true })),
        b: api.add(sw(api.pin('COM'), api.pin('T2'), { Ron: 0.03 })),
      }
    },
    beforeStep(h, api) { const t2 = !!api.control('pos'); h.a.closed = !t2; h.b.closed = t2 },
    solved(h, api) {
      const i = Math.abs(api.cur(h.b.closed ? h.b : h.a))
      if (i > 0.5) api.issue('current', 'error', `${api.obj.name} switches ${(i * 1000).toFixed(0)} mA`, 'The SS12D00 is rated 0.5 A. Its contacts would weld or burn; switch the load through a relay or transistor.')
      else api.clearIssue('current')
      return { pos: h.b.closed ? 'T2' : 'T1', current: i }
    },
    visual(root, { solved }) {
      const l = root.getObjectByName('lever')
      if (l) l.position.x = solved?.pos === 'T2' ? TRAVEL : -TRAVEL
    },
  },
  tests: [
    {
      name: 'COM on an INPUT_PULLUP pin reads LOW toward T1 (GND) and HIGH toward T2 (open)',
      run(kit) {
        kit.scene({ U: 'arduino', S: 'slideswitch' }, [['S:COM', 'U:D2'], ['S:T1', 'U:GND1']])
        kit.pinMode(2, 'pullup'); kit.step(0.02)
        kit.equal(kit.digitalRead(2), 0, 'lever at T1: COM joined to GND')
        kit.control('S', 'pos', 1); kit.step(0.02)
        kit.equal(kit.digitalRead(2), 1, 'lever at T2: COM open, pull-up wins')
        kit.equal(kit.state('S').pos, 'T2')
      },
    },
    {
      name: 'selector: COM to A0 picks 5 V (T1) or GND (T2) — analogRead 1023 / 0',
      run(kit) {
        kit.scene({ U: 'arduino', S: 'slideswitch' }, [['S:COM', 'U:A0'], ['S:T1', 'U:5V'], ['S:T2', 'U:GND1']])
        kit.step(0.02)
        kit.near(kit.analogRead(14), 1023, 1, 'T1 = 5 V')
        kit.control('S', 'pos', 1); kit.step(0.02)
        kit.near(kit.analogRead(14), 0, 1, 'T2 = GND')
      },
    },
    {
      name: 'warns above its 0.5 A rating (5 V across 5 Ω through the switch = 1 A)',
      run(kit) {
        kit.scene({ U: 'arduino', S: 'slideswitch', R: { type: 'resistor', resistance: 5 } },
          [['S:COM', 'U:5V'], ['S:T1', 'R:1'], ['R:2', 'U:GND1']])
        kit.step(0.02)
        kit.ok(kit.state('S').current > 0.9, 'about 1 A flows')
        kit.ok(kit.hasIssue('S:current'), 'over-current issue')
      },
    },
  ],
})
