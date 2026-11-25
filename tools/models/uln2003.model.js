// ─────────────────────────────────────────────────────────────────────────────
// ULN2003 stepper driver board — the SOURCE of assets-src/models/uln2003.glb.
//
//   node tools/models/export-model.cjs uln2003     (needs `npm run dev` running)
//   npm run optimize:models uln2003                (→ public/models/uln2003.glb)
//
// SCENE UNITS (1 unit = 1 cm), board centred on the origin, PCB top at y = 0.08,
// no size target in modelLoader — the same frame as ULN2003_PINS in
// src/utils/electronicsFactory.js.
//
// Layout (real 35 × 32 mm board, seen from above, +z = front):
//   back   : white 5-pin JST-XH motor socket (opening up)
//   middle : ULN2003APG (DIP-16), long axis along z
//   right  : four red LEDs A B C D (one per coil) + their resistors
//   front  : IN1 IN2 IN3 IN4 header · − + power pins · ON/OFF jumper
// The LED meshes are named led_A … led_D — the app lights them per coil.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const W = 3.5, D = 3.2          // board size (cm): x × z
const T = 0.16
const TOP = T / 2
const HX = W / 2, HZ = D / 2

// Shared with electronicsFactory ULN2003_PINS (keep in sync).
export const ULN2003_LAYOUT = {
  header: { z: 1.35, x0: -1.45, pitch: 0.254 },     // IN1 … IN4
  power:  { z: 1.35, x: [0.25, 0.504] },            // − (GND), + (VCC)
  jumper: { z: 1.35, x: [1.0, 1.254] },
  socket: { z: -1.15, x0: -0.8, pitch: 0.25, y: TOP + 0.72 },   // OUT1 … OUT4, COM
  leds:   { x: 1.2, z: [-0.75, -0.3, 0.15, 0.6] },  // A B C D
  chip:   { x: -0.3, z: 0.2 },
}

