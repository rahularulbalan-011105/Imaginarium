// ─────────────────────────────────────────────────────────────────────────────
// L298N dual H-bridge module — the SOURCE of assets-src/models/l298n.glb.
//
// Built in three.js (not Blender) so it can be regenerated from code:
//   node tools/models/export-model.cjs l298n     (needs `npm run dev` running)
//   npm run optimize:models l298n                (→ public/models/l298n.glb)
//
// Authored in SCENE UNITS (1 unit = 1 cm, the Arduino is 6.8 long), board
// centred on the origin, PCB top at y = 0.08 — the same frame as L298N_PINS in
// src/utils/electronicsFactory.js. modelLoader has NO size target for l298n, so
// the GLB is used exactly as authored and the pin spheres land on the terminals.
//
// Layout (real 43 × 43 mm module, seen from above, +z = front):
//   back  : heatsink (fins) with the L298 chip bolted to its front
//   left  : OUT1 · OUT2 screw terminal (motor A)     right : OUT3 · OUT4 (motor B)
//   front : 12V · GND · 5V terminal, 5V-EN jumper, ENA IN1 IN2 IN3 IN4 ENB header
//   middle: 2 × 220 µF capacitors, 78M05 regulator, power LED, 8 flyback diodes
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'

const S = 4.3            // board size (cm)
const T = 0.16           // board thickness
const TOP = T / 2        // PCB top surface (y)
const H = S / 2

// Positions shared with electronicsFactory L298N_PINS (keep in sync).
export const L298N_LAYOUT = {
  outA: { x: -1.775, z: [-0.25, 0.25] },              // OUT1, OUT2 screw positions
  outB: { x:  1.775, z: [0.25, -0.25] },              // OUT3, OUT4
  power: { z: 1.775, x: [-1.55, -1.05, -0.55] },      // 12V, GND, 5V
  header: { z: 1.85, x0: 0.35, pitch: 0.254 },        // ENA … ENB
}

const std = (color, roughness = 0.6, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
const M = {
  blue:   std(0x1f5fd6, 0.45),
  blueDk: std(0x0b1d4d, 0.8),
  black:  std(0x151517, 0.55),
  sink:   std(0x1b1b1f, 0.42, 0.35),
  chip:   std(0x1a1a1c, 0.5),
  screw:  std(0xc9ced6, 0.28, 0.55),
  gold:   std(0xd8a83a, 0.3, 0.6),
  tin:    std(0xb8bec7, 0.35, 0.5),
  capSleeve: std(0x1e2a6b, 0.4),
  capTop: std(0xb9c0c9, 0.3, 0.5),
  pcbEdge: std(0xc4262e, 0.7),
  ledRed: new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0x550000, roughness: 0.2, transparent: true, opacity: 0.9 }),
  diode:  std(0x222225, 0.5),
  band:   std(0x9aa0a8, 0.5),
  smdTan: std(0xc8a46a, 0.6),
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return m
}
function cyl(r, h, mat, x, y, z, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat)
  m.position.set(x, y, z)
  return m
}

