// ─────────────────────────────────────────────────────────────────────────────
// Real-size model kit for catalogue parts (1 unit = 1 cm, Y up, part bottom at
// y = 0 unless noted). Small builders for the features almost every electronic
// part is made of: PCBs, 2.54 mm headers, DIP packages, tinned leads, domes,
// printed text. Each returns a THREE object already positioned.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three'

export const PITCH = 0.254          // 0.1" header / breadboard pitch
export const DIP_ROW = 0.762        // 0.3" DIP row spacing
export const PCB_T = 0.16           // 1.6 mm board

const _mats = new Map()
/** Shared MeshStandardMaterial per (colour, options). */
export function mat(color, { metal = 0.1, rough = 0.6, emissive, opacity } = {}) {
  const key = `${color}|${metal}|${rough}|${emissive ?? ''}|${opacity ?? ''}`
  if (emissive != null || opacity != null) {
    // Per-mesh (not shared): these get animated (glow) or are see-through.
    return new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough,
      emissive: emissive ?? 0x000000, transparent: opacity != null, opacity: opacity ?? 1 })
  }
  if (!_mats.has(key)) _mats.set(key, new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }))
  return _mats.get(key)
}
export const GOLD = () => mat(0xd4a937, { metal: 0.9, rough: 0.3 })
export const TIN = () => mat(0xc9cdd2, { metal: 0.85, rough: 0.35 })
export const BLACK = () => mat(0x1a1a1a, { rough: 0.7 })

export function at(obj, x = 0, y = 0, z = 0) { obj.position.set(x, y, z); return obj }

export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  return at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material), x, y, z)
}
/** Cylinder along Y (default), or along X / Z. */
export function cyl(r, h, material, { axis = 'y', seg = 24, rTop } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, h, seg), material)
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  return m
}

/** A PCB lying flat, top face at y = top. */
export function pcb(w, d, { color = 0x1f6f3a, top = PCB_T, holes = true } = {}) {
  const g = new THREE.Group()
  g.add(box(w, PCB_T, d, mat(color, { rough: 0.5 }), 0, top - PCB_T / 2, 0))
  if (holes && w > 1 && d > 1) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 16), GOLD())
      ring.rotation.x = -Math.PI / 2
      g.add(at(ring, sx * (w / 2 - 0.25), top + 0.001, sz * (d / 2 - 0.25)))
    }
  }
  return g
}

/**
 * Straight male header: `n` pins along X centred on cx, plastic on the board top,
 * gold pins sticking UP (style 'up') or DOWN through the board ('down').
 * Pin tips (for pin spheres) are returned by headerTips().
 */
export function header(n, { cx = 0, z = 0, top = PCB_T, style = 'up', pitch = PITCH, female = false } = {}) {
  const g = new THREE.Group()
  const len = n * pitch
  if (female) {
    g.add(box(len, 0.85, pitch, BLACK(), cx, top + 0.425, z))
    for (let i = 0; i < n; i++) g.add(box(0.1, 0.02, 0.1, mat(0x050505), cx - len / 2 + pitch * (i + 0.5), top + 0.86, z))
    return g
  }
  g.add(box(len, 0.25, pitch, BLACK(), cx, top + 0.125, z))
  for (let i = 0; i < n; i++) {
    const x = cx - len / 2 + pitch * (i + 0.5)
    if (style === 'up') g.add(box(0.064, 0.84, 0.064, GOLD(), x, top + 0.42 - 0.11, z))
    else g.add(box(0.064, 0.84, 0.064, GOLD(), x, top - 0.3, z))
  }
  return g
}
export function headerTips(names, { cx = 0, z = 0, top = PCB_T, style = 'up', pitch = PITCH, kinds = {}, labels = {}, stagger = true } = {}) {
  const n = names.length, len = n * pitch
  return names.map((name, i) => ({
    name, kind: kinds[name] ?? guessKind(name), label: labels[name] ?? name,
    x: cx - len / 2 + pitch * (i + 0.5), y: style === 'up' ? top + 0.73 : top - 0.72, z, r: 0.08,
    ldy: stagger && i % 2 ? 0.28 : 0,
  }))
}
export function guessKind(name) {
  if (/^(GND|G|VSS|V-|-|K|CATHODE)\d*$/i.test(name)) return 'gnd'
  if (/^(VCC|5V|3V3|3\.3V|VIN|VDD|V\+|\+|VS|V)\d*$/i.test(name)) return 'power'
  if (/^A\d+$|^AO$|^OUT$|^SIG$|^WIPER$|^W$/i.test(name)) return 'analog'
  return 'digital'
}

/**
 * DIP package (300 mil). Pin 1 is bottom-left with the notch toward −X; pins
 * 1…n/2 run along +Z side? No — real convention viewed from above: pin 1 at the
 * notch end on the lower row, counting anticlockwise. Here: rows along X, the
 * lower row at z = +DIP_ROW/2 holds 1…n/2 left → right, the upper row
 * (z = −DIP_ROW/2) holds n/2+1…n right → left. Legs end at y = 0.
 */
