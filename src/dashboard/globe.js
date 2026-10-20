// ─────────────────────────────────────────────────────────────────────────────
// The visitor globe: an orthographic Earth on a 2D canvas, with one dot per
// place people came from.
//
// Deliberately dependency-free — no three.js, no map tiles, no external service.
// The land outlines are inlined (world-land.js), so the dashboard draws the same
// whether it is online or not, and nothing about where our visitors are is sent
// to a map provider.
//
// Projection: orthographic. A point at (lat, lon) is rotated by the globe's
// current spin and tilt, then dropped onto the screen; anything with a negative
// z faces away from the camera and is culled.
// ─────────────────────────────────────────────────────────────────────────────
import { LAND_RINGS } from './world-land.js'

const RAD = Math.PI / 180

export function createGlobe(canvas, { onHover } = {}) {
  const ctx = canvas.getContext('2d')
  let places = []
  let spin = -20 * RAD      // longitude at the centre
  let tilt = 18 * RAD       // latitude at the centre
  let autoSpin = true
  let dragging = null
  let hoverKey = null
  let raf = 0
  let hidpi = 1
  let W = 0, H = 0, R = 0, CX = 0, CY = 0
  let maxVisitors = 1

  const css = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  }

  function resize() {
    const rect = canvas.getBoundingClientRect()
    hidpi = Math.min(2, window.devicePixelRatio || 1)
    W = Math.max(200, rect.width); H = Math.max(200, rect.height)
    canvas.width = Math.round(W * hidpi); canvas.height = Math.round(H * hidpi)
    ctx.setTransform(hidpi, 0, 0, hidpi, 0, 0)
    R = Math.min(W, H) / 2 - 12
    CX = W / 2; CY = H / 2
  }

  // (lat, lon) → screen point + visibility
  function project(lat, lon) {
    const la = lat * RAD, lo = lon * RAD + spin
    const cosLa = Math.cos(la)
    const x = cosLa * Math.sin(lo)
    const y = Math.sin(la)
    const z = cosLa * Math.cos(lo)
    // tilt about the screen X axis
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt)
    const z2 = y * Math.sin(tilt) + z * Math.cos(tilt)
    return { x: CX + x * R, y: CY - y2 * R, visible: z2 > 0, z: z2 }
  }

  function drawSphere() {
    const g = ctx.createRadialGradient(CX - R * 0.35, CY - R * 0.4, R * 0.1, CX, CY, R)
    g.addColorStop(0, '#13243d')
    g.addColorStop(1, '#070d18')
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2)
    ctx.fillStyle = g; ctx.fill()
    ctx.strokeStyle = 'rgba(120,160,220,0.35)'; ctx.lineWidth = 1; ctx.stroke()
  }

  function drawGraticule() {
    ctx.strokeStyle = 'rgba(120,160,220,0.13)'
    ctx.lineWidth = 1
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath()
      let started = false
      for (let lon = -180; lon <= 180; lon += 4) {
        const p = project(lat, lon)
        if (!p.visible) { started = false; continue }
        if (started) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); started = true }
      }
      ctx.stroke()
    }
    for (let lon = -180; lon < 180; lon += 30) {
      ctx.beginPath()
      let started = false
      for (let lat = -90; lat <= 90; lat += 4) {
        const p = project(lat, lon)
        if (!p.visible) { started = false; continue }
        if (started) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); started = true }
      }
      ctx.stroke()
    }
  }

  // A point that faces away from the camera is pulled onto the limb instead of
  // being dropped: a ring that straddles the horizon then closes ALONG the edge
  // of the disc. Dropping those points instead leaves an open path whose fill
  // cuts a straight chord across the globe (a dark slash over the ocean).
  function projectClamped(lat, lon) {
    const p = project(lat, lon)
    if (p.visible) return p
    const dx = p.x - CX, dy = p.y - CY
    const d = Math.hypot(dx, dy) || 1
    return { x: CX + (dx / d) * R, y: CY + (dy / d) * R, visible: false }
  }

  function drawLand() {
    ctx.save()
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.clip()
    ctx.fillStyle = 'rgba(86,132,96,0.85)'
    ctx.strokeStyle = 'rgba(150,200,160,0.55)'
    ctx.lineWidth = 0.7
    for (const ring of LAND_RINGS) {
      // Rings are flat [lon, lat, lon, lat, …].
      let anyVisible = false
      ctx.beginPath()
      for (let i = 0; i < ring.length; i += 2) {
        const p = projectClamped(ring[i + 1], ring[i])
        anyVisible = anyVisible || p.visible
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
      }
      if (!anyVisible) continue          // entirely on the far side
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  function dotRadius(visitors) {
    // Area ∝ visitors, so a dot twice as wide really is four times the traffic.
    const t = Math.sqrt(visitors / maxVisitors)
    return 3 + 9 * t
  }

  function drawPlaces() {
    for (const p of places) {
      if (p.lat == null) continue
      const s = project(p.lat, p.lon)
      if (!s.visible) continue
      const r = dotRadius(p.visitors)
      const hot = p.key === hoverKey
      const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.6)
      halo.addColorStop(0, 'rgba(249,115,22,0.42)')
      halo.addColorStop(1, 'rgba(249,115,22,0)')
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.6, 0, Math.PI * 2); ctx.fillStyle = halo; ctx.fill()
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.fillStyle = hot ? '#fff7ed' : '#f97316'
      ctx.fill()
      ctx.lineWidth = hot ? 2 : 1
      ctx.strokeStyle = hot ? '#fb923c' : 'rgba(255,255,255,0.75)'
      ctx.stroke()
      p._screen = s
      p._r = r
    }
  }

  function frame() {
    raf = 0
    ctx.clearRect(0, 0, W, H)
    drawSphere()
    drawGraticule()
    drawLand()
    drawPlaces()
    if (!places.some(p => p.lat != null)) {
      ctx.fillStyle = 'rgba(226,232,240,0.75)'
      ctx.font = '13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No located visits in this period yet', CX, CY + R + 2)
    }
    if (autoSpin && !dragging) spin += 0.0016
    schedule()
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(frame)
  }

  // ── interaction: drag to spin, hover for a tooltip ────────────────────────
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, spin, tilt }
    canvas.setPointerCapture(e.pointerId)
    canvas.style.cursor = 'grabbing'
  })
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      spin = dragging.spin + (e.clientX - dragging.x) * 0.006
      tilt = Math.max(-1.2, Math.min(1.2, dragging.tilt + (e.clientY - dragging.y) * 0.006))
      schedule()
      return
    }
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    let best = null, bestD = Infinity
    for (const p of places) {
      const s = p._screen
      if (!s || !s.visible) continue
      const d = Math.hypot(s.x - mx, s.y - my)
      if (d < Math.max(10, p._r + 6) && d < bestD) { best = p; bestD = d }
    }
    const key = best ? best.key : null
    if (key !== hoverKey) { hoverKey = key; schedule() }
    canvas.style.cursor = best ? 'pointer' : 'grab'
    onHover?.(best, { x: mx, y: my })
  })
  const end = (e) => {
    if (!dragging) return
    dragging = null
    canvas.style.cursor = 'grab'
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerleave', () => { hoverKey = null; onHover?.(null); schedule() })

  const ro = new ResizeObserver(() => { resize(); schedule() })
  ro.observe(canvas)
  resize()
  schedule()

  return {
    /** Swap in a new period's places (from analyze().places). */
    setPlaces(next) {
      places = (next || []).filter(p => p.lat != null)
      maxVisitors = Math.max(1, ...places.map(p => p.visitors))
      schedule()
    },
    /** Spin the globe to face a place (clicking a row in the table). */
    focus(place) {
      if (!place || place.lat == null) return
      autoSpin = false
      spin = -place.lon * RAD
      tilt = place.lat * RAD
      hoverKey = place.key
      schedule()
    },
    setAutoSpin(on) { autoSpin = !!on; schedule() },
    isAutoSpin() { return autoSpin },
    destroy() { ro.disconnect(); if (raf) cancelAnimationFrame(raf); raf = 0 },
    _css: css,
  }
}
