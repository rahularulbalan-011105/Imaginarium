// Shared package models for the discrete semiconductors in this folder (not a
// part file — no .part.js suffix). Real JEDEC outlines, 1 unit = 1 cm, legs end
// at y = 0.
//   TO-92   JEDEC TO-226AA: body Ø5.2 × 5.0 mm, flat face 4.2 mm from the back,
//           leads formed to 2.54 mm pitch (the breadboard-friendly "bent lead"
//           option, e.g. PN2222ATA).
//   TO-220  JEDEC TO-220AB: body 10.2 × 9.1 × 4.5 mm (incl. 1.3 mm drain tab),
//           tab extends 6.4 mm above the body with a Ø3.7 mm mounting hole,
//           leads 2.54 mm pitch.
//   DO-41   JEDEC DO-204AL: body Ø2.7 × 5.2 mm, Ø0.86 mm leads.
import { Group, Mesh, CylinderGeometry, Shape, Path, ExtrudeGeometry } from 'three'
import { mat, box, cyl, at, lead, textPlane, TIN } from '../../model.js'

// ── TO-92 ────────────────────────────────────────────────────────────────────
export const TO92 = { R: 0.26, FLAT: 0.16, H: 0.5, BASE: 0.3, PITCH: 0.254, CZ: 0.05 }

/** TO-92 with its flat (marked) face toward +Z. names = legs left → right seen from the front. */
export function to92({ marking = '', color = 0x1b1b1b } = {}) {
  const { R, FLAT, H, BASE, PITCH, CZ } = TO92
  const g = new Group()
  const half = Math.acos(FLAT / R)
  const body = new Mesh(new CylinderGeometry(R, R, H, 32, 1, false, half, 2 * Math.PI - 2 * half), mat(color, { rough: 0.75 }))
  body.name = 'body'
  g.add(at(body, 0, BASE + H / 2, CZ))
  // The flat face (fills the chord the partial cylinder leaves open).
  const chord = 2 * R * Math.sin(half)
  g.add(box(chord, H, FLAT, mat(color, { rough: 0.75 }), 0, BASE + H / 2, CZ + FLAT / 2))
  if (marking) {
    const t = textPlane(marking, chord * 0.9, 0.12, { fg: '#cfcfcf', bg: null })
    if (t) g.add(at(t, 0, BASE + H * 0.6, CZ + FLAT + 0.002))
  }
  // Three leads: leave the body 1.27 mm apart, then formed out to 2.54 mm.
  for (const i of [-1, 0, 1]) {
    const xTop = i * 0.127, xBot = i * PITCH
    g.add(lead([xTop, BASE + 0.02, 0], [xTop, BASE - 0.06, 0], { r: 0.022 }))
    g.add(lead([xTop, BASE - 0.06, 0], [xBot, BASE - 0.16, 0], { r: 0.022 }))
    g.add(lead([xBot, BASE - 0.16, 0], [xBot, 0, 0], { r: 0.022 }))
  }
  return g
}
/** Pin list for a TO-92 (legs left → right seen from the flat face). */
export function to92Pins(legs) {
  return legs.map(([name, kind, label], i) => ({ name, kind, x: (i - 1) * TO92.PITCH, y: 0.02, z: 0, r: 0.06, label: label ?? name, ldy: 0.2 + (i % 2) * 0.2 }))
}

// ── TO-220 ───────────────────────────────────────────────────────────────────
export const TO220 = { W: 1.02, BODY_H: 0.91, TAB_H: 0.64, LEG: 0.5, Z_FRONT: 0.225, Z_BACK: -0.225, TAB_T: 0.13, PITCH: 0.254 }

