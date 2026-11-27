// Miniature incandescent lamp in an E10 holder (Tinkercad "Light Bulb").
// Default lamp: 6.3 V 0.15 A (#47 class, T-3¼ glass Ø10 mm). Holder 14 × 14 mm
// with two solder legs 5.08 mm apart.
//
// Tungsten filament: its resistance rises ≈10× from cold to white hot. The
// steady-state lamp law I ∝ V^0.55 gives R(V) = R_hot·(V/V_rated)^0.45, never
// below R_cold = R_hot / 10; the filament follows that with a ≈30 ms thermal
// lag, so switching on shows the real inrush. Light output ∝ V^3.4 ⇒
// brightness ≈ (P/P_rated)^2.2. Above ≈130 % of its rated voltage the filament
// fails within a fraction of a second and the lamp goes open-circuit.
import { Group, Mesh, SphereGeometry, TorusGeometry } from 'three'
import { definePart } from '../../definePart.js'
import { resistor } from '../../../circuit/mna.js'
import { mat, box, cyl, at, lead, setGlow, TIN, BLACK } from '../../model.js'

const LEG = 0.254                    // legs ±2.54 mm → 5.08 mm apart
const BASE_Y = 0.2, BASE_H = 0.8
const SCREW_Y = BASE_Y + BASE_H      // E10 screw shell sits in the holder top
const GLASS_R = 0.5
const TAU = 0.03                     // s  filament thermal time constant
const FAIL_RATIO = 1.3, FAIL_T = 0.2 // >130 % rated V for 0.2 s burns the filament

const ratings = (api) => {
  const Vr = Math.max(0.5, api.prop('ratedVoltage')), Ir = Math.max(0.005, api.prop('ratedCurrent'))
  const Rhot = Vr / Ir
  return { Vr, Ir, Rhot, Rcold: Rhot / 10, Pr: Vr * Ir }
}

