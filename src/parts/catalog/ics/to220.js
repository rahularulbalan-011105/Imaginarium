// TO-220 package model (NOT a part file), standing upright as on a breadboard:
// three 0.8 × 0.5 mm leads at 2.54 mm pitch (legs end at y = 0, 13 mm long),
// a 10 × 9.2 × 4.5 mm epoxy body, and the metal tab with its Ø3.6 mm hole
// rising 6.3 mm above the body at the back (−Z).
import { Group, Mesh, RingGeometry } from 'three'
import { mat, box, at, TIN, PITCH, textPlane } from '../../model.js'

export const LEAD_H = 1.3, BODY_H = 0.92, TAB_H = 0.63, BODY_D = 0.45
export const TO220_DIMS = { w: 10.0, h: (LEAD_H + BODY_H + TAB_H) * 10, d: BODY_D * 10 }

export function to220Build(label) {
  const g = new Group()
  for (const x of [-PITCH, 0, PITCH]) {
    g.add(box(0.08, LEAD_H - 0.2, 0.05, TIN(), x, (LEAD_H - 0.2) / 2, 0))      // thin part into the breadboard
    g.add(box(0.13, 0.2, 0.05, TIN(), x, LEAD_H - 0.1, 0))                    // wider shoulder at the body
  }
  g.add(box(1.0, BODY_H, BODY_D - 0.13, mat(0x1b1b1b, { rough: 0.85 }), 0, LEAD_H + BODY_H / 2, 0.065))
  const tab = mat(0xb8bcc2, { metal: 0.9, rough: 0.35 })
  g.add(box(1.0, BODY_H + TAB_H, 0.13, tab, 0, LEAD_H + (BODY_H + TAB_H) / 2, -BODY_D / 2 + 0.065))
  const hole = new Mesh(new RingGeometry(0.12, 0.18, 20), mat(0x6b7280, { metal: 0.6 }))
  hole.position.set(0, LEAD_H + BODY_H + TAB_H / 2, -BODY_D / 2 - 0.002)
  hole.rotation.y = Math.PI
  g.add(hole)
  if (label) {
    const t = textPlane(label, 0.9, 0.22, { fg: '#e5e7eb', bg: null })
    if (t) g.add(at(t, 0, LEAD_H + BODY_H * 0.55, BODY_D / 2 + 0.002))
  }
  return g
}
/** Pins at the three lead feet, left → right seen from the front (+Z). */
export function to220Pins(names, kinds = {}) {
  return names.map((name, i) => ({ name, kind: kinds[name] ?? 'passive', x: (i - 1) * PITCH, y: 0.02, z: 0, r: 0.06, label: name, ldy: 0.25 + (i % 2) * 0.22 }))
}