/** TO-220 standing upright, marked epoxy face toward +Z, metal tab at the back. */
export function to220({ marking = '' } = {}) {
  const { W, BODY_H, TAB_H, LEG, Z_FRONT, Z_BACK, TAB_T, PITCH } = TO220
  const g = new Group()
  const epoxyD = Z_FRONT - (Z_BACK + TAB_T)
  const ez = Z_BACK + TAB_T + epoxyD / 2
  g.add(box(W, BODY_H, epoxyD, mat(0x161616, { rough: 0.8 }), 0, LEG + BODY_H / 2, ez))
  // Drain tab: full body height + 6.4 mm above it, with the Ø3.7 mm hole.
  const s = new Shape()
  const tabTop = BODY_H + TAB_H
  s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, tabTop); s.lineTo(-W / 2, tabTop); s.lineTo(-W / 2, 0)
  const hole = new Path(); hole.absarc(0, BODY_H + 0.31, 0.185, 0, Math.PI * 2, false)
  s.holes.push(hole)
  const tab = new Mesh(new ExtrudeGeometry(s, { depth: TAB_T, bevelEnabled: false, curveSegments: 20 }), TIN())
  tab.name = 'tab'
  g.add(at(tab, 0, LEG, Z_BACK))
  if (marking) {
    const t = textPlane(marking, W * 0.85, 0.16, { fg: '#d8d8d8', bg: null })
    if (t) g.add(at(t, 0, LEG + BODY_H * 0.55, Z_FRONT + 0.002))
  }
  // Leads: 1.4 mm shoulders, then 0.8 × 0.5 mm leads to y = 0.
  for (const i of [-1, 0, 1]) {
    g.add(box(0.14, 0.12, 0.05, TIN(), i * PITCH, LEG - 0.06, 0))
    g.add(box(0.08, LEG - 0.12, 0.05, TIN(), i * PITCH, (LEG - 0.12) / 2, 0))
  }
  return g
}
export function to220Pins(legs) {
  return legs.map(([name, kind, label], i) => ({ name, kind, x: (i - 1) * TO220.PITCH, y: 0.02, z: 0, r: 0.07, label: label ?? name, ldy: 0.2 + (i % 2) * 0.2 }))
}

// ── DO-41 axial diode ────────────────────────────────────────────────────────
export const DO41 = { HALF: 0.508, Y: 0.3, R: 0.135, L: 0.52, LEAD_R: 0.043 }

/**
 * Axial DO-41 lying flat, anode toward −X, cathode (band) toward +X, leads bent
 * down at 0.4" (10.16 mm). glass = true draws the clear-orange glass body of
 * 1N47xx Zeners with a black band; otherwise black epoxy with a silver band.
 */
export function do41({ glass = false } = {}) {
  const { HALF, Y, R, L, LEAD_R } = DO41
  const g = new Group()
  if (glass) {
    const body = cyl(R, L, mat(0xe8862a, { rough: 0.15, opacity: 0.55 }), { axis: 'x', seg: 24 })
    g.add(at(body, 0, Y, 0))
    g.add(at(cyl(R * 0.55, L * 0.45, mat(0x9aa0a6, { metal: 0.8, rough: 0.3 }), { axis: 'x', seg: 16 }), 0, Y, 0))  // die slugs
    g.add(at(cyl(R * 1.02, 0.08, mat(0x111111, { rough: 0.5 }), { axis: 'x', seg: 24 }), L / 2 - 0.09, Y, 0))
  } else {
    g.add(at(cyl(R, L, mat(0x161616, { rough: 0.7 }), { axis: 'x', seg: 24 }), 0, Y, 0))
    g.add(at(cyl(R * 1.02, 0.08, mat(0xc7c9cc, { metal: 0.4, rough: 0.4 }), { axis: 'x', seg: 24 }), L / 2 - 0.09, Y, 0))
  }
  for (const s of [-1, 1]) {
    g.add(lead([s * L / 2, Y, 0], [s * (HALF - 0.04), Y, 0], { r: LEAD_R }))
    g.add(lead([s * (HALF - 0.04), Y, 0], [s * HALF, Y - 0.04, 0], { r: LEAD_R }))
    g.add(lead([s * HALF, Y - 0.04, 0], [s * HALF, 0, 0], { r: LEAD_R }))
  }
  return g
}
export const DO41_PINS = [
  { name: 'ANODE', kind: 'passive', x: -DO41.HALF, y: 0.02, z: 0, r: 0.07, label: 'A' },
  { name: 'CATHODE', kind: 'passive', x: DO41.HALF, y: 0.02, z: 0, r: 0.07, label: 'K' },
]
