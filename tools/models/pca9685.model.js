// ─────────────────────────────────────────────────────────────────────────────
// PCA9685 16-channel 12-bit PWM / servo driver — SOURCE of assets-src/models/pca9685.glb.
//
//   node tools/models/export-model.cjs pca9685     (needs `npm run dev` running)
//   npm run optimize:models pca9685                (→ public/models/pca9685.glb)
//
// SCENE UNITS (1 unit = 1 cm), board centred on the origin, PCB top at y = 0.08,
// no size target in modelLoader — the same frame as PCA9685_PINS in
// src/utils/electronicsFactory.js.
//
// Layout (real 62.5 × 25.4 mm board, seen from above, +z = front):
//   left / right ends : 6-pin headers GND OE SCL SDA VCC V+ (right = pass-through for chaining)
//   front edge        : 16 servo headers in four groups of four, three rows each
//                       PWM (yellow) · V+ (red) · GND (black), channel 0 at the left
//   back              : blue V+ screw terminal, bulk capacitor, PCA9685 chip, A0–A5 address pads
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const W = 6.25, D = 2.54          // board size (cm): x × z
const T = 0.16
const TOP = T / 2
const HX = W / 2, HZ = D / 2
const P = 0.254                    // 0.1" pin pitch

// Shared with electronicsFactory PCA9685_PINS (keep in sync).
export const PCA9685_LAYOUT = {
  header: { x: [-2.86, 2.86], z0: -0.635, pitch: P },          // GND OE SCL SDA VCC V+ (back → front)
  channels: { x0: -2.2, group: 0.33, rows: { PWM: 0.42, 'V+': 0.42 + P, GND: 0.42 + 2 * P } },
  terminal: { x: -0.55, z: -0.78 },
  cap: { x: -1.65, z: -0.72 },
  chip: { x: 0.75, z: -0.55 },
  addr: { x0: 1.55, z: -0.98, pitch: 0.2 },                       // A0 … A5
}
/** x of channel ch (0–15): four groups of four with a small gap between groups. */
export const channelX = (ch) => PCA9685_LAYOUT.channels.x0 + ch * P + Math.floor(ch / 4) * PCA9685_LAYOUT.channels.group

const std = (color, roughness = 0.6, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
const M = {
  pcbEdge: std(0x163c8a, 0.7),
  chip:    std(0x18181a, 0.5),
  tin:     std(0xb8bec7, 0.35, 0.5),
  gold:    std(0xd8a83a, 0.3, 0.6),
  black:   std(0x151517, 0.55),
  red:     std(0xc0262d, 0.55),
  yellow:  std(0xe2b31c, 0.55),
  term:    std(0x1f6fd1, 0.5),
  screw:   std(0xc3c8cf, 0.3, 0.7),
  cap:     std(0x1c1d22, 0.4, 0.2),
  capTop:  std(0xa9afb8, 0.3, 0.6),
  res:     std(0x222225, 0.5),
  led:     new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0x7a0a05, roughness: 0.3 }),
}

// Many identical small parts (pins, pads, resistors) → one merged mesh each.
function batch(name, mat) {
  const geos = []
  return {
    add: (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); geos.push(g) },
    mesh: () => { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.name = name; return m },
  }
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return m
}

