// Handheld digital multimeter (Tinkercad "Multimeter"), DT-830-class body
// 70 × 126 mm, 24 mm thick, lying on its back. Three 4 mm jacks at the bottom
// end: mA (fused), COM, VΩ. Mode buttons V / mA / Ω (live in the sim bar).
//
// Real input circuit:
//   V   mode  10 MΩ input resistance between VΩ and COM (standard DMM input).
//             In a time-varying circuit it shows the DC (average) value over the
//             display update, like a real DMM's integrating ADC.
//   mA  jack  a 1 Ω shunt + F200 mA fuse from mA to COM — ALWAYS in circuit, as
//             in a real meter. The meter reads I = Vshunt / 1 Ω. It must be in
//             SERIES with the load; across a supply it is a 1 Ω short and the
//             fuse blows (latched open for the rest of the run, like a real fuse).
//   Ω   mode  ratiometric ohmmeter: a 1.0 V reference behind a range resistor
//             Rref (100 Ω … 10 MΩ, auto-ranged) — i.e. a known test current
//             (1 V − V)/Rref — and Rx = V·Rref / (1 V − V). Only valid on an
//             unpowered part: every other display update the meter switches its
//             source off and checks for a foreign voltage, and warns if found.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { resistor, vsource } from '../../../circuit/mna.js'
import { mat, box, cyl, at, textPlane } from '../../model.js'
import { screenMesh, lcdText, fmt4 } from './screen.js'

const R_IN = 10e6, R_SHUNT = 1.0, FUSE_A = 0.2, OPEN = 1e12
const V_TEST = 1.0, RANGES = [100, 1e3, 1e4, 1e5, 1e6, 1e7], R_OL = 40e6
const W = 7.0, H = 2.4, D = 12.6
const JACK_Z = 4.9, JACK_X = { mA: -1.9, COM: 0, V: 1.9 }
const MODE_OF_BUTTON = { V: 'V', mA: 'A', 'Ω': 'R' }
const MODE_LABEL = { V: 'DC V', A: 'DC mA', R: 'Ω' }