export function dip(n, { label = '', bodyColor = 0x222222, lift = 0.35 } = {}) {
  const g = new THREE.Group()
  const half = n / 2, len = half * PITCH
  const bodyH = 0.33
  g.add(box(len, bodyH, 0.64, mat(bodyColor, { rough: 0.8 }), 0, lift + bodyH / 2, 0))
  const notch = cyl(0.08, 0.02, mat(0x0a0a0a), { seg: 16 })
  g.add(at(notch, -len / 2 + 0.12, lift + bodyH + 0.005, 0))
  for (let i = 0; i < n; i++) {
    const { x, z } = dipPinXZ(n, i + 1)
    const sgn = z > 0 ? 1 : -1
    g.add(box(0.05, 0.03, 0.12, TIN(), x, lift + 0.12, sgn * 0.36))      // shoulder
    g.add(box(0.05, lift + 0.12, 0.025, TIN(), x, (lift + 0.12) / 2, z)) // leg down to y = 0
  }
  if (label) { const t = textPlane(label, len * 0.9, 0.28, { fg: '#d1d5db', bg: null }); if (t) { t.rotation.x = -Math.PI / 2; g.add(at(t, 0, lift + bodyH + 0.004, 0)) } }
  return g
}
export function dipPinXZ(n, pin) {
  const half = n / 2, x0 = -((half - 1) * PITCH) / 2
  return pin <= half ? { x: x0 + (pin - 1) * PITCH, z: DIP_ROW / 2 } : { x: x0 + (n - pin) * PITCH, z: -DIP_ROW / 2 }
}
/** Pin list for a DIP part: names[i] is pin i+1. Spheres at the leg feet (y = 0). */
export function dipPins(names, { kinds = {} } = {}) {
  const n = names.length
  return names.map((name, i) => {
    const { x, z } = dipPinXZ(n, i + 1)
    return { name, kind: kinds[name] ?? guessKind(name), x, y: 0.02, z: z + (z > 0 ? 0.06 : -0.06), r: 0.06, label: name, ldy: 0.25 + (i % 2) * 0.22 }
  })
}

/** Tinned wire lead between two points. */
export function lead(a, b, { r = 0.025, material } = {}) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b)
  const len = va.distanceTo(vb)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), material ?? TIN())
  m.position.copy(va).add(vb).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())
  return m
}

/** Text on a flat plane (canvas texture). Returns null where no DOM exists (tests). */
export function textPlane(text, w, h, { fg = '#ffffff', bg = '#000000', font = 'bold', px = 64 } = {}) {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  const aspect = w / h
  c.height = px; c.width = Math.max(16, Math.round(px * aspect))
  const ctx = c.getContext('2d')
  if (!ctx) return null
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height) }
  ctx.fillStyle = fg
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  let size = Math.floor(px * 0.8)
  ctx.font = `${font} ${size}px sans-serif`
  while (size > 8 && ctx.measureText(text).width > c.width * 0.94) { size -= 2; ctx.font = `${font} ${size}px sans-serif` }
  ctx.fillText(text, c.width / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: !bg }))
}

/** Make a mesh glow with `color` at 0…1 intensity (LEDs, bulbs, segments). */
export function setGlow(mesh, color, level) {
  if (!mesh?.material) return
  const m = mesh.material
  const L = Math.max(0, Math.min(1, level))
  m.emissive?.set(color)
  m.emissiveIntensity = L * 2.2
  if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity
}

// ── Resistor colour code ─────────────────────────────────────────────────────
export const BAND_COLORS = [0x111111, 0x7a4a1f, 0xd32f2f, 0xf57c00, 0xfbc02d, 0x388e3c, 0x1976d2, 0x7b1fa2, 0x757575, 0xf5f5f5]
const GOLD_BAND = 0xc9a227, SILVER_BAND = 0xb0b0b0
/** 4-band code for a resistance (2 significant digits + multiplier + 5 % gold). */
export function resistorBands(ohms) {
  if (!(ohms > 0)) return [0, 0, 0, GOLD_BAND].map((v, i) => (i < 3 ? BAND_COLORS[v] : v))
  let exp = Math.floor(Math.log10(ohms)) - 1
  let sig = Math.round(ohms / 10 ** exp)
  if (sig >= 100) { sig = Math.round(sig / 10); exp++ }
  const d1 = Math.floor(sig / 10), d2 = sig % 10
  const mult = exp >= 0 ? BAND_COLORS[Math.min(exp, 9)] : (exp === -1 ? GOLD_BAND : SILVER_BAND)
  return [BAND_COLORS[d1], BAND_COLORS[d2], mult, GOLD_BAND]
}

/** Engineering formatting: 4700 → "4.7 kΩ". */
export function fmtSI(v, unit) {
  if (!Number.isFinite(v)) return `— ${unit}`
  const a = Math.abs(v)
  const pre = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']]
  for (const [s, p] of pre) if (a >= s * 0.9995 || s === 1e-12) return `${+(v / s).toPrecision(3)} ${p}${unit}`
  return `${v} ${unit}`
}