// canvas (u, v) ↔ board (x, z)
function silkscreenTexture() {
  const N = 2048, kx = N / W, kz = (N * D / W) / D, H = Math.round(N * D / W)
  const c = document.createElement('canvas'); c.width = N; c.height = H
  const g = c.getContext('2d')
  const Pt = (x, z) => [(x + HX) * kx, (z + HZ) * kz]
  const grad = g.createLinearGradient(0, 0, N, H)
  grad.addColorStop(0, '#1d4fae'); grad.addColorStop(1, '#173f8f')
  g.fillStyle = grad; g.fillRect(0, 0, N, H)
  const L = PCA9685_LAYOUT
  // traces: chip → each channel's resistor → PWM pin; SDA/SCL across the board
  g.strokeStyle = 'rgba(8,30,80,0.55)'; g.lineCap = 'round'
  const trace = (w, pts) => { g.lineWidth = w * kx; g.beginPath(); pts.forEach(([x, z], i) => { const [u, v] = Pt(x, z); i ? g.lineTo(u, v) : g.moveTo(u, v) }); g.stroke() }
  for (let ch = 0; ch < 16; ch++) {
    const x = channelX(ch)
    trace(0.035, [[L.chip.x - 0.5 + ch * 0.065, L.chip.z + 0.3], [x, 0.0], [x, L.channels.rows.PWM - 0.15]])
  }
  for (let i = 0; i < 6; i++) {
    const z = L.header.z0 + i * P
    trace(0.05, [[L.header.x[0] + 0.15, z], [L.header.x[1] - 0.15, z]])
  }
  trace(0.12, [[L.terminal.x, L.terminal.z + 0.4], [L.terminal.x, 0.05], [channelX(15) + 0.3, 0.05]])
  // mounting holes
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [u, v] = Pt(sx * (HX - 0.32), sz * (HZ - 0.32))
    g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(u, v, 0.27 * kx, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#0b1220'; g.beginPath(); g.arc(u, v, 0.16 * kx, 0, Math.PI * 2); g.fill()
  }
  // text
  g.fillStyle = '#f4f4f5'; g.strokeStyle = '#f4f4f5'; g.lineWidth = 0.02 * kx
  const text = (s, x, z, size, align = 'center', bold = true) => {
    g.font = `${bold ? '700 ' : ''}${size * kx}px Arial, Helvetica, sans-serif`
    g.textAlign = align; g.textBaseline = 'middle'
    const [u, v] = Pt(x, z); g.fillText(s, u, v)
  }
  const names = ['GND', 'OE', 'SCL', 'SDA', 'VCC', 'V+']
  names.forEach((s, i) => { text(s, L.header.x[0] + 0.42, L.header.z0 + i * P, 0.1, 'left'); text(s, L.header.x[1] - 0.42, L.header.z0 + i * P, 0.1, 'right') })
  for (let ch = 0; ch < 16; ch++) text(String(ch), channelX(ch), L.channels.rows.PWM - 0.24, 0.11)
  for (let gI = 0; gI < 4; gI++) {
    const [u0] = Pt(channelX(gI * 4) - 0.14, 0), [u1] = Pt(channelX(gI * 4 + 3) + 0.14, 0)
    const [, v0] = Pt(0, L.channels.rows.PWM - 0.14), [, v1] = Pt(0, L.channels.rows.GND + 0.14)
    g.strokeRect(u0, v0, u1 - u0, v1 - v0)
  }
  text('PWM', channelX(15) + 0.42, L.channels.rows.PWM, 0.085, 'left')
  text('V+', channelX(15) + 0.42, L.channels.rows['V+'], 0.085, 'left')
  text('GND', channelX(15) + 0.42, L.channels.rows.GND, 0.085, 'left')
  text('16-CHANNEL 12-BIT PWM / SERVO DRIVER', 0.15, -0.12, 0.13)
  text('PCA9685', L.chip.x, L.chip.z - 0.42, 0.13)
  ;['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].forEach((s, i) => text(s, L.addr.x0 + i * L.addr.pitch, L.addr.z + 0.2, 0.075))
  text('V+', L.terminal.x - 0.25, L.terminal.z - 0.5, 0.1); text('GND', L.terminal.x + 0.25, L.terminal.z - 0.5, 0.1)
  text('PWR', L.cap.x + 0.55, L.cap.z + 0.45, 0.075)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function chipTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#18181a'; g.fillRect(0, 0, 512, 256)
  g.fillStyle = '#2c2c30'; g.beginPath(); g.arc(34, 220, 14, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#c9ccd2'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = '700 84px Arial, sans-serif'; g.fillText('PCA9685', 256, 100)
  g.font = '400 46px Arial, sans-serif'; g.fillText('PW  1T07', 256, 178)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function buildPca9685() {
  const root = new THREE.Group()
  root.name = 'PCA9685'
  const L = PCA9685_LAYOUT

  const pcb = box(W, T, D, M.pcbEdge, 0, 0, 0); pcb.name = 'pcb'
  root.add(pcb)
  const skinGeo = new THREE.PlaneGeometry(W, D); skinGeo.rotateX(-Math.PI / 2)
  const skin = new THREE.Mesh(skinGeo, new THREE.MeshStandardMaterial({ map: silkscreenTexture(), roughness: 0.55, metalness: 0.02 }))
  skin.position.y = TOP + 0.002; skin.name = 'pcb_silkscreen'
  root.add(skin)

  // PCA9685 in TSSOP-28: a thin black body with 14 gull-wing legs each side.
  const chip = new THREE.Group(); chip.name = 'PCA9685_chip'
  chip.add(box(1.0, 0.1, 0.44, M.chip, L.chip.x, TOP + 0.05, L.chip.z))
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.42), new THREE.MeshStandardMaterial({ map: chipTexture(), roughness: 0.5 }))
  face.rotation.x = -Math.PI / 2; face.position.set(L.chip.x, TOP + 0.101, L.chip.z)
  chip.add(face)
  for (const side of [-1, 1]) for (let i = 0; i < 14; i++)
    chip.add(box(0.025, 0.025, 0.1, M.tin, L.chip.x - 0.455 + i * 0.07, TOP + 0.013, L.chip.z + side * 0.27))
  root.add(chip)

  // Blue 2-way screw terminal for the servo supply (V+ / GND).
  const term = new THREE.Group(); term.name = 'terminal'
  term.add(box(1.0, 0.75, 0.8, M.term, L.terminal.x, TOP + 0.375, L.terminal.z))
  for (const dx of [-0.25, 0.25]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20), M.screw)
    screw.position.set(L.terminal.x + dx, TOP + 0.78, L.terminal.z - 0.05); term.add(screw)
    term.add(box(0.22, 0.02, 0.04, M.black, L.terminal.x + dx, TOP + 0.815, L.terminal.z - 0.05))
    term.add(box(0.36, 0.3, 0.06, M.black, L.terminal.x + dx, TOP + 0.4, L.terminal.z - 0.4))   // wire opening
  }
  root.add(term)

  // Bulk electrolytic capacitor + a red power LED.
  const capBody = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.85, 28), M.cap)
  capBody.position.set(L.cap.x, TOP + 0.425, L.cap.z); capBody.name = 'capacitor'
  root.add(capBody)
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.01, 28), M.capTop)
  capTop.position.set(L.cap.x, TOP + 0.856, L.cap.z); root.add(capTop)
  root.add(box(0.12, 0.05, 0.07, M.led, L.cap.x + 0.55, TOP + 0.025, L.cap.z + 0.25))

  // Address pads A0–A5 (open solder jumpers).
  const pins = batch('pins', M.gold), res = batch('resistors', M.res)
  for (let i = 0; i < 6; i++) for (const dz of [-0.05, 0.05])
    pins.add(0.12, 0.01, 0.07, L.addr.x0 + i * L.addr.pitch, TOP + 0.005, L.addr.z + dz)

  // One 220 Ω resistor per channel, in front of the chip.
  for (let ch = 0; ch < 16; ch++) res.add(0.1, 0.05, 0.18, channelX(ch), TOP + 0.025, 0.12)

  // End headers (right angle on the real board; upright here so the pins are easy to reach).
  for (const hx of L.header.x) {
    root.add(box(P, 0.25, 6 * P, M.black, hx, TOP + 0.125, L.header.z0 + 2.5 * P))
    for (let i = 0; i < 6; i++) pins.add(0.064, 0.85, 0.064, hx, TOP + 0.43, L.header.z0 + i * P)
  }

  // Servo headers: per group of four, three coloured rows (PWM yellow, V+ red, GND black).
  const rowMat = { PWM: M.yellow, 'V+': M.red, GND: M.black }
  for (let gI = 0; gI < 4; gI++) {
    const cx = (channelX(gI * 4) + channelX(gI * 4 + 3)) / 2
    for (const [row, z] of Object.entries(L.channels.rows)) root.add(box(4 * P, 0.25, P, rowMat[row], cx, TOP + 0.125, z))
  }
  for (let ch = 0; ch < 16; ch++) for (const z of Object.values(L.channels.rows))
    pins.add(0.064, 0.85, 0.064, channelX(ch), TOP + 0.43, z)
  root.add(pins.mesh(), res.mesh())

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  return root
}
