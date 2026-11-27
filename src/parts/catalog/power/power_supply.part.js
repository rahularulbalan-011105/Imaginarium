// Linear bench DC power supply, 0–30 V / 0–5 A (Tinkercad "Power Supply").
// Size of a typical single-output 30 V 5 A unit (Korad KA3005D class):
// ≈ 150 W × 160 H × 260 D mm. Red (+) and black (−) 4 mm binding posts on the
// front panel, two 4-digit displays (V, A) and CV / CC indicator LEDs.
//
// Behaviour of a real CV/CC supply: it holds the set voltage (constant voltage,
// CV) while the load draws less than the current limit; when the load would
// draw more, it lowers its voltage so that exactly the limit flows (constant
// current, CC). Modelled by one element that is an ideal voltage source in CV
// and an ideal current source in CC; the mode is chosen inside the solver's
// Newton loop (it switches CV→CC when I > Ilim, CC→CV when V > Vset), so the
// solution is the exact intersection of the load line with the CV/CC corner.
import { Group } from 'three'
import { definePart } from '../../definePart.js'
import { mat, box, cyl, at, setGlow, textPlane, TIN, fmtSI } from '../../model.js'

const V_MAX = 30, I_MAX = 5
const R_OUT = 0.001     // Ω  CV output resistance (≈0.01 % load regulation; also keeps a wire short solvable)
const W = 15.0, H = 16.0, D = 26.0
const FRONT = D / 2
const POST_Y = 3.0, POST_X = [3.6, 5.6], POST_L = 1.2

/** CV/CC output stage between pos and neg. el.Vset / el.Ilim are live. */
function cvccSource(pos, neg, Vset, Ilim) {
  return {
    kind: 'PSU', nodes: [pos, neg], branches: 1, nonlinear: true, Vset, Ilim,
    state: { cc: false },
    stamp(sys, ctx, el) {
      const ra = sys._r(pos), rb = sys._r(neg), rk = sys._br(el.branchBase)
      // KCL: the branch current x flows pos → (through the supply) → neg.
      sys.addA(ra, rk, 1); sys.addA(rb, rk, -1)
      if (el._cc ?? el.state.cc) {          // CC: output current (= −x) is the limit
        sys.addA(rk, rk, 1); sys.b[rk] += -el.Ilim
      } else {                              // CV: V(pos) − V(neg) = Vset − R_OUT·iOut  (iOut = −x)
        sys.addA(rk, ra, 1); sys.addA(rk, rb, -1); sys.addA(rk, rk, -R_OUT); sys.b[rk] += el.Vset
      }
    },
    limit(ctx, el) {
      const cc = el._cc ?? el.state.cc
      const iOut = -ctx.brI(el), v = ctx.v(pos) - ctx.v(neg)
      let next = cc
      if (!cc && iOut > el.Ilim + 1e-9) next = true
      else if (cc && v > el.Vset + 1e-9) next = false
      el._cc = next
      return next !== cc                   // not converged while the mode changes
    },
    update(ctx, el) { el.state.cc = el._cc ?? el.state.cc; el._cc = undefined },
    currentOf(ctx, el) { return -ctx.brI(el) },   // A out of + into the circuit
  }
}

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0))

