// ─────────────────────────────────────────────────────────────────────────────
// 28BYJ-48 geared stepper motor — the SOURCE of assets-src/models/stepper.glb.
//
//   node tools/models/export-model.cjs stepper     (needs `npm run dev` running)
//   npm run optimize:models stepper                (→ public/models/stepper.glb)
//
// SCENE UNITS (1 unit = 1 cm), no size target in modelLoader — used as authored,
// so STEPPER_PINS in src/utils/electronicsFactory.js line up with the plug.
//
// Real part (28 mm can, 19 mm tall): the motor lies on its back, shaft UP (+y).
//   • mounting flange on top with two ears along ±x (35 mm hole spacing)
//   • brass output shaft with two flats, offset 8 mm toward +z, on a round boss
//   • blue plastic wire box on the −z side; five wires (blue pink yellow orange
//     red) run out to a white 5-pin JST-XH plug at z ≈ −4
//   The mesh named 'shaft' is what the app turns (electronicsFactory).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const R = 1.4            // can radius
const CAN_H = 1.9        // can height
const FL = 0.08          // flange thickness
const SHAFT_Z = 0.8      // shaft offset from the can axis

export const STEPPER_LAYOUT = {
  shaft: { x: 0, z: SHAFT_Z, y0: CAN_H + FL, y1: CAN_H + FL + 1.05 },
  plug: { z: -4.15, y: 0.3, x0: -0.5, pitch: 0.25 },     // BLUE … RED pin positions
}

const std = (color, roughness = 0.6, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
const M = {
  // Low metalness on purpose: the scene has no environment map, and a strongly
  // metallic surface then renders dark grey instead of bright zinc.
  can:    std(0xd6dadf, 0.4, 0.2),
  flange: std(0xc6cbd1, 0.42, 0.22),
  brass:  std(0xd2a64a, 0.3, 0.55),
  blue:   std(0x2c66d1, 0.45),
  plug:   std(0xf1efe6, 0.55),
  plugDk: std(0x3b3a36, 0.7),
}
const WIRE_COLORS = [0x2563eb, 0xec4899, 0xeab308, 0xf97316, 0xdc2626]   // BLUE PINK YELLOW ORANGE RED

function labelTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#e9ebee'; g.fillRect(0, 0, 1024, 256)
  g.fillStyle = '#1b1d22'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = '700 92px Arial, sans-serif'; g.fillText('28BYJ-48', 512, 92)
  g.font = '400 52px Arial, sans-serif'; g.fillText('5V DC   1:64   STEPPER', 512, 186)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Flange outline (x, y in shape space → x, −z in the scene): can circle + two
// round-ended ears along x, with the two Ø4.2 mm mounting holes.
function flangeGeometry() {
  const ear = 0.35, ex = 1.75, a = Math.asin(ear / R), cx = Math.sqrt(R * R - ear * ear)
  const s = new THREE.Shape()
  s.moveTo(cx, ear)
  s.lineTo(ex, ear)
  s.absarc(ex, 0, ear, Math.PI / 2, -Math.PI / 2, true)
  s.lineTo(cx, -ear)
  s.absarc(0, 0, R, -a, -(Math.PI - a), true)
  s.lineTo(-ex, -ear)
  s.absarc(-ex, 0, ear, (3 * Math.PI) / 2, Math.PI / 2, true)
  s.lineTo(-cx, ear)
  s.absarc(0, 0, R, Math.PI - a, a, true)
  for (const x of [-ex, ex]) { const h = new THREE.Path(); h.absarc(x, 0, 0.21, 0, Math.PI * 2, true); s.holes.push(h) }
  const geo = new THREE.ExtrudeGeometry(s, { depth: FL, bevelEnabled: false, curveSegments: 32 })
  geo.rotateX(-Math.PI / 2)            // extrude +z → +y
  geo.translate(0, CAN_H, 0)
  return geo
}

// Brass shaft: Ø5 mm round at the base, two flats (3 mm across) on the top 6 mm.
function shaftGeometry() {
  const r = 0.25, f = 0.15, y0 = CAN_H + FL + 0.15
  const round = new THREE.CylinderGeometry(r, r, 0.35, 28)
  round.translate(0, y0 + 0.175, 0)
  const a = Math.acos(f / r)
  const s = new THREE.Shape()
  s.moveTo(f, -Math.sin(a) * r)
  s.lineTo(f, Math.sin(a) * r)
  s.absarc(0, 0, r, a, Math.PI - a, false)
  s.lineTo(-f, -Math.sin(a) * r)
  s.absarc(0, 0, r, Math.PI + a, 2 * Math.PI - a, false)
  const flats = new THREE.ExtrudeGeometry(s, { depth: 0.55, bevelEnabled: false, curveSegments: 20 })
  flats.rotateX(-Math.PI / 2)
  flats.translate(0, y0 + 0.35, 0)
  const geo = mergeGeometries([round.toNonIndexed(), flats.toNonIndexed()])
  geo.translate(0, 0, SHAFT_Z)
  return geo
}

export function buildStepper() {
  const root = new THREE.Group()
  root.name = '28BYJ-48'

  // Can: body + a slightly wider rolled lip at the base.
  const can = new THREE.Mesh(new THREE.CylinderGeometry(R, R, CAN_H, 56), M.can)
  can.position.y = CAN_H / 2; can.name = 'can'
  root.add(can)
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.12, 56), M.flange)
  lip.position.y = 0.06
  root.add(lip)

  // Paper label wrapped round the +x side.
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.95, 40, 1, true, Math.PI / 2 - 0.95, 1.9),
    new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.7 }))
  label.position.y = 0.95
  root.add(label)

  const flange = new THREE.Mesh(flangeGeometry(), M.flange); flange.name = 'flange'
  root.add(flange)

  // Gearbox boss + output shaft.
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.47, 0.15, 32), M.flange)
  boss.position.set(0, CAN_H + FL + 0.075, SHAFT_Z)
  root.add(boss)
  const shaft = new THREE.Mesh(shaftGeometry(), M.brass); shaft.name = 'shaft'
  root.add(shaft)

  // Blue wire box on the −z side (overlaps into the can, like the real moulding).
  const wbox = new THREE.Mesh(new THREE.BoxGeometry(1.46, 1.65, 0.78), M.blue)
  wbox.position.set(0, 0.92, -1.34)
  root.add(wbox)
  const wcap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.6), M.blue)
  wcap.position.set(0, 1.78, -1.38)
  root.add(wcap)

  // Five wires curving down to the plug.
  const { plug } = STEPPER_LAYOUT
  WIRE_COLORS.forEach((color, i) => {
    const x = (i - 2) * 0.19, px = plug.x0 + i * plug.pitch
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0.95, -1.7),
      new THREE.Vector3(x, 0.88, -2.25),
      new THREE.Vector3((x + px) / 2, 0.42, -2.9),
      new THREE.Vector3(px, 0.3, -3.55),
    ])
    const w = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.055, 8), std(color, 0.5))
    root.add(w)
  })

  // White JST-XH 5-pin plug (opening faces −z) with its latch ridge.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.58, 0.62), M.plug)
  body.position.set(0, plug.y, -3.84)
  root.add(body)
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.4), M.plug)
  ridge.position.set(0, plug.y + 0.33, -3.86)
  root.add(ridge)
  for (let i = 0; i < 5; i++) {
    const hole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.02), M.plugDk)
    hole.position.set(plug.x0 + i * plug.pitch, plug.y - 0.02, -4.155)
    root.add(hole)
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  return root
}
