// ─────────────────────────────────────────────────────────────────────────────
// Waveshare 2.8inch Capacitive Touch LCD (240×320, SPI, ST7789 + CST328)
// — SOURCE of assets-src/models/tft28.glb.
//
//   node tools/models/export-model.cjs tft28     (needs `npm run dev` running)
//   npm run optimize:models tft28                (→ public/models/tft28.glb)
//
// Authored in MILLIMETRES inside a 0.1-scaled node, so the GLB is in scene units
// (1 unit = 1 cm) with no size target in modelLoader — the same frame as
// TFT28_PINS in src/utils/electronicsFactory.js.
//
// Frame: lying flat, screen UP (+y), portrait. x across the 50.54 mm width,
// +z towards the thick bottom bezel (the "chin") — which is also the end the
// 13-pin GH1.25 connector sits at. The rear parts' tips are at y = 0, so the
// module rests on its four standoffs on the workplane.
//
// Every number comes from Waveshare's 2D drawing (2.8inch-Capacitive-Touch-LCD.pdf)
// and the dimensioned product photo:
//   touch glass (TP OD) 50.54 × 73.06, R2.00 corners, lens 0.70, TP+LCD 3.60
//   viewing area (TP VA) 43.80 × 58.20, 3.37 from each side, 10.43 from the bottom
//   active area 43.20 × 57.60 (240 × 320 px at 0.18 mm)
//   PCB 49.90 × 69.00, 4 × M2.5 holes 4.50 in from each edge (41.00 × 60.00 apart)
//   overall depth 10.00, front of the glass → back of the PCB 6.00
// Rear layout positions were measured off the drawing's rear view (xr, yr in mm
// from its top-left corner); x = 24.95 − xr (the rear view is mirrored), z = yr − 34.5.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TFT28_PIN_ORDER, TFT28_GH } from '../../src/utils/tft28.js'

// ── Dimensions (mm) ──────────────────────────────────────────────────────────
const GLASS_W = 50.54, GLASS_L = 73.06, GLASS_R = 2.0
const PCB_W = 49.9, PCB_L = 69.0, PCB_T = 1.6
const VA = { w: 43.8, l: 58.2, z: (-GLASS_L / 2 + (GLASS_L - 58.2 - 10.43)) + 58.2 / 2 }   // z = −3.00
const AA = { w: 43.2, l: 57.6 }
// Stack heights (y, mm) — rear tips at 0, glass front at 10.
const Y = {
  pcbBack: 4.0,               // 10.00 − 6.00
  pcbFront: 4.0 + PCB_T,      // 5.6
  lcdBack: 6.4,               // 0.8 adhesive foam tape
  lcdFront: 9.3,              // 10 − 0.7 lens
  glassFront: 10.0,
}
const xOf = (xr) => 24.95 - xr
const zOf = (yr) => yr - 34.5

// 13-pin GH1.25 "Interface 2", pin 1 (VCC) first — the pin table and the pin
// x positions come from src/utils/tft28.js, the same source as the 3D pin
// spheres (electronicsFactory TFT28_PINS) and the wiring UI.
export const TFT28_LAYOUT = {
  gh: { x0: TFT28_GH.x0, pitch: TFT28_GH.pitch, z: 28.0, depth: 4.4, width: 19.5, height: 3.9 },
  holes: { x: 20.45, z: 30.0, d: 2.7 },
}