export default definePart({
  type: 'multimeter',
  label: 'Multimeter',
  shortName: 'DMM',
  tinkercad: 'Multimeter',
  category: 'instruments',
  icon: '📟',
  desc: 'DMM · DC V (10 MΩ) · DC mA (1 Ω, 200 mA fuse) · Ω',
  purpose: 'Measures voltage, current or resistance. VOLTS: black lead (COM) and red lead (VΩ) ACROSS the part. CURRENT: break the circuit and put the meter IN SERIES using the mA and COM jacks — never across a battery, or the fuse blows. OHMS: across a part with the power OFF. Change mode with the V / mA / Ω buttons.',
  usage: 'checking battery voltage · measuring LED current · reading resistor values',
  spec: {
    dims_mm: { w: 70, h: 24, d: 126 }, mass_kg: 0.2,
    input_ohm: R_IN, shunt_ohm: R_SHUNT, fuse_A: FUSE_A, ohm_test_V: V_TEST, ohm_ranges: RANGES,
    summary: 'V: 10 MΩ input. mA: 1 Ω shunt, 200 mA fuse (in series only). Ω: 1 V ratiometric source, auto-range 100 Ω–10 MΩ (unpowered parts only).',
  },
  props: {
    mode: { type: 'select', label: 'Mode at start', default: 'V', options: [{ value: 'V', label: 'DC volts' }, { value: 'A', label: 'DC current (mA)' }, { value: 'R', label: 'Resistance (Ω)' }] },
  },
  pins: [
    { name: 'mA', kind: 'passive', label: 'mA', x: JACK_X.mA, y: H + 0.05, z: JACK_Z, r: 0.2 },
    { name: 'COM', kind: 'gnd', label: 'COM', x: JACK_X.COM, y: H + 0.05, z: JACK_Z, r: 0.2 },
    { name: 'V', kind: 'power', label: 'VΩ', x: JACK_X.V, y: H + 0.05, z: JACK_Z, r: 0.2 },
  ],
  build() {
    const g = new Group()
    g.add(box(W, H * 0.8, D, mat(0xf59e0b, { rough: 0.8 }), 0, H * 0.4, 0))                     // rubber holster
    g.add(box(W - 0.6, H * 0.2, D - 0.6, mat(0x1f2937, { rough: 0.6 }), 0, H * 0.8 + H * 0.1, 0)) // face plate
    g.add(box(W - 1.2, 0.05, 2.9, mat(0x111111), 0, H - 0.02, -D / 2 + 2.3))                    // LCD bezel
    const lcd = screenMesh('lcd', W - 1.6, 2.4, { pxW: 256, pxH: 112, bg: '#a7b89f' })
    lcd.rotation.x = -Math.PI / 2
    g.add(at(lcd, 0, H + 0.011, -D / 2 + 2.3))
    // Rotary dial + pointer
    g.add(at(cyl(2.0, 0.2, mat(0x111827, { rough: 0.5 }), { seg: 36 }), 0, H - 0.05, 0.3))
    const ptr = box(0.35, 0.08, 2.6, mat(0xe5e7eb), 0, H + 0.09, 0.3)
    ptr.name = 'dial'
    g.add(ptr)
    // Jacks: red ring for VΩ and mA, black for COM.
    for (const [k, x] of Object.entries(JACK_X)) {
      g.add(at(cyl(0.45, 0.2, mat(k === 'COM' ? 0x111111 : 0xd32f2f, { rough: 0.4 }), { seg: 20 }), x, H - 0.05, JACK_Z))
      g.add(at(cyl(0.22, 0.05, mat(0x050505), { seg: 16 }), x, H + 0.06, JACK_Z))
      const t = textPlane(k === 'V' ? 'VΩ' : k, 1.1, 0.4, { fg: '#f3f4f6', bg: null })
      if (t) { t.rotation.x = -Math.PI / 2; g.add(at(t, x, H + 0.011, JACK_Z - 0.85)) }
    }
    return g
  },
  sim: {
    controls: [{ key: 'mode', kind: 'buttons', label: 'Mode', rows: [['V', 'mA', 'Ω']] }],
    circuit(api) {
      const V = api.pin('V'), COM = api.pin('COM'), MA = api.pin('mA')
      const rin = api.add(resistor(V, COM, R_IN))
      const ohm = api.add(vsource(V, COM, 0, OPEN))          // Norton source, off unless Ω mode
      const shunt = api.add(resistor(MA, COM, R_SHUNT))
      const m = api.prop('mode')
      return { rin, ohm, shunt, mode: ['V', 'A', 'R'].includes(m) ? m : 'V', range: 3, phase: 'on', fuse: true,
        accV: 0, accI: 0, accT: 0, iPeak: 0, reading: null }
    },
    beforeStep(h, api) {
      const b = MODE_OF_BUTTON[api.control('mode')]
      if (b && b !== h.mode) { h.mode = b; h.reading = null; h.phase = 'on' }
      h.rin.R = h.mode === 'V' ? R_IN : OPEN
      if (h.mode === 'R') { h.ohm.r = RANGES[h.range]; h.ohm.V = h.phase === 'on' ? V_TEST : 0 }
      else { h.ohm.r = OPEN; h.ohm.V = 0 }
      h.shunt.R = h.fuse ? R_SHUNT : OPEN
    },
    afterStep(h, api, dt) {
      const vv = api.vpin('V') - api.vpin('COM')
      const ii = (api.vpin('mA') - api.vpin('COM')) / h.shunt.R
      h.accV += vv * dt; h.accI += ii * dt; h.accT += dt
      h.iPeak = Math.max(h.iPeak, Math.abs(ii))
    },
    solved(h, api) {
      const name = api.obj.name || 'Multimeter'
      const vNow = api.vpin('V') - api.vpin('COM')
      const iNow = (api.vpin('mA') - api.vpin('COM')) / h.shunt.R
      const avg = h.accT > 0
      const vAvg = avg ? h.accV / h.accT : vNow, iAvg = avg ? h.accI / h.accT : iNow
      const iPk = Math.max(Math.abs(iNow), h.iPeak)
      h.accV = h.accI = h.accT = 0; h.iPeak = 0

      // Fuse (latched): >200 mA through the mA jack.
      if (h.fuse && iPk > FUSE_A) {
        h.fuse = false
        h.fuseDetail = h.mode === 'A'
          ? `In current mode the meter is a ${R_SHUNT} Ω shunt between mA and COM, so wired ACROSS a source it is a short circuit: ${fmt4(iPk, 'A')} flowed and the 200 mA fuse blew. An ammeter goes IN SERIES: break the circuit and let the current flow through the meter.`
          : `The red lead was in the mA jack, which is a ${R_SHUNT} Ω shunt to COM in every mode: ${fmt4(iPk, 'A')} flowed and the 200 mA fuse blew. For voltage, move the red lead to VΩ.`
      }
      if (!h.fuse) api.issue('fuse', 'error', `${name}: the mA fuse has blown`, h.fuseDetail)
      else api.clearIssue('fuse')

      const vConn = api.connected('V'), aConn = api.connected('mA')
      if (h.mode === 'A' && vConn && !aConn) api.issue('jack', 'warning', `${name} is in current mode but the red lead is in VΩ`,
        'Current is measured through the mA jack. Move the red lead to mA (and wire the meter in series).')
      else if (h.mode !== 'A' && aConn && !vConn) api.issue('jack', 'warning', `${name}: the red lead is in the mA jack`,
        `For ${h.mode === 'V' ? 'voltage' : 'resistance'} use the VΩ jack. The mA jack is a 1 Ω path to COM.`)
      else api.clearIssue('jack')

      let value = 0, unit = 'V', display = ''
      if (h.mode === 'V') {
        value = vAvg; unit = 'V'
        display = Math.abs(value) > 1000 ? 'OL' : fmt4(value, 'V')
        api.clearIssue('powered')
      } else if (h.mode === 'A') {
        value = h.fuse ? iAvg : 0; unit = 'A'
        display = h.fuse ? (Math.abs(value) > FUSE_A ? 'OL' : fmt4(value, 'A')) : 'FUSE'
        api.clearIssue('powered')
      } else {
        unit = 'Ω'
        const Rref = RANGES[h.range]
        if (h.phase === 'on') {
          const iInj = (V_TEST - vNow) / Rref                // known test current into the part
          const rx = iInj > 1e-12 ? vNow / iInj : Infinity
          h.negative = rx < 0 || vNow < -1e-6
          if (!(rx >= 0) || rx > R_OL) { h.reading = Infinity; h.range = RANGES.length - 1 }
          else {
            h.reading = rx
            h.range = Math.max(0, Math.min(RANGES.length - 1, Math.round(Math.log10(Math.max(rx, 1))) - 2))
          }
          h.phase = 'off'
        } else {
          h.foreign = Math.abs(vNow) > 0.01
          h.phase = 'on'
        }
        if (h.foreign || h.negative) api.issue('powered', 'warning', `${name}: measuring resistance on a powered circuit`,
          'An ohmmeter injects its own small test current, so any other source in the circuit makes the reading wrong (and can damage a real meter). Disconnect the power, or take the part out of the circuit, then measure.')
        else api.clearIssue('powered')
        value = h.reading ?? NaN
        display = h.reading == null ? '----' : (h.reading === Infinity ? 'OL' : fmt4(h.reading, 'Ω'))
      }
      return { mode: h.mode, value, unit, display, fuse: h.fuse, range: RANGES[h.range] }
    },
    readout: ({ solved }) => (solved ? `${MODE_LABEL[solved.mode]} ${solved.display}` : null),
    visual(root, { solved, off }) {
      const lcd = root.getObjectByName('lcd')
      lcdText(lcd, off || !solved ? '' : solved.display, { sub: off || !solved ? '' : MODE_LABEL[solved.mode] })
      const dial = root.getObjectByName('dial')
      if (dial) dial.rotation.y = !solved ? 0 : solved.mode === 'V' ? 0.6 : solved.mode === 'A' ? -0.6 : 0
    },
  },
  tests: [
    {
      name: 'DC volts: reads a 9 V battery as 9·10 MΩ/(10 MΩ + 1.7 Ω) = 9.000 V',
      run(kit) {
        kit.scene({ B: 'battery_9v', M: 'multimeter' }, [['M:V', 'B:POS'], ['M:COM', 'B:NEG']])
        kit.step(0.05)
        kit.near(kit.state('M').value, 9 * 10e6 / (10e6 + 1.7), 1e-6, 'voltage reading')
        kit.equal(kit.state('M').display, '9.000 V')
        kit.near(kit.state('B').current, 9 / (10e6 + 1.7), 1e-9, 'the meter draws only 0.9 µA')
      },
    },
    {
      name: 'DC volts: midpoint of a 10 k / 10 k divider on 9 V = 4.5 V (10 MΩ load lowers it by 0.05 %)',
      run(kit) {
        kit.scene({ B: 'battery_9v', R1: { type: 'resistor', resistance: 10000 }, R2: { type: 'resistor', resistance: 10000 }, M: 'multimeter' },
          [['B:POS', 'R1:1'], ['R1:2', 'R2:1'], ['R2:2', 'B:NEG'], ['M:V', 'R1:2'], ['M:COM', 'B:NEG']])
        kit.step(0.05)
        // Lower leg 10k ∥ 10M = 9990.01 Ω → V = 9 · 9990.01 / (10000 + 9990.01 + 1.7)
        kit.near(kit.state('M').value, 9 * 9990.01 / 19991.71, 1e-4)
      },
    },
    {
      name: 'resistance: the Ω button, then a 4.7 kΩ resistor reads 4.700 kΩ',
      run(kit) {
        kit.scene({ M: 'multimeter', R: { type: 'resistor', resistance: 4700 } }, [['M:V', 'R:1'], ['M:COM', 'R:2']])
        kit.step(0.05)
        kit.equal(kit.state('M').mode, 'V')
        kit.control('M', 'mode', 'Ω'); kit.step(1 / 60); kit.control('M', 'mode', '')
        kit.step(0.2)
        kit.equal(kit.state('M').mode, 'R')
        kit.near(kit.state('M').value, 4700, 0.5, 'Rx')
        kit.equal(kit.state('M').display, '4.700 kΩ')
        kit.equal(kit.state('M').range, 1e4, 'auto-ranged to the 10 kΩ reference')
        kit.ok(!kit.hasIssue('M:powered'))
      },
    },
    {
      name: 'resistance: 1 MΩ reads 1.000 MΩ, open leads read OL',
      run(kit) {
        kit.scene({ M: { type: 'multimeter', mode: 'R' }, R: { type: 'resistor', resistance: 1e6 } }, [['M:V', 'R:1'], ['M:COM', 'R:2']])
        kit.step(0.2)
        kit.near(kit.state('M').value, 1e6, 100)
        kit.scene({ M: { type: 'multimeter', mode: 'R' } })
        kit.step(0.2)
        kit.equal(kit.state('M').display, 'OL')
      },
    },
    {
      name: 'resistance on a powered resistor warns (the reading would be wrong)',
      run(kit) {
        kit.scene({ B: 'battery_9v', R: { type: 'resistor', resistance: 1000 }, M: { type: 'multimeter', mode: 'R' } },
          [['B:POS', 'R:1'], ['R:2', 'B:NEG'], ['M:V', 'R:1'], ['M:COM', 'R:2']])
        kit.step(0.2)
        kit.ok(kit.hasIssue('M:powered'), 'powered-circuit warning')
      },
    },
    {
      name: 'series current: 9 V → 1 kΩ → mA → COM reads 9 / (1000 + 1.7 + 1) = 8.976 mA',
      run(kit) {
        kit.scene({ B: 'battery_9v', R: { type: 'resistor', resistance: 1000 }, M: { type: 'multimeter', mode: 'A' } },
          [['B:POS', 'R:1'], ['R:2', 'M:mA'], ['M:COM', 'B:NEG']])
        kit.step(0.05)
        kit.near(kit.state('M').value, 9 / 1002.7, 1e-7, 'current reading')
        kit.equal(kit.state('M').display, '8.976 mA')
        kit.ok(!kit.hasIssue('M:fuse'))
      },
    },
    {
      name: 'current mode straight across a 9 V battery: 9 / (1.7 + 1) = 3.3 A blows the 200 mA fuse',
      run(kit) {
        kit.scene({ B: 'battery_9v', M: { type: 'multimeter', mode: 'A' } }, [['M:mA', 'B:POS'], ['M:COM', 'B:NEG']])
        kit.step(0.05)
        kit.ok(kit.hasIssue('M:fuse'), 'fuse-blown error')
        kit.equal(kit.state('M').display, 'FUSE')
        kit.near(kit.state('B').current, 0, 1e-6, 'the blown fuse opens the circuit')
      },
    },
  ],
})