// ── Silkscreen: the whole PCB top as one texture ─────────────────────────────
// canvas (u, v) ↔ board (x, z): u = (x + H)/S, v = (z + H)/S  (v = 0 at the back)
function silkscreenTexture() {
  const N = 1024, k = N / S
  const c = document.createElement('canvas'); c.width = c.height = N
  const g = c.getContext('2d')
  const P = (x, z) => [(x + H) * k, (z + H) * k]
  // solder mask with a faint sheen gradient
  const grad = g.createLinearGradient(0, 0, N, N)
  grad.addColorStop(0, '#de3239'); grad.addColorStop(1, '#ca2930')
  g.fillStyle = grad; g.fillRect(0, 0, N, N)
  // copper traces under the mask (slightly darker/raised look)
  g.strokeStyle = 'rgba(120,10,16,0.55)'; g.lineCap = 'round'
  const trace = (w, pts) => { g.lineWidth = w * k; g.beginPath(); pts.forEach(([x, z], i) => { const [u, v] = P(x, z); i ? g.lineTo(u, v) : g.moveTo(u, v) }); g.stroke() }
  trace(0.09, [[-1.55, 1.5], [-1.55, 0.9], [-0.9, 0.6], [-0.9, -0.3]])
  trace(0.09, [[-1.05, 1.5], [-1.05, 1.15], [0.3, 1.15], [0.75, 0.75]])
  trace(0.06, [[0.35, 1.7], [0.35, 1.35], [-0.4, 0.2], [-0.4, -0.35]])
  trace(0.06, [[0.6, 1.7], [0.6, 1.3], [-0.1, 0.15], [-0.1, -0.35]])
  trace(0.06, [[0.86, 1.7], [0.86, 1.25], [0.2, 0.1], [0.2, -0.35]])
  trace(0.06, [[1.11, 1.7], [1.11, 1.2], [0.5, 0.05], [0.5, -0.35]])
  trace(0.09, [[-1.4, -0.25], [-0.95, -0.25], [-0.75, -0.45]])
  trace(0.09, [[1.4, 0.25], [1.05, 0.25], [0.85, -0.4]])
  // vias
  g.fillStyle = '#e0b04a'
  for (const [x, z] of [[-0.6, 0.0], [0.15, 0.45], [1.0, 0.95], [-1.3, 1.0], [1.3, -0.6], [-1.25, -0.65], [0.45, 1.4], [-0.2, 1.4]]) {
    const [u, v] = P(x, z); g.beginPath(); g.arc(u, v, 0.05 * k, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#2a0b0d'; g.beginPath(); g.arc(u, v, 0.022 * k, 0, Math.PI * 2); g.fill(); g.fillStyle = '#e0b04a'
  }
  // mounting holes (tinned ring + hole)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [u, v] = P(sx * (H - 0.3), sz * (H - 0.3))
    g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(u, v, 0.27 * k, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#121214'; g.beginPath(); g.arc(u, v, 0.15 * k, 0, Math.PI * 2); g.fill()
  }
  // component outlines + text in white silkscreen
  g.strokeStyle = '#f4f4f5'; g.fillStyle = '#f4f4f5'; g.lineWidth = 0.025 * k
  const rect = (x, z, w, d) => { const [u, v] = P(x - w / 2, z - d / 2); g.strokeRect(u, v, w * k, d * k) }
  const circle = (x, z, r) => { const [u, v] = P(x, z); g.beginPath(); g.arc(u, v, r * k, 0, Math.PI * 2); g.stroke() }
  const text = (s, x, z, size, align = 'center', bold = true) => {
    g.font = `${bold ? '700 ' : ''}${size * k}px Arial, Helvetica, sans-serif`
    g.textAlign = align; g.textBaseline = 'middle'
    const [u, v] = P(x, z); g.fillText(s, u, v)
  }
  circle(-0.3, 0.35, 0.44); circle(0.55, 0.35, 0.44)
  rect(-0.9, 0.95, 0.85, 0.75)
  rect(0.985, 1.85, 1.65, 0.4)
  rect(-0.05, 1.62, 0.36, 0.62)
  for (const [x, z] of [[-1.1, -0.45], [-1.1, -0.1], [-1.1, 0.25], [-1.1, 0.6], [1.19, -0.45], [1.19, -0.1], [1.19, 0.25], [1.19, 0.6]]) rect(x, z, 0.52, 0.28)
  text('+12V', -1.55, 1.2, 0.17); text('GND', -1.05, 1.2, 0.17); text('+5V', -0.55, 1.2, 0.17)
  ;['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'].forEach((s, i) => text(s, 0.35 + i * 0.254, 1.52 - (i % 2) * 0.13, 0.11))
  text('5V-EN', -0.05, 1.2, 0.11)
  text('OUT1', -1.5, -0.62, 0.13); text('OUT2', -1.5, 0.82, 0.13)
  text('OUT3', 1.5, 0.82, 0.13); text('OUT4', 1.5, -0.62, 0.13)
  text('L298N', 0.3, 0.96, 0.26)
  text('MOTOR DRIVER', 0.3, 1.2, 0.1, 'center', false)
  text('220uF', -0.3, -0.16, 0.09, 'center', false); text('220uF', 0.55, -0.16, 0.09, 'center', false)
  text('PWR', 1.2, 1.42, 0.09)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// Chip face print ("L298N" + "ST" logo-ish text).
function chipTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, 512, 256)
  g.fillStyle = '#c9ccd2'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = '700 84px Arial, sans-serif'; g.fillText('L298N', 256, 110)
  g.font = '400 40px Arial, sans-serif'; g.fillText('ST  MALAYSIA  521', 256, 190)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Blue screw terminal: n positions along `axis`, wire entries facing `out`.
function screwTerminal(n, axis, out, cx, cz) {
  const g = new THREE.Group()
  const pitch = 0.5, len = n * pitch, depth = 0.75, hgt = 0.85
  const w = axis === 'x' ? len : depth, d = axis === 'z' ? len : depth
  g.add(box(w, hgt, d, M.blue, cx, TOP + hgt / 2, cz))
  // raised separators between positions
  for (let i = 0; i <= n; i++) {
    const o = -len / 2 + i * pitch
    g.add(box(axis === 'x' ? 0.05 : depth * 0.9, 0.08, axis === 'z' ? 0.05 : depth * 0.9, M.blue,
      cx + (axis === 'x' ? o : 0), TOP + hgt + 0.04, cz + (axis === 'z' ? o : 0)))
  }
  for (let i = 0; i < n; i++) {
    const o = -len / 2 + pitch / 2 + i * pitch
    const sx = cx + (axis === 'x' ? o : 0), sz = cz + (axis === 'z' ? o : 0)
    // screw head with slot
    g.add(cyl(0.16, 0.06, M.screw, sx, TOP + hgt + 0.01, sz, 20))
    const slot = box(0.26, 0.03, 0.045, M.blueDk, sx, TOP + hgt + 0.04, sz)
    slot.rotation.y = Math.PI / 4
    g.add(slot)
    // square wire entry on the outward face (dark recess + clamp)
    const ox = out === '-x' ? cx - w / 2 : out === '+x' ? cx + w / 2 : sx
    const oz = out === '-z' ? cz - d / 2 : out === '+z' ? cz + d / 2 : sz
    const along = out.endsWith('x')
    g.add(box(along ? 0.03 : 0.3, 0.3, along ? 0.3 : 0.03, M.blueDk, ox, TOP + 0.3, oz))
    g.add(box(along ? 0.035 : 0.22, 0.06, along ? 0.22 : 0.035, M.tin, ox, TOP + 0.22, oz))
  }
  return g
}

export function buildL298N() {
  const root = new THREE.Group()
  root.name = 'L298N'

  // PCB: plain board + textured top skin
  const pcb = box(S, T, S, M.pcbEdge, 0, 0, 0)
  pcb.name = 'pcb'
  root.add(pcb)
  const skinGeo = new THREE.PlaneGeometry(S, S); skinGeo.rotateX(-Math.PI / 2)
  const skin = new THREE.Mesh(skinGeo, new THREE.MeshStandardMaterial({ map: silkscreenTexture(), roughness: 0.55, metalness: 0.02 }))
  skin.position.y = TOP + 0.002
  skin.name = 'pcb_silkscreen'
  root.add(skin)

  // Heatsink at the back: spine plate + 9 fins running to the back edge.
  const sink = new THREE.Group(); sink.name = 'heatsink'
  sink.add(box(2.4, 2.45, 0.2, M.sink, 0, TOP + 1.225, -0.95))
  for (let i = 0; i < 9; i++) sink.add(box(0.09, 2.3, 1.05, M.sink, -1.12 + i * 0.28, TOP + 1.15, -1.55))
  sink.add(box(2.4, 0.12, 1.15, M.sink, 0, TOP + 0.06, -1.5))
  const bolt = cyl(0.12, 0.12, M.screw, 0, TOP + 1.9, -0.8, 16)   // bolt through the chip tab
  bolt.rotation.x = Math.PI / 2
  sink.add(bolt)
  root.add(sink)

  // L298 chip (Multiwatt-15) standing against the heatsink, legs into the board.
  const chip = new THREE.Group(); chip.name = 'L298_chip'
  chip.add(box(2.0, 1.0, 0.45, M.chip, 0, TOP + 1.25, -0.62))
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: chipTexture(), roughness: 0.5 }))
  face.position.set(0, TOP + 1.25, -0.393)
  chip.add(face)
  chip.add(box(2.0, 0.55, 0.06, M.tin, 0, TOP + 1.98, -0.82))           // metal tab above the body
  for (let i = 0; i < 15; i++) {
    const x = -0.889 + i * 0.127, front = i % 2 === 0
    chip.add(box(0.05, 0.75, 0.05, M.tin, x, TOP + 0.375, front ? -0.42 : -0.6))
  }
  root.add(chip)

  // Screw terminals
  const tA = screwTerminal(2, 'z', '-x', -1.775, 0); tA.name = 'terminal_motorA'; root.add(tA)
  const tB = screwTerminal(2, 'z', '+x', 1.775, 0); tB.name = 'terminal_motorB'; root.add(tB)
  const tP = screwTerminal(3, 'x', '+z', -1.05, 1.775); tP.name = 'terminal_power'; root.add(tP)

  // Logic header (ENA IN1 IN2 IN3 IN4 ENB) + jumper caps on ENA / ENB
  const { x0, pitch, z: hz } = L298N_LAYOUT.header
  root.add(box(6 * pitch, 0.25, pitch, M.black, x0 + 2.5 * pitch, TOP + 0.125, hz))
  for (let i = 0; i < 6; i++) root.add(box(0.064, 0.85, 0.064, M.gold, x0 + i * pitch, TOP + 0.43, hz))
  for (const i of [0, 5]) root.add(box(0.24, 0.6, 0.48, M.black, x0 + i * pitch, TOP + 0.55, hz - 0.12))
  // 5V-EN jumper (2-pin + cap) beside the power terminal
  for (const dz of [-0.127, 0.127]) root.add(box(0.064, 0.7, 0.064, M.gold, -0.05, TOP + 0.35, 1.62 + dz))
  root.add(box(0.24, 0.5, 0.5, M.black, -0.05, TOP + 0.5, 1.62))

  // 2 × 220 µF electrolytic capacitors (blue sleeve, vented aluminium top)
  for (const x of [-0.3, 0.55]) {
    root.add(cyl(0.4, 1.0, M.capSleeve, x, TOP + 0.5, 0.35, 28))
    root.add(cyl(0.38, 0.03, M.capTop, x, TOP + 1.01, 0.35, 28))
    const v1 = box(0.5, 0.012, 0.03, M.blueDk, x, TOP + 1.03, 0.35); const v2 = v1.clone(); v2.rotation.y = Math.PI / 2
    root.add(v1, v2)
    root.add(box(0.12, 1.0, 0.02, M.capTop, x - 0.4, TOP + 0.5, 0.35))   // polarity stripe
  }

  // 78M05 regulator (DPAK): body + tab + leads
  root.add(box(0.65, 0.24, 0.6, M.black, -0.9, TOP + 0.12, 1.05))
  root.add(box(0.55, 0.05, 0.25, M.tin, -0.9, TOP + 0.025, 0.65))
  for (const dx of [-0.23, 0.23]) root.add(box(0.07, 0.04, 0.3, M.tin, -0.9 + dx, TOP + 0.02, 1.45))

  // Power LED + its resistor
  root.add(box(0.16, 0.1, 0.08, M.ledRed, 1.2, TOP + 0.05, 1.3))
  root.add(box(0.16, 0.06, 0.08, M.smdTan, 1.2, TOP + 0.03, 1.15))

  // 8 flyback diodes (SMD, grey cathode band)
  for (const [x, z] of [[-1.1, -0.45], [-1.1, -0.1], [-1.1, 0.25], [-1.1, 0.6], [1.19, -0.45], [1.19, -0.1], [1.19, 0.25], [1.19, 0.6]]) {
    root.add(box(0.42, 0.18, 0.2, M.diode, x, TOP + 0.09, z))
    root.add(box(0.06, 0.185, 0.205, M.band, x + 0.15, TOP + 0.09, z))
  }

  // a few small SMD parts near the header
  for (const [x, z] of [[1.62, 1.05], [1.62, 1.3]]) root.add(box(0.16, 0.06, 0.08, M.smdTan, x, TOP + 0.03, z))

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  return root
}
