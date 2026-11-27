// Solderless breadboards (Tinkercad "Breadboard Mini" / "Breadboard Small" /
// "Breadboard"): 2.54 mm hole grid, two 5-hole terminal strips per column
// (a–e and f–j) either side of the 7.62 mm centre channel, and — on the small
// and full boards — a red (+) and blue (−) power rail along each long edge.
//
// Every hole is a pin. The holes of one strip / one rail are the same metal
// clip inside (`internal`), so the circuit solver sees each strip as ONE net.
// Part legs dropped onto holes plug in automatically (src/parts/plugging.js).
import { Group, InstancedMesh, BoxGeometry, Matrix4 } from 'three'
import { createElement } from 'react'
import { definePart } from '../../definePart.js'
import { mat, box, PITCH } from '../../model.js'

const TOP = 0.85                         // board height (8.5 mm)
const ROWS_A_E = ['a', 'b', 'c', 'd', 'e']
const ROWS_F_J = ['f', 'g', 'h', 'i', 'j']
// Row centre z (cm): e/f sit either side of the 3-pitch centre channel.
const rowZ = (r) => {
  const i = ROWS_A_E.indexOf(r)
  if (i >= 0) return PITCH * 1.5 + (4 - i) * PITCH            // a farthest (+z)
  return -(PITCH * 1.5 + ROWS_F_J.indexOf(r) * PITCH)          // j farthest (−z)
}

function layout({ cols, rails, railHoles }) {
  const x0 = -((cols - 1) * PITCH) / 2
  const holes = []                                             // { name, x, z }
  for (let c = 1; c <= cols; c++) for (const r of [...ROWS_A_E, ...ROWS_F_J]) holes.push({ name: `${c}${r}`, x: x0 + (c - 1) * PITCH, z: rowZ(r) })
  const railRows = []
  if (rails) {
    // Rail holes come in groups of 5 with a one-hole gap; the run is centred.
    const span = railHoles + Math.floor((railHoles - 1) / 5)
    const rx0 = -((span - 1) * PITCH) / 2
    const zOut = PITCH * 1.5 + 4 * PITCH + PITCH * 2.5        // just past row a / j
    for (const [prefix, z] of [['B-', zOut], ['B+', zOut + PITCH], ['T+', -zOut], ['T-', -zOut - PITCH]]) {
      const names = []
      for (let i = 0; i < railHoles; i++) {
        const name = `${prefix}${i + 1}`
        holes.push({ name, x: rx0 + (i + Math.floor(i / 5)) * PITCH, z })
        names.push(name)
      }
      railRows.push({ prefix, z, names })
    }
  }
  const internal = []
  for (let c = 1; c <= cols; c++) {
    internal.push(ROWS_A_E.map(r => `${c}${r}`))
    internal.push(ROWS_F_J.map(r => `${c}${r}`))
  }
  for (const rr of railRows) internal.push(rr.names)
  return { holes, internal, railRows }
}