// ── Materials ────────────────────────────────────────────────────────────────
const std = (color, roughness = 0.6, metalness = 0.0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })
const M = {
  glass:     std(0x0b0c0e, 0.05, 0.0),
  lcdOff:    std(0x030304, 0.12, 0.0),
  lcdSide:   std(0x26272b, 0.55),
  lcdBack:   std(0xbfc3c9, 0.35, 0.75),         // backlight's steel back plate
  foam:      std(0x111112, 0.95),
  pcbEdge:   std(0x2b4f8f, 0.75),              // FR-4 edge under blue mask
  ic:        std(0x161618, 0.7),
  tin:       std(0xc4c9d0, 0.3, 0.8),
  gold:      std(0xd4a44a, 0.3, 0.85),
  ivory:     std(0xece6d6, 0.55),               // connector nylon
  latch:     std(0x1b1b1d, 0.5),
  resTop:    std(0x141416, 0.6),
  resBody:   std(0xe8e4da, 0.6),
  cap:       std(0xa77d4e, 0.55),
  polyimide: std(0xd47d23, 0.35, 0.0),
  flexBlack: std(0x141414, 0.45),
  kapton:    std(0xe08a1e, 0.25, 0.0, { transparent: true, opacity: 0.6 }),
  steel:     std(0xd3d6db, 0.28, 0.9),
  hole:      std(0x0a0a0c, 0.9),
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function box(name, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z); m.name = name
  return m
}
// Many identical tiny parts (leads, pads, passives) → one merged mesh per material.
function batch(name, mat) {
  const geos = []
  return {
    add(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); geos.push(g) },
    mesh() { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.name = name; return m },
  }
}
function roundRect(w, l, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -l / 2
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + l - r); s.quadraticCurveTo(x + w, y + l, x + w - r, y + l)
  s.lineTo(x + r, y + l); s.quadraticCurveTo(x, y + l, x, y + l - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
  return s
}
// Extrude a shape (drawn in x / −z) upward by `depth` from y = y0, softly bevelled.
function slab(shape, depth, y0, bevel = 0.08) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 10,
  })
  g.rotateX(-Math.PI / 2)                 // shape y → −z, extrusion → +y
  g.translate(0, y0 + bevel, 0)
  return g
}

