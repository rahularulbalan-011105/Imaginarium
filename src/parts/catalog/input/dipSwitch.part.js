// SPST DIP switches, 4 / 6 / 8 positions (Tinkercad "DIP Switch SPST x4/x6/x8").
// Standard 300 mil DIP footprint, 2.54 mm pitch (e.g. Würth 4181xx / CTS 206):
// body n × 2.54 mm long, 9.9 mm wide, 5.65 mm tall above the board incl. the
// piano sliders; legs 3.0 mm. Pins are numbered like a DIP IC: switch k joins
// pin k (ON-side row, 1…n) to pin 2n+1−k straight across. Rating 25 mA 24 V DC
// switching, 100 mA carry, contact resistance ≤ 100 mΩ.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { sw } from '../../../circuit/mna.js'
import { mat, box, at, TIN, PITCH, dipPinXZ, dipPins, textPlane } from '../../model.js'

const LIFT = 0.30, BODY_H = 0.50, SLIDER_H = 0.065, BODY_D = 0.99, THROW = 0.17

function makeDip(n) {
  const type = `dip_switch_${n}`
  const names = Array.from({ length: 2 * n }, (_, i) => String(i + 1))
  const L = n * PITCH
  return definePart({
    type,
    label: `DIP Switch SPST ×${n}`,
    shortName: 'DIP',
    tinkercad: `DIP Switch SPST x${n}`,
    category: 'input',
    icon: '▤',
    desc: `${n} × SPST · 300 mil DIP · 25 mA 24 V`,
    purpose: `${n} independent on/off switches in one DIP package. Switch k connects pin k to the pin straight across (pin ${2 * n + 1}−k). Straddle the breadboard gap, wire one side to pins with INPUT_PULLUP and the other side to GND: an ON switch reads LOW. Flip each switch in the sim bar.`,
    usage: 'address / mode selection · configuration bits',
    spec: { dims_mm: { w: +(L * 10).toFixed(2), h: (LIFT + BODY_H + SLIDER_H) * 10, d: BODY_D * 10 }, mass_kg: 0.0004 + 0.0001 * n,
      rating: '25 mA 24 V DC switching, 100 mA carry', contact_mOhm: 100,
      summary: `Switch k joins pin k and pin ${2 * n + 1}−k. ON = slider toward the "ON" print (pin-1 row).` },
    pins: dipPins(names, { kinds: Object.fromEntries(names.map(nm => [nm, 'passive'])) }),
    build() {
      const g = new Group()
      for (let p = 1; p <= 2 * n; p++) {
        const { x, z } = dipPinXZ(2 * n, p)
        g.add(box(0.05, LIFT + 0.05, 0.025, TIN(), x, (LIFT + 0.05) / 2, z))
      }
      g.add(box(L, BODY_H, BODY_D, mat(0xc62828, { rough: 0.6 }), 0, LIFT + BODY_H / 2, 0))
      const top = LIFT + BODY_H
      for (let k = 1; k <= n; k++) {
        const { x } = dipPinXZ(2 * n, k)
        g.add(box(0.15, 0.01, 0.62, mat(0x2a0a0a), x, top + 0.005, 0))                       // slot
        const s = box(0.12, SLIDER_H, 0.24, mat(0xf5f5f5, { rough: 0.5 }), x, top + SLIDER_H / 2, -THROW)
        s.name = `sw_${k}`
        g.add(s)
        const num = textPlane(String(k), 0.14, 0.12, { fg: '#ffffff', bg: null })
        if (num) { num.rotation.x = -Math.PI / 2; g.add(at(num, x, top + 0.002, 0.40)) }
      }
      const on = textPlane('ON', 0.3, 0.1, { fg: '#ffffff', bg: null })
      if (on) { on.rotation.x = -Math.PI / 2; g.add(at(on, -L / 2 + 0.2, top + 0.002, -0.42)) }
      return g
    },
    sim: {
      controls: Array.from({ length: n }, (_, i) => ({ key: `s${i + 1}`, kind: 'toggle', label: String(i + 1), offLabel: 'OFF', onLabel: 'ON' })),
      circuit(api) {
        const s = []
        for (let k = 1; k <= n; k++) s.push(api.add(sw(api.pin(String(k)), api.pin(String(2 * n + 1 - k)), { Ron: 0.1 })))
        return { s }
      },
      beforeStep(h, api) { h.s.forEach((e, i) => { e.closed = !!api.control(`s${i + 1}`) }) },
      solved(h, api) {
        const on = h.s.map(e => e.closed)
        const imax = Math.max(...h.s.map(e => Math.abs(api.cur(e))))
        if (imax > 0.1) api.issue('current', 'error', `${api.obj.name}: ${(imax * 1000).toFixed(0)} mA through one switch`,
          'A DIP switch carries at most 100 mA (25 mA while switching). Use it for logic signals, not loads.')
        else api.clearIssue('current')
        return { on, current: imax }
      },
      visual(root, { solved }) {
        for (let k = 1; k <= n; k++) {
          const s = root.getObjectByName(`sw_${k}`)
          if (s) s.position.z = solved?.on?.[k - 1] ? THROW : -THROW
        }
      },
    },
    tests: [
      {
        name: `each of the ${n} switches pulls only its own INPUT_PULLUP pin LOW when ON`,
        run(kit) {
          const wires = []
          for (let k = 1; k <= n; k++) wires.push([`S:${k}`, `U:D${k + 1}`], [`S:${2 * n + 1 - k}`, 'U:GND1'])
          kit.scene({ U: 'arduino', S: type }, wires)
          for (let k = 1; k <= n; k++) kit.pinMode(k + 1, 'pullup')
          kit.step(0.02)
          for (let k = 1; k <= n; k++) kit.equal(kit.digitalRead(k + 1), 1, `all OFF: D${k + 1} HIGH`)
          for (let k = 1; k <= n; k++) {
            kit.control('S', `s${k}`, 1); kit.step(0.02)
            for (let j = 1; j <= n; j++) kit.equal(kit.digitalRead(j + 1), j === k ? 0 : 1, `only switch ${k} ON → D${j + 1}`)
            kit.control('S', `s${k}`, 0)
          }
        },
      },
      {
        name: 'end to end: a sketch reads the switches as a binary number',
        async run(kit, { runSketch }) {
          const wires = []
          for (let k = 1; k <= n; k++) wires.push([`S:${k}`, `U:D${k + 1}`], [`S:${2 * n + 1 - k}`, 'U:GND1'])
          kit.scene({ U: 'arduino', S: type }, wires)
          // Switches 1 and 3 ON → bits 0 and 2 → 1 + 4 = 5.
          kit.control('S', 's1', 1); kit.control('S', 's3', 1)
          const s = runSketch(kit, `void setup() {
  Serial.begin(9600);
  for (int i = 0; i < ${n}; i++) { pinMode(2 + i, INPUT_PULLUP); }
}
void loop() {
  int v = 0;
  for (int i = 0; i < ${n}; i++) { if (digitalRead(2 + i) == LOW) { v = v + (1 << i); } }
  Serial.println(v);
  delay(20);
}`)
          await s.run(200)
          s.stop()
          kit.equal(s.out[s.out.length - 1], '5\n', 'printed value')
        },
      },
    ],
  })
}

export default [4, 6, 8].map(makeDip)