export default definePart({
  type: 'power_supply',
  label: 'Power Supply',
  shortName: 'PSU',
  tinkercad: 'Power Supply',
  category: 'power',
  icon: '⚡',
  desc: 'bench DC · 0–30 V · 0–5 A · CV/CC',
  purpose: 'An adjustable lab supply. Set the voltage and a current limit; it holds the voltage (CV) until the load tries to draw more than the limit, then holds the current instead (CC) and the voltage drops. Set a low limit (e.g. 20 mA) to test LEDs safely. Wire the red + and black − posts.',
  usage: 'powering prototypes · testing LEDs and motors · charging with a current limit',
  spec: {
    dims_mm: { w: 150, h: 160, d: 260 }, mass_kg: 4.5,
    v_range_V: [0, V_MAX], i_range_A: [0, I_MAX], regulation: 'ideal CV/CC corner',
    summary: 'Constant voltage until the load exceeds the current limit, then constant current. Outputs are floating; − is the 0 V reference when there is no Arduino.',
  },
  props: {
    voltage: { type: 'number', label: 'Voltage', unit: 'V', default: 5, min: 0, max: V_MAX, step: 0.1 },
    currentLimit: { type: 'number', label: 'Current limit', unit: 'A', default: 1, min: 0, max: I_MAX, step: 0.001 },
  },
  groundPin: 'NEG',
  pins: [
    { name: 'POS', kind: 'power', label: '+', x: POST_X[1], y: POST_Y, z: FRONT + POST_L, r: 0.25 },
    { name: 'NEG', kind: 'gnd', label: '−', x: POST_X[0], y: POST_Y, z: FRONT + POST_L, r: 0.25 },
  ],
  build() {
    const g = new Group()
    g.add(box(W, H, D - 0.4, mat(0x9ca3af, { metal: 0.5, rough: 0.5 }), 0, H / 2, -0.2))            // steel case
    g.add(box(W - 0.2, H - 0.2, 0.4, mat(0x1f2937, { rough: 0.6 }), 0, H / 2, FRONT - 0.2))          // front panel
    for (const s of [-1, 1]) g.add(box(0.5, 0.6, 3, mat(0x111111), s * (W / 2 - 1.5), 0.0 + 0.3, FRONT - 3))  // feet
    // Two displays (V red, A green): canvas when a DOM exists.
    for (const [name, x, color] of [['disp_v', -3.3, 0xff3b30], ['disp_a', 3.3, 0x34c759]]) {
      g.add(box(5.6, 2.6, 0.1, mat(0x050505), x, 12.0, FRONT + 0.05))
      const seg = box(5.0, 2.0, 0.02, mat(color, { emissive: 0x000000 }), x, 12.0, FRONT + 0.11)
      seg.name = name
      g.add(seg)
    }
    const tv = textPlane('V', 0.8, 0.6, { fg: '#e5e7eb', bg: null }); if (tv) g.add(at(tv, -3.3, 10.2, FRONT + 0.02))
    const ta = textPlane('A', 0.8, 0.6, { fg: '#e5e7eb', bg: null }); if (ta) g.add(at(ta, 3.3, 10.2, FRONT + 0.02))
    // Knobs
    for (const x of [-3.3, 3.3]) {
      const k = cyl(1.1, 1.2, mat(0x111827, { rough: 0.5 }), { axis: 'z', seg: 28 })
      g.add(at(k, x, 7.2, FRONT + 0.6))
      g.add(at(box(0.15, 0.8, 0.05, mat(0xf3f4f6), x, 7.6, FRONT + 1.22)))
    }
    // CV / CC LEDs
    for (const [name, x, color] of [['led_cv', -1.0, 0x22c55e], ['led_cc', 1.0, 0xef4444]]) {
      const l = cyl(0.22, 0.2, mat(color, { emissive: 0x000000, rough: 0.3 }), { axis: 'z', seg: 16 })
      l.name = name
      g.add(at(l, x, 9.6, FRONT + 0.1))
    }
    // Power switch + binding posts (black −, red +)
    g.add(box(1.4, 1.0, 0.4, mat(0x111111), -5.2, POST_Y, FRONT + 0.2))
    for (const [x, color] of [[POST_X[0], 0x111111], [POST_X[1], 0xd32f2f]]) {
      g.add(at(cyl(0.55, 0.7, mat(color, { rough: 0.4 }), { axis: 'z', seg: 20 }), x, POST_Y, FRONT + 0.35))
      g.add(at(cyl(0.2, POST_L, TIN(), { axis: 'z', seg: 12 }), x, POST_Y, FRONT + POST_L / 2 + 0.3))
    }
    return g
  },
  sim: {
    controls: [
      { key: 'voltage', kind: 'slider', label: 'Voltage', min: 0, max: V_MAX, step: 0.1, unit: 'V', default: 5 },
      { key: 'ilimit', kind: 'slider', label: 'Limit', min: 0, max: I_MAX, step: 0.01, unit: 'A', default: 1 },
    ],
    circuit(api) {
      const s = api.add(cvccSource(api.pin('POS'), api.pin('NEG'), api.prop('voltage'), api.prop('currentLimit')))
      return { s }
    },
    beforeStep(h, api) {
      h.s.Vset = clampNum(api.control('voltage') ?? api.prop('voltage'), 0, V_MAX)
      h.s.Ilim = clampNum(api.control('ilimit') ?? api.prop('currentLimit'), 0, I_MAX)
    },
    solved(h, api) {
      const v = api.vpin('POS') - api.vpin('NEG')
      const i = api.cur(h.s)
      const cc = !!h.s.state.cc
      const name = api.obj.name || 'Power supply'
      if (cc && h.s.Vset >= 0.5 && v < 0.05 * h.s.Vset) api.issue('short', 'warning', `${name} output is shorted — limiting at ${fmtSI(i, 'A')}`,
        `The + and − outputs are joined by almost no resistance. The supply protects itself by holding its ${fmtSI(h.s.Ilim, 'A')} current limit, but whatever is between them gets ${fmtSI(i * i * Math.max(v / Math.max(i, 1e-9), 0), 'W')} — check the wiring.`)
      else api.clearIssue('short')
      if (i < -0.001) api.issue('backfeed', 'warning', `Current is being forced back into ${name}`,
        'Another source above the set voltage is connected to the output. A bench supply cannot sink current; disconnect the other source or raise the set voltage.')
      else api.clearIssue('backfeed')
      return { voltage: v, current: i, mode: cc ? 'CC' : 'CV', vset: h.s.Vset, ilim: h.s.Ilim, power: v * i }
    },
    readout: ({ solved }) => (solved ? `${solved.voltage.toFixed(2)} V · ${solved.current.toFixed(3)} A · ${solved.mode}` : null),
    visual(root, { solved, off }) {
      const on = !off && solved
      setGlow(root.getObjectByName('led_cv'), 0x22c55e, on && solved.mode === 'CV' ? 1 : 0)
      setGlow(root.getObjectByName('led_cc'), 0xef4444, on && solved.mode === 'CC' ? 1 : 0)
      setGlow(root.getObjectByName('disp_v'), 0xff3b30, on ? 0.5 : 0)
      setGlow(root.getObjectByName('disp_a'), 0x34c759, on ? 0.5 : 0)
    },
  },
  tests: [
    {
      name: 'CV: 12 V into 1 kΩ (limit 1 A) → 12.00 V, 12 mA, CV',
      run(kit) {
        kit.scene({ P: { type: 'power_supply', voltage: 12, currentLimit: 1 }, R: { type: 'resistor', resistance: 1000 } },
          [['P:POS', 'R:1'], ['R:2', 'P:NEG']])
        kit.step(0.05)
        // 1 mΩ output resistance: V = 12·1000/1000.001
        kit.near(kit.state('P').voltage, 12 * 1000 / 1000.001, 1e-7)
        kit.near(kit.state('P').current, 0.012 / 1.000001, 1e-9)
        kit.equal(kit.state('P').mode, 'CV')
      },
    },
    {
      name: 'CC: 12 V set, 5 mA limit, 1 kΩ (would draw 12 mA) → 5 mA and V = 5 mA·1 kΩ = 5.00 V, CC',
      run(kit) {
        kit.scene({ P: { type: 'power_supply', voltage: 12, currentLimit: 0.005 }, R: { type: 'resistor', resistance: 1000 } },
          [['P:POS', 'R:1'], ['R:2', 'P:NEG']])
        kit.step(0.05)
        kit.equal(kit.state('P').mode, 'CC')
        kit.near(kit.state('P').current, 0.005, 1e-8)
        kit.near(kit.state('P').voltage, 5.0, 1e-5)
        // raise the limit live past 12 mA → back to CV at 12 V
        kit.control('P', 'ilimit', 0.02); kit.step(0.05)
        kit.equal(kit.state('P').mode, 'CV')
        kit.near(kit.state('P').voltage, 12 * 1000 / 1000.001, 1e-7)
      },
    },
    {
      name: 'safe LED test: 5 V with a 20 mA limit across a bare red LED → CC at 20 mA, LED at ≈1.9 V',
      run(kit) {
        kit.scene({ P: { type: 'power_supply', voltage: 5, currentLimit: 0.02 }, L: 'led' }, [['P:POS', 'L:ANODE'], ['L:CATHODE', 'P:NEG']])
        kit.step(0.05)
        kit.equal(kit.state('P').mode, 'CC')
        kit.near(kit.state('L').current, 0.02, 1e-6)
        kit.near(kit.state('P').voltage, 1.9, 0.01, 'LED datasheet Vf at 20 mA')
        kit.ok(!kit.hasIssue('L:overcurrent'))
      },
    },
    {
      name: 'shorted output: limits at exactly 1 A with ≈0 V and warns',
      run(kit) {
        kit.scene({ P: { type: 'power_supply', voltage: 9, currentLimit: 1 } }, [['P:POS', 'P:NEG']])
        kit.step(0.05)
        kit.equal(kit.state('P').mode, 'CC')
        kit.near(kit.state('P').current, 1, 1e-6)
        kit.ok(kit.hasIssue('P:short'))
      },
    },
    {
      name: 'voltage slider: 3.3 V into 330 Ω → 10 mA',
      run(kit) {
        kit.scene({ P: 'power_supply', R: { type: 'resistor', resistance: 330 } }, [['P:POS', 'R:1'], ['R:2', 'P:NEG']])
        kit.control('P', 'voltage', 3.3); kit.step(0.05)
        kit.near(kit.state('R').current, 0.01, 1e-7)
      },
    },
  ],
})