// ── PCB silkscreen + copper-under-mask texture (rear face) ───────────────────
// Canvas is the drawing's rear view: canvas x = xr, canvas y = yr (mm × K).
const K = 41.04                                   // px per mm → 2048 px across 49.9 mm
function rearTexture() {
  const CW = Math.round(PCB_W * K), CH = Math.round(PCB_L * K)
  const c = document.createElement('canvas'); c.width = CW; c.height = CH
  const g = c.getContext('2d')
  const P = (xr, yr) => [xr * K, yr * K]

  // Blue solder mask
  const grad = g.createLinearGradient(0, 0, CW, CH)
  grad.addColorStop(0, '#2457ac'); grad.addColorStop(1, '#1d4b98')
  g.fillStyle = grad; g.fillRect(0, 0, CW, CH)

  // Copper traces seen through the mask (slightly lighter blue), 45° routing
  g.strokeStyle = 'rgba(120,170,240,0.32)'; g.lineCap = 'round'; g.lineJoin = 'round'
  const trace = (w, pts) => { g.lineWidth = w * K; g.beginPath(); pts.forEach(([x, y], i) => { const [u, v] = P(x, y); i ? g.lineTo(u, v) : g.moveTo(u, v) }); g.stroke() }
  for (let i = 0; i < 13; i++) {                    // GH pins → up the board towards the passives / level shifter
    const xr = 15.5 + i * 1.25
    trace(0.22, [[xr, 58.4], [xr, 55 - (i % 4) * 0.6], [16 + i * 1.9, 50 - (i % 4) * 0.6], [16 + i * 1.9, 48.6]])
  }
  for (let i = 0; i < 9; i++) trace(0.2, [[18 + i * 2.2, 38.6], [18 + i * 2.2, 37.4]])
  for (let i = 0; i < 10; i++) trace(0.18, [[31.6 + i * 0.65, 15.4], [31.6 + i * 0.65, 17.0], [27.5 + i * 0.4, 21.2]])
  for (let i = 0; i < 18; i++) trace(0.16, [[20.0 + i * 0.5, 9.8], [20.0 + i * 0.5, 11.6], [31.6 + (i % 10) * 0.65, 8.9]])
  trace(0.6, [[3.2, 10], [3.2, 60], [12, 66.5], [40, 66.5]])                 // GND / VCC pours along the edges
  trace(0.6, [[46.7, 10], [46.7, 60]])
  g.strokeStyle = 'rgba(120,170,240,0.18)'
  for (let i = 0; i < 6; i++) trace(0.35, [[8 + i * 6, 2.2], [8 + i * 6 + 4, 2.2]])
  // diagonal pour outline like the real board
  g.strokeStyle = 'rgba(150,190,250,0.22)'; g.lineWidth = 0.25 * K
  g.beginPath(); [[9, 1.6], [41, 1.6], [48.2, 8.8], [48.2, 60], [41, 67.4], [9, 67.4], [1.7, 60], [1.7, 8.8], [9, 1.6]]
    .forEach(([x, y], i) => { const [u, v] = P(x, y); i ? g.lineTo(u, v) : g.moveTo(u, v) }); g.stroke()

  // Exposed copper (ENIG gold) annular pads around the four holes
  for (const [xr, yr] of [[4.5, 4.5], [45.4, 4.5], [4.5, 64.5], [45.4, 64.5]]) {
    const [u, v] = P(xr, yr)
    g.fillStyle = '#cfa24a'; g.beginPath(); g.arc(u, v, 2.6 * K, 0, Math.PI * 2); g.fill()
  }

  // White silkscreen
  g.fillStyle = '#f5f6f8'; g.strokeStyle = '#f5f6f8'
  const text = (s, xr, yr, size, { rot = -Math.PI / 2, align = 'left', weight = 700 } = {}) => {
    g.save(); const [u, v] = P(xr, yr); g.translate(u, v); g.rotate(rot)
    g.font = `${weight} ${size * K}px Arial, Helvetica, sans-serif`
    g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, 0, 0); g.restore()
  }
  // Photo orientation is the rear view turned 90° clockwise, so its horizontal
  // text runs bottom-to-top here.
  text('Waveshare', 10.6, 54.4, 1.15, { weight: 700 })
  text('2.8inch Capacitive Touch LCD', 6.4, 46.2, 2.0)
  text('240×320 Pixels', 9.3, 46.2, 1.25)
  TFT28_PIN_ORDER.forEach((s, i) => text(s, 15.5 + i * 1.25, 57.4, 0.95))
  text('Interface 2', 15.6, 67.2, 1.05, { rot: 0 })
  text('Interface 1', 21.0, 1.9, 1.05, { rot: 0 })
  // connector / IC outlines
  g.lineWidth = 0.15 * K
  const rect = (x0, y0, x1, y1) => { const [u0, v0] = P(x0, y0), [u1, v1] = P(x1, y1); g.strokeRect(u0, v0, u1 - u0, v1 - v0) }
  rect(14.0, 59.9, 34.0, 65.0)            // GH1.25
  rect(17.0, 4.6, 31.4, 10.2)             // Interface 1 FPC
  rect(17.0, 16.4, 31.4, 22.0)            // LCD FPC
  rect(31.0, 8.6, 40.2, 15.2)             // level shifter
  // pin-1 markers
  g.beginPath(); g.arc(...P(15.5, 66.0), 0.35 * K, 0, Math.PI * 2); g.fill()
  g.beginPath(); g.arc(...P(31.5, 15.9), 0.3 * K, 0, Math.PI * 2); g.fill()
  // FPC pin numbers like the real board ("1" … "18")
  text('1', 17.6, 3.9, 0.8, { rot: 0, align: 'center' }); text('18', 30.8, 3.9, 0.8, { rot: 0, align: 'center' })

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// ── PCB with its real cut-outs (4 × M2.5 holes + the flex slot) ─────────────
function pcbShape() {
  const s = roundRect(PCB_W - 0.16, PCB_L - 0.16, 0.8)
  const H = TFT28_LAYOUT.holes
  // shape coordinates are (x, −z)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const h = new THREE.Path(); h.absarc(sx * H.x, -sz * H.z, H.d / 2 + 0.08, 0, Math.PI * 2, true); s.holes.push(h)
  }
  // Flex slot: xr 16.0 → 42.3, yr 33.8 → 36.4 (a rounded oblong)
  const x0 = xOf(42.3), x1 = xOf(16.0), zc = zOf(35.1), r = 1.3 + 0.08
  const slot = new THREE.Path()
  slot.moveTo(x0 + r, -zc - r); slot.lineTo(x1 - r, -zc - r)
  slot.absarc(x1 - r, -zc, r, -Math.PI / 2, Math.PI / 2, false)
  slot.lineTo(x0 + r, -zc + r)
  slot.absarc(x0 + r, -zc, r, Math.PI / 2, Math.PI * 1.5, false)
  s.holes.push(slot)
  return s
}

