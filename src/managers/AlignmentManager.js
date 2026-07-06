import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// AlignmentManager — the Smart Alignment & Dynamic Guideline system (Phase 5).
//
// While an object is dragged with the Move gizmo it magnetically snaps into
// alignment with nearby objects (centers, edges, faces / stacking) and draws
// thin, semi-transparent, fading guide lines — like Canva / Figma / Fusion.
//
// Design principles:
//   • PRESENTATION + PLACEMENT ONLY. It nudges the dragged mesh's position
//     during the drag (exactly like the built-in grid snap) and draws guide
//     lines into a dedicated overlay group. It never touches physics, sim,
//     save/load, hierarchy, or any store — the caller (Viewport) reads the
//     snapped mesh.position and records history as it already does.
//   • Works on ANY object via world AABBs (Box3.setFromObject) — no per-type
//     code. Only the ground plane / wires / helpers are excluded by the caller.
//   • Cheap: other objects' boxes are cached once at drag start; each frame only
//     the dragged box is recomputed and compared against nearby cached boxes.
// ─────────────────────────────────────────────────────────────────────────────

const AXES = ['x', 'y', 'z']

const PIXEL_THRESHOLD = 7        // magnetic radius in screen pixels
const NEAR_RADIUS     = 16       // broad-phase: only consider objects this close
const MAX_OBJECTS     = 48       // hard cap on compared objects (perf)
const GUIDE_OPACITY   = 0.85
const FADE_LERP       = 0.30     // opacity easing per frame (fade in / out)
const SPAN_MARGIN     = 0.6      // guide-line overhang past the objects
const MM_PER_UNIT     = 50       // 1 scene unit = 50 mm (matches print bed)

const COLOR_LIGHT = 0x3b82f6
const COLOR_DARK  = 0x60a5fa

class AlignmentManager {
  constructor() {
    this.scene = null
    this.camera = null
    this.renderer = null
    this._group = null          // overlay group holding guide lines + labels
    this._active = false        // a drag is in progress
    this._others = []           // cached { id, min, max, center, half } for other objects
    this._lines = new Map()     // key → { line, mat, target, current, label, labelMat }
    this._raf = null
    this._color = COLOR_DARK
  }