const std = (color, roughness = 0.6, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
const M = {
  pcbEdge: std(0x1b6e37, 0.7),
  chip:    std(0x18181a, 0.5),
  tin:     std(0xb8bec7, 0.35, 0.5),
  gold:    std(0xd8a83a, 0.3, 0.6),
  black:   std(0x151517, 0.55),
  socket:  std(0xf2f0e8, 0.55),
  socketDk: std(0x9c998f, 0.7),
  resBody: std(0x1c1c1e, 0.5),
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return m
}

// canvas (u, v) ↔ board (x, z): u = (x + HX)/W, v = (z + HZ)/D
function silkscreenTexture() {
  const N = 1024, kx = N / W, kz = N / D
  const c = document.createElement('canvas'); c.width = c.height = N
  const g = c.getContext('2d')
  const P = (x, z) => [(x + HX) * kx, (z + HZ) * kz]
  const grad = g.createLinearGradient(0, 0, N, N)
  grad.addColorStop(0, '#23964b'); grad.addColorStop(1, '#1b7e3d')
  g.fillStyle = grad; g.fillRect(0, 0, N, N)
  // traces: IN pins → chip inputs, chip outputs → socket / LEDs
  g.strokeStyle = 'rgba(10,70,30,0.6)'; g.lineCap = 'round'
  const trace = (w, pts) => { g.lineWidth = w * kx; g.beginPath(); pts.forEach(([x, z], i) => { const [u, v] = P(x, z); i ? g.lineTo(u, v) : g.moveTo(u, v) }); g.stroke() }
  const { header, socket, chip, leds } = ULN2003_LAYOUT
  for (let i = 0; i < 4; i++) {
    const hx = header.x0 + i * header.pitch, cz = chip.z - 0.889 + i * 0.254
    trace(0.05, [[hx, 1.25], [hx, 1.0 - i * 0.05], [-0.9, cz + 0.2], [chip.x - 0.38, cz]])
    trace(0.05, [[chip.x + 0.38, cz], [0.35, cz], [0.35 + i * 0.06, -0.55], [socket.x0 + i * socket.pitch, socket.z + 0.32]])
    trace(0.04, [[0.35 + i * 0.06, cz - 0.02], [0.75, leds.z[i]], [leds.x - 0.15, leds.z[i]]])
  }
  trace(0.09, [[0.504, 1.25], [0.504, 0.95], [1.55, 0.95], [1.55, -1.35], [socket.x0 + 4 * socket.pitch, -1.35]])
  trace(0.09, [[0.25, 1.25], [0.25, 1.1], [-0.1, 1.1]])
  // mounting holes
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [u, v] = P(sx * (HX - 0.3), sz * (HZ - 0.3))
    g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(u, v, 0.26 * kx, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#0d1410'; g.beginPath(); g.arc(u, v, 0.15 * kx, 0, Math.PI * 2); g.fill()
  }
  // outlines + text
  g.strokeStyle = '#f4f4f5'; g.fillStyle = '#f4f4f5'; g.lineWidth = 0.022 * kx
  const rect = (x, z, w, d) => { const [u, v] = P(x - w / 2, z - d / 2); g.strokeRect(u, v, w * kx, d * kz) }
  const text = (s, x, z, size, align = 'center', bold = true) => {
    g.font = `${bold ? '700 ' : ''}${size * kx}px Arial, Helvetica, sans-serif`
    g.textAlign = align; g.textBaseline = 'middle'
    const [u, v] = P(x, z); g.fillText(s, u, v)
  }
  rect(chip.x, chip.z, 0.95, 2.15)
  rect(socket.x0 + 2 * socket.pitch, socket.z, 1.6, 0.72)
  ;['IN1', 'IN2', 'IN3', 'IN4'].forEach((s, i) => text(s, header.x0 + i * header.pitch, 1.02 - (i % 2) * 0.14, 0.11))
  text('−', 0.25, 1.05, 0.2); text('+', 0.504, 1.05, 0.2)
  text('5-12V', 0.377, 0.85, 0.11)
  text('ON', 1.0, 1.05, 0.1); text('OFF', 1.27, 1.05, 0.1)
  ;['A', 'B', 'C', 'D'].forEach((s, i) => text(s, leds.x + 0.32, leds.z[i], 0.16))
  text('ULN2003', chip.x, -0.95, 0.2)
  text('STEPPER DRIVER', -0.95, 1.5, 0.09, 'center', false)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function chipTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 768
  const g = c.getContext('2d')
  g.fillStyle = '#18181a'; g.fillRect(0, 0, 256, 768)
  g.fillStyle = '#2c2c30'; g.beginPath(); g.arc(128, 0, 34, 0, Math.PI); g.fill()   // pin-1 notch (back end)
  g.save(); g.translate(128, 384); g.rotate(Math.PI / 2)
  g.fillStyle = '#c9ccd2'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = '700 74px Arial, sans-serif'; g.fillText('ULN2003APG', 0, -26)
  g.font = '400 44px Arial, sans-serif'; g.fillText('2W1  6KJ', 0, 46)
  g.restore()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 3 mm red LED: body + domed top as one mesh (so the app can light it).
function ledGeometry() {
  const body = new THREE.CylinderGeometry(0.15, 0.15, 0.28, 20); body.translate(0, 0.14, 0)
  const dome = new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(0, 0.28, 0)
  const rim = new THREE.CylinderGeometry(0.175, 0.175, 0.05, 20); rim.translate(0, 0.025, 0)
  return mergeGeometries([body.toNonIndexed(), dome.toNonIndexed(), rim.toNonIndexed()])
}

export function buildUln2003() {
  const root = new THREE.Group()
  root.name = 'ULN2003'
  const L = ULN2003_LAYOUT

  const pcb = box(W, T, D, M.pcbEdge, 0, 0, 0); pcb.name = 'pcb'
  root.add(pcb)
  const skinGeo = new THREE.PlaneGeometry(W, D); skinGeo.rotateX(-Math.PI / 2)
  const skin = new THREE.Mesh(skinGeo, new THREE.MeshStandardMaterial({ map: silkscreenTexture(), roughness: 0.55, metalness: 0.02 }))
  skin.position.y = TOP + 0.002; skin.name = 'pcb_silkscreen'
  root.add(skin)

  // ULN2003APG, DIP-16 on a small standoff, pin 1 toward the back (−z).
  const chip = new THREE.Group(); chip.name = 'ULN2003_chip'
  const cy = TOP + 0.1 + 0.16
  chip.add(box(0.64, 0.32, 1.98, M.chip, L.chip.x, cy, L.chip.z))
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.9), new THREE.MeshStandardMaterial({ map: chipTexture(), roughness: 0.5 }))
  face.rotation.x = -Math.PI / 2
  face.position.set(L.chip.x, cy + 0.161, L.chip.z)
  chip.add(face)
  for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
    const z = L.chip.z - 0.889 + i * 0.254, x = L.chip.x + side * 0.36
    chip.add(box(0.1, 0.03, 0.05, M.tin, x, cy - 0.04, z))
    chip.add(box(0.03, 0.26, 0.05, M.tin, x + side * 0.04, TOP + 0.1, z))
  }
  root.add(chip)

  // JST-XH 5-pin socket, opening up, pins inside.
  const sock = new THREE.Group(); sock.name = 'socket'
  const sx = L.socket.x0 + 2 * L.socket.pitch, sz = L.socket.z
  sock.add(box(1.5, 0.12, 0.6, M.socket, sx, TOP + 0.06, sz))                 // floor
  sock.add(box(1.5, 0.7, 0.07, M.socket, sx, TOP + 0.35, sz - 0.265))         // back wall
  sock.add(box(1.5, 0.7, 0.07, M.socket, sx, TOP + 0.35, sz + 0.265))         // front wall
  for (const dx of [-0.715, 0.715]) sock.add(box(0.07, 0.7, 0.6, M.socket, sx + dx, TOP + 0.35, sz))
  for (const dx of [-0.42, 0.42]) sock.add(box(0.14, 0.42, 0.02, M.socketDk, sx + dx, TOP + 0.4, sz - 0.301))   // keying slots
  for (let i = 0; i < 5; i++) sock.add(box(0.064, 0.55, 0.064, M.gold, L.socket.x0 + i * L.socket.pitch, TOP + 0.4, sz))
  root.add(sock)

  // LEDs A–D (each its own material so they light independently) + resistors.
  const lg = ledGeometry()
  ;['A', 'B', 'C', 'D'].forEach((n, i) => {
    const led = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: 0xd42a2a, emissive: 0x000000, roughness: 0.25, transparent: true, opacity: 0.92 }))
    led.position.set(L.leds.x, TOP, L.leds.z[i]); led.name = `led_${n}`
    root.add(led)
    root.add(box(0.22, 0.07, 0.12, M.resBody, 0.75, TOP + 0.035, L.leds.z[i]))
    for (const dx of [-0.1, 0.1]) root.add(box(0.04, 0.075, 0.125, M.tin, 0.75 + dx, TOP + 0.036, L.leds.z[i]))
  })

  // Front headers: IN1–IN4, − +, and the ON/OFF jumper with its cap.
  const { header, power, jumper } = L
  root.add(box(4 * header.pitch, 0.25, header.pitch, M.black, header.x0 + 1.5 * header.pitch, TOP + 0.125, header.z))
  for (let i = 0; i < 4; i++) root.add(box(0.064, 0.85, 0.064, M.gold, header.x0 + i * header.pitch, TOP + 0.43, header.z))
  for (const xs of [power.x, jumper.x]) {
    root.add(box(2 * header.pitch, 0.25, header.pitch, M.black, (xs[0] + xs[1]) / 2, TOP + 0.125, header.z))
    for (const x of xs) root.add(box(0.064, 0.85, 0.064, M.gold, x, TOP + 0.43, header.z))
  }
  root.add(box(0.5, 0.6, 0.26, M.black, (jumper.x[0] + jumper.x[1]) / 2, TOP + 0.55, jumper.z))

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  return root
}