function buildPcb() {
  const geo = slab(pcbShape(), PCB_T, Y.pcbBack, 0.08)
  // UVs for the rear (and front) faces straight from the rear-view canvas.
  const pos = geo.attributes.position, uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    uv.setXY(i, (24.95 - x) / PCB_W, 1 - (z + 34.5) / PCB_L)
  }
  uv.needsUpdate = true
  const skin = new THREE.MeshStandardMaterial({ map: rearTexture(), roughness: 0.62, metalness: 0.02 })
  // ExtrudeGeometry's group 0 holds both lids — the first half is the start lid
  // (the rear face here), the second the front face under the LCD, which gets
  // plain mask (the rear silkscreen would show there mirrored).
  const lids = geo.groups[0], half = lids.count / 2
  geo.groups.splice(0, 1, { start: lids.start, count: half, materialIndex: 0 }, { start: lids.start + half, count: half, materialIndex: 2 })
  const m = new THREE.Mesh(geo, [skin, M.pcbEdge, std(0x2457ac, 0.65)])     // [rear, sides, front]
  m.name = 'pcb'
  return m
}

// ── Front: touch glass + LCD + adhesive ──────────────────────────────────────
function buildDisplayStack(root) {
  const glass = new THREE.Mesh(slab(roundRect(GLASS_W - 0.2, GLASS_L - 0.2, GLASS_R - 0.1), Y.glassFront - Y.lcdFront, Y.lcdFront, 0.1), M.glass)
  glass.name = 'touch_glass'
  root.add(glass)

  // Powered-off active area, flush under the glass surface.
  const aaGeo = new THREE.PlaneGeometry(AA.w, AA.l); aaGeo.rotateX(-Math.PI / 2)
  const aa = new THREE.Mesh(aaGeo, M.lcdOff)
  aa.position.set(0, Y.glassFront + 0.004, VA.z); aa.name = 'lcd_active_area'
  root.add(aa)
  // The printed viewing-area edge (TP VA) is a hair lighter than the bezel ink.
  const vaGeo = new THREE.PlaneGeometry(VA.w, VA.l); vaGeo.rotateX(-Math.PI / 2)
  const va = new THREE.Mesh(vaGeo, std(0x060607, 0.08))
  va.position.set(0, Y.glassFront + 0.002, VA.z); va.name = 'viewing_area'
  root.add(va)

  // LCD panel (TFT glass + polariser + backlight in its frame), 2.9 mm.
  const lcdW = 49.4, lcdL = 69.8, lcdT = Y.lcdFront - Y.lcdBack
  // Box faces: +x, −x, +y, −y, +z, −z → back (−y) is the backlight's steel plate.
  const lcd = new THREE.Mesh(new THREE.BoxGeometry(lcdW, lcdT, lcdL), [M.lcdSide, M.lcdSide, M.lcdSide, M.lcdBack, M.lcdSide, M.lcdSide])
  lcd.position.set(0, (Y.lcdFront + Y.lcdBack) / 2, -0.4); lcd.name = 'lcd_panel'
  root.add(lcd)

  // ST7789 driver: chip-on-glass on the panel's bottom ledge (hidden behind the PCB, as on the real module).
  root.add(box('display_driver_ST7789_COG', 17.0, 0.3, 1.1, M.ic, 0, Y.lcdBack - 0.15, 33.0))

  // Double-sided foam tape between panel and PCB (two strips, clear of the slot and the driver).
  for (const sx of [-1, 1]) root.add(box(`adhesive_foam_${sx < 0 ? 'L' : 'R'}`, 5.0, Y.lcdBack - Y.pcbFront, 52, M.foam, sx * 19.5, (Y.lcdBack + Y.pcbFront) / 2, -1))
}

// ── Rear electronics ─────────────────────────────────────────────────────────
// All rear parts hang DOWN from the PCB's back face (y = 4.0).
const B = Y.pcbBack
function hang(h) { return B - h / 2 }        // centre-y of a part of height h on the rear