function makeBoard({ type, label, tinkercad, cols, rails, railHoles, dims, desc, mass }) {
  const L = layout({ cols, rails, railHoles })
  const w = dims.w / 10, d = dims.d / 10
  return definePart({
    type, label, tinkercad, category: 'breadboards', shortName: label.toUpperCase(), icon: '▦',
    breadboard: { top: TOP },
    desc,
    purpose: 'Push part legs into the holes — they plug in by themselves. The five holes of one column on each side of the centre channel (a–e, f–j) are joined inside; on boards with rails, each red (+) and blue (−) rail is joined along its length. Straddle chips and buttons across the centre channel.',
    usage: 'prototyping without soldering',
    spec: { dims_mm: dims, mass_kg: mass, pinSlack: 0.2, minMeshes: 2, summary: `${L.holes.length} tie points · 2.54 mm pitch · 7.62 mm centre channel.` },
    pins: L.holes.map(h => ({ name: h.name, kind: 'passive', x: h.x, y: TOP, z: h.z, r: 0.06, noLabel: true })),
    internal: L.internal,
    spawn: { x: 0, y: 0, z: 6, dx: w + 1 },
    labelOffset: { dx: 0, dy: 0.25, dz: 0 },
    build() {
      const g = new Group()
      g.add(box(w, TOP, d, mat(0xf2f2ee, { rough: 0.85 }), 0, TOP / 2, 0))
      // Centre channel.
      g.add(box(w - 0.4, 0.06, PITCH * 1.2, mat(0xd8d8d2, { rough: 0.9 }), 0, TOP - 0.02, 0))
      // Holes: one instanced mesh (one draw call for hundreds of holes).
      const hole = new InstancedMesh(new BoxGeometry(0.11, 0.02, 0.11), mat(0x2a2a2a, { rough: 1 }), L.holes.length)
      const m = new Matrix4()
      L.holes.forEach((h, i) => { m.makeTranslation(h.x, TOP + 0.002, h.z); hole.setMatrixAt(i, m) })
      hole.instanceMatrix.needsUpdate = true
      hole.name = 'holes'
      g.add(hole)
      // Rail stripes: red beside the + rail, blue beside the − rail.
      for (const rr of L.railRows) {
        const plus = rr.prefix.endsWith('+')
        const outer = Math.abs(rr.z) > Math.abs(L.railRows.find(o => o !== rr && Math.sign(o.z) === Math.sign(rr.z)).z)
        const zLine = rr.z + Math.sign(rr.z) * (outer ? 1 : -1) * PITCH * 0.55
        g.add(box(w - 0.6, 0.005, 0.03, mat(plus ? 0xd62828 : 0x1d4ed8, { rough: 0.6 }), 0, TOP + 0.003, zLine))
      }
      return g
    },
    workbench({ pins }) {
      // A grid of hole pads at their real relative positions (14 px pitch).
      const S = 14 / PITCH
      const xs = L.holes.map(h => h.x), zs = L.holes.map(h => h.z)
      const minX = Math.min(...xs), minZ = Math.min(...zs)
      const bw = (Math.max(...xs) - minX) * S + 28, bh = (Math.max(...zs) - minZ) * S + 28
      const byName = new Map(L.holes.map(h => [h.name, h]))
      return {
        w: bw, h: bh, title: label.toUpperCase(),
        art: createElement('rect', { x: 0, y: 0, width: bw, height: bh, rx: 6, fill: '#f4f4f0', stroke: '#c9c9c2' }),
        pins: pins.map(name => { const h = byName.get(name); return { pin: name, x: (h.x - minX) * S + 14, y: (h.z - minZ) * S + 14, side: 'none', label: '' } }),
      }
    },
    tests: [
      {
        name: 'a column strip is one net; the two halves and different columns are separate',
        run(kit) {
          kit.scene({ U: 'arduino', BB: type, R: { type: 'resistor', resistance: 1000 } },
            [['U:5V', 'BB:1a'], ['R:1', 'BB:1e'], ['R:2', 'BB:2a'], ['BB:2e', 'U:GND1']])
          kit.step(0.02)
          // 5 V → strip 1 → 1 kΩ → strip 2 → GND: the full 5 V across R.
          kit.near(kit.state('R').voltage, 5, 0.01, 'voltage across R (strips conduct)')
          kit.near(kit.vpin('BB', '1c'), 5, 0.01, 'other hole of strip 1 is at 5 V')
          kit.near(kit.vpin('BB', '1f'), 0, 0.01, 'the far side of the channel (1f) is not connected')
        },
      },
      ...(rails ? [{
        name: 'each power rail is one net along its length',
        run(kit) {
          const last = `T+${railHoles}`
          kit.scene({ U: 'arduino', BB: type, R: { type: 'resistor', resistance: 470 } },
            [['U:5V', 'BB:T+1'], ['R:1', `BB:${last}`], ['R:2', 'BB:T-3'], ['BB:T-1', 'U:GND1']])
          kit.step(0.02)
          kit.near(kit.state('R').voltage, 5, 0.01, 'rail carries 5 V end to end')
        },
      }] : []),
    ],
  })
}

export default [
  makeBoard({ type: 'breadboard_mini', label: 'Breadboard Mini', tinkercad: 'Breadboard Mini', cols: 17, rails: false,
    dims: { w: 47, h: 8.5, d: 35 }, desc: '170 tie points · no rails', mass: 0.012 }),
  makeBoard({ type: 'breadboard_half', label: 'Breadboard Small', tinkercad: 'Breadboard Small', cols: 30, rails: true, railHoles: 25,
    dims: { w: 82.6, h: 8.5, d: 54.6 }, desc: '400 tie points · 4 rails', mass: 0.03 }),
  makeBoard({ type: 'breadboard_full', label: 'Breadboard', tinkercad: 'Breadboard', cols: 63, rails: true, railHoles: 50,
    dims: { w: 165.1, h: 8.5, d: 54.6 }, desc: '830 tie points · 4 rails', mass: 0.06 }),
]
