// 21-key NEC infrared remote, the "Car MP3" / Elegoo kit remote that Tinkercad
// ships (Tinkercad "IR Remote"). ≈40 × 86 × 6.5 mm, CR2025 coin cell (3 V),
// 940 nm IR LED, NEC protocol at 38 kHz, address 0x00 (codes: irRemoteCodes.js).
// Pressing a button sends its frame to every POWERED IR receiver in the scene;
// holding it sends NEC repeat frames. The two pins are the coin-cell contacts
// (the remote powers itself; nothing needs wiring).
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, box, cyl, at, setGlow, textPlane } from '../../model.js'
import { REMOTE_ROWS, NEC_COMMANDS, NEC_ADDRESS, necFrame } from './irRemoteCodes.js'

const W = 4.0, H = 0.65, D = 8.6, BTN_R = 0.38, BTN_H = 0.1
const btnXZ = (r, c) => ({ x: (c - 1) * 1.15, z: -2.75 + r * 1.0 })
const btnColor = (k) => (k === 'PWR' ? 0xc62828 : /^\d$/.test(k) ? 0x2b2b2b : 0x3a3a3a)

export default definePart({
  type: 'ir_remote',
  label: 'IR Remote (NEC, 21 keys)',
  shortName: 'REMOTE',
  tinkercad: 'IR Remote',
  category: 'comms',
  icon: '🎛',
  desc: 'NEC 38 kHz · address 0x00 · CR2025',
  purpose: 'A handheld infrared remote. Press its buttons in the sim bar: each sends its real NEC code (e.g. POWER = 0x45, "1" = 0x0C) to every powered IR receiver in the scene. No wiring needed — it runs on its own coin cell.',
  usage: 'remote-controlled robots and lights · menu navigation',
  spec: { dims_mm: { w: 40, h: 7.5, d: 86 }, mass_kg: 0.012, protocol: 'NEC', carrier_kHz: 38, address: NEC_ADDRESS, battery: 'CR2025 3 V', wavelength_nm: 940,
    summary: 'Sends NEC frames (address 0x00) to every powered IR receiver; holding a key sends repeat frames every 108 ms.' },
  props: {
    battery: { type: 'bool', label: 'CR2025 coin cell fitted', default: true },
  },
  pins: [
    { name: 'BAT+', kind: 'power', label: 'BAT+', x: -0.5, y: 0.02, z: 3.6, r: 0.07 },
    { name: 'BAT-', kind: 'gnd', label: 'BAT−', x: 0.5, y: 0.02, z: 3.6, r: 0.07, ldy: 0.25 },
  ],
  build() {
    const g = new Group()
    g.add(box(W, H, D, mat(0x1b1b1b, { rough: 0.7 }), 0, H / 2, 0))
    g.add(box(W * 0.9, 0.004, D * 0.92, mat(0x262626, { rough: 0.8 }), 0, H + 0.002, 0.1))     // face panel
    const led = cyl(0.25, 0.3, mat(0x3a2230, { emissive: 0x000000, rough: 0.3 }), { axis: 'z' })
    led.name = 'irled'
    g.add(at(led, 0, H / 2, -D / 2 - 0.1))                                                  // IR LED at the front
    g.add(box(2.2, 0.02, 2.4, mat(0x111111), 0, 0.01, 3.4))                                 // battery tray (underside)
    REMOTE_ROWS.forEach((row, r) => row.forEach((k, c) => {
      const { x, z } = btnXZ(r, c)
      const b = cyl(BTN_R, BTN_H, mat(btnColor(k), { rough: 0.6 }))
      b.name = `btn_${k}`
      g.add(at(b, x, H + BTN_H / 2, z))
      const t = textPlane(k, 0.6, 0.3, { fg: '#ffffff', bg: null })
      if (t) { t.rotation.x = -Math.PI / 2; b.add(at(t, 0, BTN_H / 2 + 0.002, 0)) }
    }))
    return g
  },
  sim: {
    controls: [{ key: 'btn', kind: 'buttons', label: 'Remote', rows: REMOTE_ROWS }],
    initState: () => ({ held: '', seq: 0, last: null }),
    // Parent side: turn a newly pressed button into a frame (seq counts presses).
    input(api) {
      const on = !!api.prop('battery')
      const label = on ? (api.control('btn') || '') : ''
      const st = api.state
      if (label && label !== st.held && NEC_COMMANDS[label] != null) {
        st.seq++
        const cmd = NEC_COMMANDS[label]
        st.last = { label, cmd, ...necFrame(NEC_ADDRESS, cmd) }
      }
      st.held = label
      const f = st.last ?? { cmd: 0, raw: 0, value: 0 }
      return { on, seq: st.seq, held: !!label, addr: NEC_ADDRESS, cmd: f.cmd, raw: f.raw, value: f.value }
    },
    visual(root, { state, off }) {
      const held = off ? '' : state?.held
      for (const row of REMOTE_ROWS) for (const k of row) {
        const b = root.getObjectByName(`btn_${k}`)
        if (b) b.position.y = H + BTN_H / 2 - (held === k ? 0.05 : 0)
      }
      const led = root.getObjectByName('irled')
      if (led) setGlow(led, 0x803060, held ? 0.5 : 0)      // what a phone camera shows
    },
    readout({ state }) {
      if (!state?.last) return null
      return `${state.last.label} → NEC 0x${state.last.cmd.toString(16).toUpperCase().padStart(2, '0')}`
    },
  },
  tests: [
    {
      name: 'frames carry the real NEC codes (POWER 0x45 → 0xFFA25D classic, 0xBA45FF00 raw); one frame per press',
      run(kit) {
        kit.scene({ U: 'arduino', RC: 'ir_remote' })
        kit.equal(kit.input().ir_remote.RC.seq, 0, 'nothing sent yet')
        kit.control('RC', 'btn', 'PWR')
        let f = kit.input().ir_remote.RC
        kit.equal(f.cmd, 0x45); kit.equal(f.value, 0xFFA25D); kit.equal(f.raw, 0xBA45FF00); kit.equal(f.seq, 1); kit.ok(f.held)
        kit.equal(kit.input().ir_remote.RC.seq, 1, 'holding is not a new press')
        kit.control('RC', 'btn', ''); kit.input()
        kit.control('RC', 'btn', '3')
        f = kit.input().ir_remote.RC
        // "3" = command 0x5E: bit-reversed 0x7A, inverse 0x85 → classic 0xFF7A85.
        kit.equal(f.seq, 2); kit.equal(f.cmd, 0x5E); kit.equal(f.value, 0xFF7A85)
      },
    },
    {
      name: 'end to end: pressing remote buttons → the receiver sketch prints their NEC commands',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', IR: 'ir_receiver', RC: 'ir_remote' }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:GND1'], ['IR:VS', 'U:5V']])
        const s = runSketch(kit, `#include <IRremote.hpp>
void setup() { Serial.begin(9600); IrReceiver.begin(11, ENABLE_LED_FEEDBACK); }
void loop() {
  if (IrReceiver.decode()) {
    if (IrReceiver.decodedIRData.flags == 0) { Serial.println(IrReceiver.decodedIRData.command); }
    IrReceiver.resume();
  }
  delay(5);
}`)
        await s.run(60)
        for (const b of ['PWR', '1', 'VOL+']) {
          kit.control('RC', 'btn', b); await s.run(70)
          kit.control('RC', 'btn', ''); await s.run(50)
        }
        s.stop()
        // PWR 0x45 = 69, "1" 0x0C = 12, VOL+ 0x46 = 70.
        kit.equal(s.out.join('|'), '69\n|12\n|70\n')
      },
    },
    {
      name: 'without its coin cell the remote sends nothing',
      async run(kit, { runSketch }) {
        kit.scene({ U: 'arduino', IR: 'ir_receiver', RC: { type: 'ir_remote', battery: false } }, [['IR:OUT', 'U:D11'], ['IR:GND', 'U:GND1'], ['IR:VS', 'U:5V']])
        const s = runSketch(kit, `#include <IRremote.hpp>
void setup() { Serial.begin(9600); IrReceiver.begin(11, ENABLE_LED_FEEDBACK); }
void loop() { if (IrReceiver.decode()) { Serial.println(IrReceiver.decodedIRData.command); IrReceiver.resume(); } delay(5); }`)
        kit.control('RC', 'btn', 'PWR'); await s.run(150)
        s.stop()
        kit.equal(s.out.length, 0)
      },
    },
  ],
})