function addStandoffs(root) {
  // M2.5 SMT threaded standoffs (silver), 4 mm tall, soldered on the rear pads.
  const H = TFT28_LAYOUT.holes
  const prof = [[1.25, 0.0], [2.05, 0.0], [2.2, 0.15], [2.2, 3.85], [2.35, 3.88], [2.35, 4.0], [1.25, 4.0], [1.25, 0.0]]
    .map(([r, y]) => new THREE.Vector2(r, y))
  const geos = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = new THREE.LatheGeometry(prof, 32); g.translate(sx * H.x, 0, sz * H.z); geos.push(g)
  }
  const m = new THREE.Mesh(mergeGeometries(geos), M.steel); m.name = 'standoffs_M2.5'
  root.add(m)
}

// 13-pin GH1.25 right-angle SMT header — mouth faces the board edge (+z).
function addGhConnector(root, tin, gold) {
  const L = TFT28_LAYOUT.gh
  const xc = L.x0 - 6 * L.pitch, h = L.height, yc = hang(h)
  const grp = new THREE.Group(); grp.name = 'connector_GH1.25_13pin'
  // housing walls around a cavity (so the mouth is really open)
  const wall = 0.55, cavH = 1.9, cavW = 12 * L.pitch + 1.7
  grp.add(box('gh_back', L.width, h, 1.0, M.ivory, xc, yc, L.z - L.depth / 2 + 0.5))
  grp.add(box('gh_top', L.width, h - cavH - wall, L.depth - 1.0, M.ivory, xc, B - (h - cavH - wall) / 2, L.z + 0.5))
  grp.add(box('gh_bottom', L.width, wall, L.depth - 1.0, M.ivory, xc, B - h + wall / 2, L.z + 0.5))
  for (const s of [-1, 1]) grp.add(box('gh_side', (L.width - cavW) / 2, cavH, L.depth - 1.0, M.ivory, xc + s * (cavW / 2 + (L.width - cavW) / 4), B - h + wall + cavH / 2, L.z + 0.5))
  // polarising keys on the cavity floor
  for (const s of [-1, 1]) grp.add(box('gh_key', 0.6, 0.35, L.depth - 1.6, M.ivory, xc + s * (cavW / 2 - 0.5), B - h + wall + 0.17, L.z + 0.6))
  root.add(grp)
  for (let i = 0; i < 13; i++) {
    const x = L.x0 - i * L.pitch
    gold.add(0.32, 0.18, L.depth - 1.4, x, B - h + wall + cavH * 0.5, L.z + 0.2)          // contact blade in the mouth
    tin.add(0.35, 0.18, 1.1, x, B - 0.09, L.z - L.depth / 2 - 0.45)                     // SMT leg on its pad
    tin.add(0.5, 0.12, 0.7, x, B - 0.06, L.z - L.depth / 2 - 0.7)                       // solder fillet
  }
  for (const s of [-1, 1]) {                                                          // side mounting tabs
    tin.add(0.25, 2.2, 1.8, xc + s * (L.width / 2 + 0.13), B - 1.1, L.z + 0.3)
    tin.add(0.9, 0.12, 1.8, xc + s * (L.width / 2 + 0.45), B - 0.06, L.z + 0.3)
  }
}

// 0.5 mm-pitch flip-lock FPC socket.
function addFpcSocket(root, name, cx, cz, pins, openTowards, tin, gold) {
  const w = (pins - 1) * 0.5 + 5.0, d = 4.2, h = 2.0
  const grp = new THREE.Group(); grp.name = name
  const s = openTowards                                       // −1: mouth faces −z, +1: +z
  grp.add(box(`${name}_housing`, w, h * 0.55, d - 1.3, M.ivory, cx, hang(h * 0.55), cz - s * 0.65))
  grp.add(box(`${name}_latch`, w - 1.2, h * 0.5, 1.25, M.latch, cx, B - h * 0.75, cz + s * (d / 2 - 0.65)))   // flip actuator over the mouth
  grp.add(box(`${name}_mouth`, w - 2.0, 0.3, 1.25, M.latch, cx, B - 0.15, cz + s * (d / 2 - 0.65)))
  for (const k of [-1, 1]) grp.add(box(`${name}_post`, 0.6, h, 1.25, M.ivory, cx + k * (w / 2 - 0.3), hang(h), cz + s * (d / 2 - 0.65)))
  root.add(grp)
  for (let i = 0; i < pins; i++) {
    const x = cx - (pins - 1) * 0.25 + i * 0.5
    tin.add(0.22, 0.12, 0.9, x, B - 0.06, cz - s * (d / 2 + 0.3))                        // rear solder tails
    gold.add(0.18, 0.06, d - 1.6, x, B - h * 0.55 - 0.03, cz - s * 0.5)                  // contact tines
  }
  for (const k of [-1, 1]) tin.add(0.8, 1.3, 1.6, cx + k * (w / 2 + 0.3), B - 0.65, cz)   // metal hold-downs
}

