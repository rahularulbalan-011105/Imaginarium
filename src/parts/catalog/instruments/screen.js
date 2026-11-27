// Shared helpers for the instrument parts (NOT a part file): a flat screen mesh
// backed by a canvas texture (guarded for no DOM — tests run under Node), and
// meter-style number formatting.
import { Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace } from 'three'

/**
 * A w × h plane (XY, facing +Z) named `name`. Where a DOM canvas exists it
 * carries a CanvasTexture of pxW × pxH; otherwise a plain coloured material.
 */
export function screenMesh(name, w, h, { pxW = 256, pxH = 128, bg = '#9fb39a' } = {}) {
  let canvas = null, tex = null, material = null
  if (typeof document !== 'undefined') {
    try {
      canvas = document.createElement('canvas')
      canvas.width = pxW; canvas.height = pxH
      const ctx = canvas.getContext?.('2d')
      if (ctx) {
        ctx.fillStyle = bg; ctx.fillRect(0, 0, pxW, pxH)
        tex = new CanvasTexture(canvas); tex.colorSpace = SRGBColorSpace
        material = new MeshBasicMaterial({ map: tex })
      } else canvas = null
    } catch { canvas = null; tex = null }
  }
  const m = new Mesh(new PlaneGeometry(w, h), material ?? new MeshBasicMaterial({ color: bg }))
  m.name = name
  m.userData.canvas = canvas
  m.userData.tex = tex
  m.userData.bg = bg
  return m
}

/** Redraw a screen: fn(ctx, width, height). No-op without a canvas. */
export function drawScreen(mesh, fn) {
  const c = mesh?.userData?.canvas
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  fn(ctx, c.width, c.height)
  if (mesh.userData.tex) mesh.userData.tex.needsUpdate = true
}

/** Draw `text` big and centred (an LCD readout). Skips when unchanged. */
export function lcdText(mesh, text, { fg = '#111', bg, sub = '' } = {}) {
  if (!mesh?.userData?.canvas || mesh.userData.last === text + sub) return
  mesh.userData.last = text + sub
  drawScreen(mesh, (ctx, w, h) => {
    ctx.fillStyle = bg ?? mesh.userData.bg; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = fg; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    let size = Math.floor(h * 0.62)
    ctx.font = `bold ${size}px monospace`
    while (size > 8 && ctx.measureText(text).width > w * 0.92) { size -= 2; ctx.font = `bold ${size}px monospace` }
    ctx.fillText(text, w * 0.96, h * 0.45)
    if (sub) { ctx.font = `${Math.floor(h * 0.2)}px sans-serif`; ctx.textAlign = 'left'; ctx.fillText(sub, w * 0.04, h * 0.86) }
  })
}

const PRE = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']]
/** 4 significant digits with an SI prefix: 4700 → "4.700 kΩ", 0.008976 → "8.976 mA". */
export function fmt4(v, unit) {
  if (!Number.isFinite(v)) return `--- ${unit}`
  const a = Math.abs(v)
  if (a < 1e-12) return `0.000 ${unit}`
  for (const [s, p] of PRE) if (a >= s * 0.99995 || s === 1e-9) {
    const x = v / s, ax = Math.abs(x)
    const d = ax >= 100 ? 1 : ax >= 10 ? 2 : 3
    return `${x.toFixed(d)} ${p}${unit}`
  }
  return `${v} ${unit}`
}