  init(scene, camera, renderer) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    if (!this._group) {
      this._group = new THREE.Group()
      this._group.name = 'SmartGuides'
      this._group.userData.isGuide = true
      this._group.renderOrder = 999
      this._group.raycast = () => {}          // never selectable / pickable
    }
    if (this._group.parent !== scene) scene.add(this._group)
  }

  // ── Drag lifecycle ─────────────────────────────────────────────────────────

  // otherMeshes = every scene object EXCEPT the dragged one (caller filters out
  // wires / helpers / the ground plane).
  beginDrag(draggedMesh, otherMeshes) {
    if (!this.scene || !draggedMesh) return
    // Theme-aware guide colour (default dark).
    const theme = (typeof document !== 'undefined') ? document.documentElement.getAttribute('data-theme') : null
    this._color = theme === 'light' ? COLOR_LIGHT : COLOR_DARK

    this._others = []
    for (const m of otherMeshes) {
      if (!m) continue
      m.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(m)
      if (box.isEmpty()) continue
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      this._others.push({
        id: m.uuid,
        min: box.min.clone(), max: box.max.clone(), center,
        half: { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
      })
    }
    this._active = true
    this._startLoop()
  }

  endDrag() {
    this._active = false
    this._others = []
    // Fade every guide out; the loop removes them when invisible, then stops.
    for (const g of this._lines.values()) g.target = 0
  }

  // ── Per-frame snap + guide computation (called from onTransformChange) ──────
  // opts: { object, surface, axis }. `axis` is transformControls.axis (e.g.
  // 'X' | 'XY' | 'XYZ') so snapping is limited to the dragged axes. Mutates
  // draggedMesh.position in place.
  update(draggedMesh, opts = {}) {
    if (!this._active || !draggedMesh) return
    const wantObject  = opts.object !== false
    const wantSurface = opts.surface !== false
    if (!wantObject && !wantSurface) { this._deactivateAll(); return }

    // Restrict snapping to the axes actually being dragged, so an X-only drag
    // never nudges Y or Z. transformControls.axis is like 'X' | 'XY' | 'XYZ'.
    const axisStr = (opts.axis || '').toUpperCase()
    const allowed = new Set(axisStr
      ? AXES.filter(a => axisStr.includes(a.toUpperCase()))
      : AXES)
    if (allowed.size === 0) AXES.forEach(a => allowed.add(a))

    draggedMesh.updateMatrixWorld(true)
    let box = new THREE.Box3().setFromObject(draggedMesh)
    if (box.isEmpty()) { this._deactivateAll(); return }
    let dc = box.getCenter(new THREE.Vector3())
    const dsize = box.getSize(new THREE.Vector3())
    const dhalf = { x: dsize.x / 2, y: dsize.y / 2, z: dsize.z / 2 }

    const thr = this._worldThreshold(dc)

    // Best snap per axis: { delta, dist, value, type, ref }
    const best = { x: null, y: null, z: null }

    for (const o of this._others) {
      // Broad-phase proximity cull (only nearby objects).
      if (dc.distanceTo(o.center) > NEAR_RADIUS) continue
      for (const a of AXES) {
        if (!allowed.has(a)) continue
        const cands = []
        if (wantObject) {
          cands.push({ v: o.center[a], type: 'center',  target: o.center[a] })
          cands.push({ v: o.min[a],    type: 'edge',    target: o.min[a] + dhalf[a] })
          cands.push({ v: o.max[a],    type: 'edge',    target: o.max[a] - dhalf[a] })
        }
        if (wantSurface) {
          cands.push({ v: o.max[a], type: 'surface', target: o.max[a] + dhalf[a] })
          cands.push({ v: o.min[a], type: 'surface', target: o.min[a] - dhalf[a] })
        }
        for (const c of cands) {
          const delta = c.target - dc[a]
          const dist = Math.abs(delta)
          if (dist > thr) continue
          const cur = best[a]
          if (!cur || dist < cur.dist) best[a] = { delta, dist, value: c.v, type: c.type, ref: o }
        }
      }
    }

    // Apply the winning snaps (magnetic).
    let snapped = false
    for (const a of AXES) {
      if (best[a]) { draggedMesh.position[a] += best[a].delta; snapped = true }
    }

    if (!snapped) { this._deactivateAll(); return }

    // Recompute the dragged box AFTER snapping so guides sit on the final edges.
    draggedMesh.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(draggedMesh)
    dc = box.getCenter(new THREE.Vector3())
    const dmin = box.min, dmax = box.max

    // Build the active guide set from the winning snaps.
    const activeKeys = new Set()
    for (const a of AXES) {
      const b = best[a]
      if (!b) continue
      const o = b.ref
      const others = AXES.filter(x => x !== a)
      // Separation axis = the perpendicular axis with the biggest gap between
      // the two objects → the guide runs parallel to it (Figma-style).
      const sepA = Math.abs(dc[others[0]] - o.center[others[0]]) >= Math.abs(dc[others[1]] - o.center[others[1]])
        ? others[0] : others[1]
      const third = others[0] === sepA ? others[1] : others[0]

      const lo = Math.min(dmin[sepA], o.min[sepA]) - SPAN_MARGIN
      const hi = Math.max(dmax[sepA], o.max[sepA]) + SPAN_MARGIN
      const p1 = new THREE.Vector3(), p2 = new THREE.Vector3()
      p1[a] = b.value; p2[a] = b.value
      p1[third] = dc[third]; p2[third] = dc[third]
      p1[sepA] = lo; p2[sepA] = hi

      const key = `${a}:${b.type}:${o.id}`
      activeKeys.add(key)

      // Spacing label: edge-to-edge gap along the separation axis (Feature 7).
      const gap = Math.abs(dc[sepA] - o.center[sepA]) - (dhalf[sepA] + o.half[sepA])
      const labelText = gap > 0.05 ? `${Math.round(gap * MM_PER_UNIT)} mm` : null
      const labelPos = gap > 0.05
        ? new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5)
        : null

      this._upsertGuide(key, p1, p2, labelText, labelPos)
    }

    // Fade out any guide that's no longer active.
    for (const [key, g] of this._lines) if (!activeKeys.has(key)) g.target = 0
  }

  // ── Guide line pool ─────────────────────────────────────────────────────────

  _upsertGuide(key, p1, p2, labelText, labelPos) {
    let g = this._lines.get(key)
    if (!g) {
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2])
      const mat = new THREE.LineBasicMaterial({
        color: this._color, transparent: true, opacity: 0, depthTest: false, fog: false,
      })
      const line = new THREE.Line(geo, mat)
      line.renderOrder = 1000
      line.raycast = () => {}
      this._group.add(line)
      g = { line, mat, target: GUIDE_OPACITY, current: 0, label: null, labelMat: null }
      this._lines.set(key, g)
    } else {
      const pos = g.line.geometry.attributes.position
      pos.setXYZ(0, p1.x, p1.y, p1.z)
      pos.setXYZ(1, p2.x, p2.y, p2.z)
      pos.needsUpdate = true
      g.mat.color.setHex(this._color)
      g.target = GUIDE_OPACITY
    }
    this._updateLabel(g, labelText, labelPos)
  }

  _updateLabel(g, text, pos) {
    if (!text || !pos) {
      if (g.label) { g.label.visible = false }
      return
    }
    if (!g.label) {
      const sprite = this._makeLabelSprite(text)
      g.label = sprite
      g.labelText = text
      this._group.add(sprite)
    } else if (g.labelText !== text) {
      // Rebuild the texture only when the number changes.
      g.label.material.map?.dispose()
      const s = this._makeLabelSprite(text)
      g.label.material.map = s.material.map
      g.label.scale.copy(s.scale)
      g.labelText = text
      s.material.dispose()
    }
    g.label.visible = true
    g.label.position.copy(pos)
  }

  _makeLabelSprite(text) {
    const W = 96, H = 30, S = 2
    const canvas = document.createElement('canvas')
    canvas.width = W * S; canvas.height = H * S
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgba(15,23,42,0.9)'
    const r = 6 * S, w = W * S, h = H * S
    ctx.beginPath()
    ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r)
    ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r)
    ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r)
    ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#' + new THREE.Color(this._color).getHexString()
    ctx.font = `bold ${13 * S}px 'Courier New', monospace`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2)
    const tex = new THREE.CanvasTexture(canvas)
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
    }))
    sprite.scale.set(1.6, 0.5, 1)
    sprite.renderOrder = 1001
    return sprite
  }

  _deactivateAll() {
    for (const g of this._lines.values()) g.target = 0
  }

  _worldThreshold(center) {
    const cam = this.camera
    if (!cam) return 0.3
    const dist = cam.position.distanceTo(center)
    let h = 800
    try { const v = new THREE.Vector2(); this.renderer?.getSize(v); if (v.y) h = v.y } catch (_) { /* */ }
    const worldPerPx = (2 * Math.tan((cam.fov * Math.PI / 180) / 2) * dist) / h
    return Math.min(2.0, Math.max(0.05, PIXEL_THRESHOLD * worldPerPx))
  }

  // ── Self-contained fade loop (independent of the render loop) ───────────────
  _startLoop() {
    if (this._raf) return
    const step = () => {
      let anyVisible = false
      for (const [key, g] of this._lines) {
        g.current += (g.target - g.current) * FADE_LERP
        if (g.target === 0 && g.current < 0.02) {
          // Remove fully-faded guides.
          this._group.remove(g.line)
          g.line.geometry.dispose(); g.mat.dispose()
          if (g.label) { this._group.remove(g.label); g.label.material.map?.dispose(); g.label.material.dispose() }
          this._lines.delete(key)
          continue
        }
        g.mat.opacity = g.current
        if (g.label) g.label.material.opacity = g.current * 1.1
        anyVisible = true
      }
      if (this._active || anyVisible) {
        this._raf = requestAnimationFrame(step)
      } else {
        this._raf = null
      }
    }
    this._raf = requestAnimationFrame(step)
  }

  dispose() {
    this._active = false
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null }
    for (const g of this._lines.values()) {
      this._group?.remove(g.line); g.line.geometry.dispose(); g.mat.dispose()
      if (g.label) { this._group?.remove(g.label); g.label.material.map?.dispose(); g.label.material.dispose() }
    }
    this._lines.clear()
    this._others = []
  }
}

export const alignmentManager = new AlignmentManager()
