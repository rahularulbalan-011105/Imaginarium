import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// DamageNumbers — floating damage numbers, rendered as a lightweight DOM overlay.
//
// Kept OUT of the React HUD on purpose: numbers spawn many times per second
// (autocannon) and updating a Zustand store each frame would thrash React. Instead
// this owns its own absolutely-positioned layer and updates pooled <div>s
// imperatively, projecting each number's world anchor to screen every frame.
//
// Rapid hits on the same target within a short window AGGREGATE into one rising
// number (so sustained fire reads as one growing total, not a blizzard).
// ─────────────────────────────────────────────────────────────────────────────

const LIFE = 0.95          // seconds a number lives
const RISE = 2.4           // world-units it drifts up over its life
const MERGE_WINDOW = 0.22  // s — same-target hits merge into the live number

export class DamageNumbers {
  constructor() {
    this._layer = null
    this._items = []        // { anchor:Vector3, amount, crit, kind, born, el, byTarget }
    this._pool = []
    this._byTarget = new Map()
    this._v = new THREE.Vector3()
  }

  mount() {
    if (this._layer) return
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:95;overflow:hidden;font-family:ui-sans-serif,system-ui,sans-serif'
    document.body.appendChild(el)
    this._layer = el
  }

  // Spawn/merge a number. worldPos = Vector3-like anchor; kind: 'core'|'armor'|'burn'.
  add(targetId, worldPos, amount, { crit = false, kind = 'core' } = {}) {
    if (!this._layer || amount <= 0) return
    const now = performance.now() / 1000
    const live = this._byTarget.get(targetId)
    if (live && now - live.born < MERGE_WINDOW && !crit && !live.crit) {
      live.amount += amount
      live.born = now                                  // refresh so it keeps rising
      live.anchor.set(worldPos.x, worldPos.y, worldPos.z)
      return
    }
    const el = this._pool.pop() || this._makeEl()
    el.style.display = 'block'
    const item = {
      anchor: new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z),
      amount, crit, kind, born: now, el, targetId,
      jitterX: (Math.random() - 0.5) * 40,
    }
    this._items.push(item)
    this._byTarget.set(targetId, item)
  }

  _makeEl() {
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;transform:translate(-50%,-50%);font-weight:800;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.9);will-change:transform,opacity'
    this._layer.appendChild(el)
    return el
  }

  // Project + animate every number. Call each frame with the arena camera + canvas.
  update(camera, canvas) {
    if (!this._layer || !camera || !canvas) return
    const now = performance.now() / 1000
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    for (let i = this._items.length - 1; i >= 0; i--) {
      const it = this._items[i]
      const age = now - it.born
      const k = age / LIFE
      if (k >= 1) {
        it.el.style.display = 'none'
        this._pool.push(it.el)
        if (this._byTarget.get(it.targetId) === it) this._byTarget.delete(it.targetId)
        this._items.splice(i, 1)
        continue
      }
      this._v.copy(it.anchor); this._v.y += RISE * k
      this._v.project(camera)
      if (this._v.z > 1) { it.el.style.display = 'none'; continue }   // behind camera
      it.el.style.display = 'block'
      const sx = (this._v.x * 0.5 + 0.5) * w + it.jitterX
      const sy = (-this._v.y * 0.5 + 0.5) * h
      const pop = k < 0.15 ? 1 + (0.15 - k) * 2.5 : 1        // brief pop-in
      it.el.style.left = `${sx}px`
      it.el.style.top = `${sy}px`
      it.el.style.opacity = String(Math.max(0, 1 - Math.max(0, k - 0.55) / 0.45))
      const size = it.crit ? 26 : it.kind === 'burn' ? 13 : 16
      it.el.style.fontSize = `${size * pop}px`
      it.el.style.color = it.crit ? '#fde047' : it.kind === 'armor' ? '#7dd3fc' : it.kind === 'burn' ? '#fb923c' : '#fca5a5'
      it.el.textContent = it.crit ? `${Math.round(it.amount)}!` : `${Math.round(it.amount)}`
    }
  }

  clear() {
    for (const it of this._items) it.el.remove()
    for (const el of this._pool) el.remove()
    this._items = []; this._pool = []; this._byTarget.clear()
    if (this._layer) { this._layer.remove(); this._layer = null }
  }
}