function addIcs(root, tin) {
  // Level shifter / buffer, SSOP-20, 3.3 V/5 V translation (part number not given by Waveshare).
  const sx = xOf(35.6), sz = zOf(11.9), sw = 7.2, sd = 5.3, sh = 1.5
  root.add(box('level_shifter_SSOP20', sw, sh, sd, M.ic, sx, hang(sh) , sz))
  root.add(box('level_shifter_pin1', 0.6, 0.02, 0.6, M.resTop, sx + sw / 2 - 0.8, B - sh - 0.01, sz + sd / 2 - 0.8))
  for (const side of [-1, 1]) for (let i = 0; i < 10; i++) {
    const x = sx - 4.5 * 0.65 + i * 0.65
    tin.add(0.28, 0.15, 1.0, x, B - 0.4, sz + side * (sd / 2 + 0.35))
    tin.add(0.28, 0.12, 0.6, x, B - 0.06, sz + side * (sd / 2 + 0.85))
  }

  // Touch controller (CST328 on V1 boards), QFN under Kapton tape, next to the GH connector.
  const qx = xOf(36.7), qz = zOf(53.7)
  root.add(box('touch_controller_CST328_QFN', 4.0, 0.75, 4.0, M.ic, qx, hang(0.75), qz))
  for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
    const o = -1.5 + i * 0.5
    tin.add(0.25, 0.08, 0.5, qx + o, B - 0.04, qz + side * 2.2)
    tin.add(0.5, 0.08, 0.25, qx + side * 2.2, B - 0.04, qz + o)
  }
  const kap = box('kapton_tape', 8.2, 0.06, 8.8, M.kapton, qx, B - 0.8, qz)
  root.add(kap)
  for (const s of [-1, 1]) root.add(box('kapton_tape_drape', 0.06, 0.78, 8.8, M.kapton, qx + s * 4.1, B - 0.41, qz))

  // SOT-23 parts: backlight switch (3-pin) and two SOT-23-6 (LDO regulator / reset).
  const sot = (name, x, z, pins6) => {
    root.add(box(name, 2.9, 1.0, 1.6, M.ic, x, hang(1.0) - 0.1, z))
    const n = pins6 ? 3 : 2
    for (let i = 0; i < n; i++) tin.add(0.4, 0.15, 0.9, x - (n - 1) * 0.475 + i * 0.95, B - 0.3, z + 1.1)
    for (let i = 0; i < (pins6 ? 3 : 1); i++) tin.add(0.4, 0.15, 0.9, x - (pins6 ? 0.95 : 0) + i * 0.95, B - 0.3, z - 1.1)
  }
  sot('backlight_switch_SOT23', xOf(21.2), zOf(43.8), false)
  sot('regulator_LDO_SOT23-6', xOf(28.7), zOf(41.0), true)
  sot('reset_supervisor_SOT23-6', xOf(28.7), zOf(45.7), true)
}