export default definePart({
  type: 'light_bulb',
  label: 'Light Bulb',
  shortName: 'LAMP',
  tinkercad: 'Light Bulb',
  category: 'lights',
  icon: '💡',
  desc: 'Incandescent · 6.3 V 0.15 A (set rating)',
  purpose: 'A small filament lamp. Connect it across a supply near its rated voltage (it has no polarity). Its cold filament draws ≈10× the running current for a moment; too much voltage burns it out. An Arduino pin cannot power it — use the 5 V pin, a battery, or a transistor.',
  usage: 'indicator lamps · lighting · resistance-vs-temperature demos',
  spec: {
    dims_mm: { w: 14, h: 25.5, d: 14 }, mass_kg: 0.002,
    rated: '6.3 V 0.15 A (0.95 W)', coldToHot: 0.1,
    summary: 'Tungsten filament: R_hot = V/I at rating (42 Ω), R_cold ≈ R_hot/10. Lamp law I ∝ V^0.55, light ∝ V^3.4.',
  },
  props: {
    ratedVoltage: { type: 'number', label: 'Rated voltage', unit: 'V', default: 6.3, min: 1.2, max: 24 },
    ratedCurrent: { type: 'number', label: 'Rated current', unit: 'A', default: 0.15, min: 0.02, max: 1 },
  },
  pins: [
    { name: '1', kind: 'passive', x: -LEG, y: 0.02, z: 0, r: 0.07 },
    { name: '2', kind: 'passive', x: LEG, y: 0.02, z: 0, r: 0.07 },
  ],
  build() {
    const g = new Group()
    g.add(at(cyl(0.7, BASE_H, BLACK(), { seg: 32 }), 0, BASE_Y + BASE_H / 2, 0))        // E10 holder
    g.add(box(1.4, 0.12, 0.5, BLACK(), 0, BASE_Y + 0.06, 0))                           // mounting tabs
    for (const s of [-1, 1]) {
      g.add(box(0.12, 0.3, 0.04, TIN(), s * LEG, BASE_Y + 0.05, 0))                    // solder lugs
      g.add(lead([s * LEG, BASE_Y, 0], [s * LEG, 0, 0], { r: 0.03 }))
    }
    // E10 screw shell + threads.
    g.add(at(cyl(0.5, 0.6, TIN(), { seg: 28 }), 0, SCREW_Y + 0.3, 0))
    for (let i = 0; i < 3; i++) {
      const t = new Mesh(new TorusGeometry(0.5, 0.025, 6, 28), TIN())
      t.rotation.x = Math.PI / 2
      g.add(at(t, 0, SCREW_Y + 0.12 + i * 0.18, 0))
    }
    // Glass envelope (T-3¼ Ø10 mm).
    const glass = new Mesh(new SphereGeometry(GLASS_R, 28, 18), mat(0xf7f3e8, { rough: 0.1, emissive: 0x000000, opacity: 0.35 }))
    glass.name = 'glass'
    g.add(at(glass, 0, SCREW_Y + 0.6 + GLASS_R * 0.9, 0))
    // Support wires + coiled filament.
    const fy = SCREW_Y + 0.6 + GLASS_R * 0.95
    for (const s of [-1, 1]) g.add(lead([s * 0.08, SCREW_Y + 0.62, 0], [s * 0.16, fy, 0], { r: 0.008 }))
    const fil = cyl(0.025, 0.32, mat(0x6b5a3a, { metal: 0.6, rough: 0.4, emissive: 0x000000 }), { axis: 'x', seg: 8 })
    fil.name = 'filament'
    g.add(at(fil, 0, fy, 0))
    return g
  },
  sim: {
    circuit(api) {
      const r = ratings(api)
      return { r: api.add(resistor(api.pin('1'), api.pin('2'), r.Rcold)), R: r.Rcold, burnt: false, over: 0, ...r }
    },
    beforeStep(h, api, dt) {
      if (h.burnt) { h.r.R = 1e9; return }
      const v = Math.abs(api.vpin('1') - api.vpin('2'))
      if (v > FAIL_RATIO * h.Vr && dt > 0) { h.over += dt; if (h.over >= FAIL_T) h.burnt = true } else h.over = 0
      if (h.burnt) { h.r.R = 1e9; return }
      if (!(dt > 0)) { h.r.R = h.R; return }                  // DC start-up: cold filament
      const target = Math.max(h.Rcold, h.Rhot * Math.pow(v / h.Vr, 0.45))
      h.R += (target - h.R) * (1 - Math.exp(-dt / TAU))
      h.r.R = h.R
    },
    solved(h, api) {
      const v = api.vpin('1') - api.vpin('2'), i = api.cur(h.r), p = Math.abs(v * i)
      const name = api.obj.name || 'Light bulb'
      if (h.burnt) api.issue('burnt', 'error', `${name} has burnt out`,
        `It ran above ${(FAIL_RATIO * h.Vr).toFixed(1)} V (rated ${h.Vr} V) and the filament melted. Use a lamp rated for your supply or add a series resistor.`)
      else api.clearIssue('burnt')
      if (!h.burnt && Math.abs(v) > 1.1 * h.Vr) api.issue('overvoltage', 'warning', `${name} is over-driven (${Math.abs(v).toFixed(2)} V)`,
        `Its rating is ${h.Vr} V. Filament life falls steeply (≈V^-12) above the rated voltage.`)
      else api.clearIssue('overvoltage')
      const brightness = h.burnt ? 0 : Math.min(1.5, Math.pow(p / h.Pr, 2.2))
      return { voltage: v, current: i, power: p, resistance: h.burnt ? Infinity : h.r.R, brightness, burnt: h.burnt }
    },
    visual(root, { solved, off }) {
      const L = off || !solved ? 0 : Math.min(1, solved.brightness)
      // Colour temperature: dull red when barely on, warm white at rating.
      const color = L > 0.5 ? 0xffd27a : L > 0.15 ? 0xffa040 : 0xff5a1a
      setGlow(root.getObjectByName('filament'), color, L)
      setGlow(root.getObjectByName('glass'), 0xffe2a8, L * 0.6)
    },
    readout({ solved }) {
      if (!solved) return ''
      return solved.burnt ? 'burnt out' : `${Math.abs(solved.voltage).toFixed(2)} V · ${(Math.abs(solved.current) * 1000).toFixed(0)} mA · ${solved.resistance.toFixed(1)} Ω`
    },
  },
  tests: [
    {
      name: '6.3 V 0.15 A lamp on the 5 V pin: cold inrush, then the hot filament settles',
      run(kit) {
        kit.scene({ U: 'arduino', B: 'light_bulb' }, [['B:1', 'U:5V'], ['B:2', 'U:GND1']])
        // R_hot = 6.3 / 0.15 = 42 Ω, R_cold = 4.2 Ω. At switch-on: 5 / (4.2 + 0.05 supply) ≈ 1.18 A.
        kit.near(kit.state('B').current, 5 / 4.25, 0.02, 'cold inrush current')
        kit.step(1)
        // Settled: R = 42·(5/6.3)^0.45 = 42·0.9012 = 37.85 Ω → I = 5/37.9 ≈ 132 mA, P ≈ 0.66 W.
        kit.near(kit.state('B').resistance, 37.85, 0.3, 'hot filament resistance')
        kit.near(kit.state('B').current, 0.132, 0.002, 'running current')
        // Light ∝ (P/Pr)^2.2 = (0.660/0.945)^2.2 ≈ 0.45.
        kit.near(kit.state('B').brightness, 0.45, 0.02, 'brightness')
        kit.ok(kit.mesh('B').getObjectByName('filament').material.emissiveIntensity > 0.5, 'filament glows')
        kit.ok(!kit.hasIssue('B:burnt'), 'not burnt')
      },
    },
    {
      name: 'a 2.5 V lamp on 5 V burns out and goes open-circuit',
      run(kit) {
        kit.scene({ U: 'arduino', B: { type: 'light_bulb', ratedVoltage: 2.5, ratedCurrent: 0.3 } }, [['B:1', 'U:5V'], ['B:2', 'U:GND1']])
        kit.step(0.5)
        // 5 V = 200 % of rating (> 130 % for more than 0.2 s) → filament fails.
        kit.ok(kit.state('B').burnt, 'filament burnt')
        kit.ok(kit.hasIssue('B:burnt'), 'burn-out issue raised')
        kit.near(kit.state('B').current, 0, 1e-6, 'no current through an open filament')
        kit.equal(kit.state('B').brightness, 0, 'dark')
      },
    },
    {
      name: 'in series with 47 Ω from 5 V the lamp glows only dimly (filament stays cooler)',
      run(kit) {
        kit.scene({ U: 'arduino', B: 'light_bulb', R: { type: 'resistor', resistance: 47 } },
          [['U:5V', 'R:1'], ['R:2', 'B:1'], ['B:2', 'U:GND1']])
        kit.step(1.5)
        // Fixed point of R_b = 42·(V_b/6.3)^0.45 with V_b = 5·R_b/(47.05 + R_b):
        // R_b ≈ 22.9 Ω, V_b ≈ 1.64 V, I ≈ 71.5 mA, P ≈ 0.117 W → brightness (0.117/0.945)^2.2 ≈ 0.010.
        kit.near(kit.state('B').resistance, 22.9, 0.5, 'cooler filament has lower R')
        kit.near(kit.state('B').current, 0.0715, 0.0015, 'series current')
        kit.between(kit.state('B').brightness, 0.005, 0.03, 'dim glow')
      },
    },
  ],
})