// 0603 resistors (black top) and MLCCs (tan) in the grid under the slot.
function addPassives(root, tin) {
  const resTop = batch('resistors_0603', M.resTop), resBody = batch('resistor_bodies_0603', M.resBody), caps = batch('capacitors_0603', M.cap)
  const R = 'R', C = 'C'
  const cols = [18.0, 21.2, 24.8, 32.6, 36.2, 39.6]
  const rows = [39.7, 42.0, 44.8, 47.4]
  const grid = [
    [R, C, R, R, C, R],
    [C, null, null, C, R, C],
    [R, null, C, R, C, null],
    [C, R, R, null, R, C],
  ]
  const part = (kind, x, z) => {
    const L = 1.6, W = 0.8, H = 0.45
    if (kind === R) { resBody.add(L - 0.5, H - 0.04, W, x, B - (H - 0.04) / 2, z); resTop.add(L - 0.5, 0.04, W - 0.02, x, B - H + 0.02, z) }
    else caps.add(L - 0.5, H, W, x, B - H / 2, z)
    for (const s of [-1, 1]) { tin.add(0.25, H, W + 0.02, x + s * (L / 2 - 0.125), B - H / 2, z); tin.add(0.3, 0.1, W + 0.1, x + s * (L / 2 + 0.05), B - 0.05, z) }
  }
  grid.forEach((row, ri) => row.forEach((k, ci) => { if (k) part(k, xOf(cols[ci]), zOf(rows[ri])) }))
  // decoupling by the level shifter and the touch IC
  part(C, xOf(40.7), zOf(14.9)); part(C, xOf(31.0), zOf(13.5))
  part(C, xOf(33.4), zOf(57.0)); part(R, xOf(40.1), zOf(57.0))
  root.add(resTop.mesh(), resBody.mesh(), caps.mesh())
}

// Flex circuits: the LCD's orange FPC and the touch panel's black FPC come
// through the slot and lie flat on the rear into their sockets.
function addFlexes(root) {
  const t = 0.12, y = B - t / 2
  const slotZ = zOf(35.1)
  // LCD flex → LCD FPC socket (opening faces +z, towards the slot)
  const lx = 1.1, lz0 = zOf(21.0) - 0.4, lz1 = slotZ
  root.add(box('lcd_flex_FPC', 9.7, t, lz1 - lz0, M.polyimide, lx, y, (lz0 + lz1) / 2))
  root.add(box('lcd_flex_FPC_fold', 9.7, Y.lcdBack - B + 0.2, t, M.polyimide, lx, (Y.lcdBack + B) / 2 - 0.1, slotZ + 0.6))
  root.add(box('lcd_flex_stiffener', 9.7, 0.2, 2.2, M.polyimide, lx, B - 0.22, lz0 + 1.2))
  // touch flex → 6-pin socket
  const tx = -11.7, tz0 = zOf(22.2) + 0.4
  root.add(box('touch_flex_FPC', 4.3, t, slotZ - tz0, M.flexBlack, tx, y - 0.01, (tz0 + slotZ) / 2))
  root.add(box('touch_flex_FPC_fold', 4.3, Y.lcdBack - B + 0.2, t, M.flexBlack, tx, (Y.lcdBack + B) / 2 - 0.1, slotZ + 0.3))
}

export function buildTft28() {
  const root = new THREE.Group()
  root.name = 'Waveshare_2.8in_Capacitive_Touch_LCD'
  const mm = new THREE.Group()
  mm.name = 'module_mm'
  mm.scale.setScalar(0.1)                  // author in mm, export in cm (scene units)
  root.add(mm)

  buildDisplayStack(mm)
  mm.add(buildPcb())
  addStandoffs(mm)

  const tin = batch('solder_joints_and_leads', M.tin), gold = batch('contacts_gold', M.gold)
  addGhConnector(mm, tin, gold)
  addFpcSocket(mm, 'fpc_interface1_18pin', xOf(24.2), zOf(7.4), 18, -1, tin, gold)
  addFpcSocket(mm, 'fpc_lcd_socket', xOf(24.2), zOf(19.2), 18, +1, tin, gold)
  // 6-pin touch socket (black)
  const tsx = xOf(37.0), tsz = zOf(21.3)
  mm.add(box('fpc_touch_socket_6pin', 5.5, 1.2, 3.0, M.latch, tsx, hang(1.2), tsz))
  for (let i = 0; i < 6; i++) tin.add(0.22, 0.12, 0.8, tsx - 1.25 + i * 0.5, B - 0.06, tsz - 1.9)
  addIcs(mm, tin)
  addPassives(mm, tin)
  addFlexes(mm)
  mm.add(tin.mesh(), gold.mesh())

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
  return root
}
