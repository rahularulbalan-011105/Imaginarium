import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// HitEffects — pooled, capped 3D combat VFX primitives for the arena.
//
// Pure presentation building blocks; WHAT to show for a given combat event is
// decided by CombatEffectsManager / RobotDamageView. Everything here is pooled
// and hard-capped, lives a short time and cleans itself up:
//   sparks  – one InstancedMesh (additive streaks, stretched along velocity)
//   debris  – one InstancedMesh (tumbling metal fragments, bounce on the floor)
//   smoke   – small pool of soft puffs (need per-puff opacity)
//   flashes – brief additive impact flashes
//   rings   – ground shockwave rings (blasts)
//   decals  – scorch / dent marks stuck to a robot part (runtime only)
// All objects are tagged userData.isArena and never raycast.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SPARKS = 320
const MAX_DEBRIS = 120
const MAX_SMOKE = 44
const MAX_FLASH = 14
const MAX_RINGS = 4
const FLOOR_Y = 0.05
const GRAVITY = 42           // su/s² for sparks — light, so they read at arena scale
const DEBRIS_GRAVITY = 85    // fragments fall heavier (the physics world itself is ~196)

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _v = new THREE.Vector3()
const _c = new THREE.Color()
const _Z = new THREE.Vector3(0, 0, 1)
const _ZERO = new THREE.Matrix4().makeScale(0, 0, 0)
const noRaycast = () => {}

export class HitEffects {
  constructor() {
    this._scene = null
    this._sparks = null; this._sparkData = []; this._sparkLive = 0
    this._debris = null; this._debrisData = []; this._debrisLive = 0
    this._smoke = []; this._smokeLive = []
    this._flashPool = []; this._flashes = []
    this._ringPool = []; this._rings = []
    this._decalPool = []
    this._decalGeo = null
  }

  configure(scene) {
    this._scene = scene
    if (this._sparks) return this
    // Sparks: unit box stretched into a streak per instance.
    this._sparks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      MAX_SPARKS,
    )
    this._debris = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.6, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.4 }),
      MAX_DEBRIS,
    )
    for (const im of [this._sparks, this._debris]) {
      im.userData.isArena = true
      im.frustumCulled = false
      im.raycast = noRaycast
      im.count = 0
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      scene.add(im)
    }
    this._debris.castShadow = true
    for (let i = 0; i < MAX_SPARKS; i++) {
      this._sparkData.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, w: 0.05, len: 0.4, r: 1, g: 1, b: 1, grav: 1, drag: 1 })
      this._sparks.setColorAt(i, _c.setRGB(0, 0, 0))
    }
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this._debrisData.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, max: 1, size: 0.2 })
      this._debris.setColorAt(i, _c.setRGB(0.2, 0.2, 0.22))
    }
    return this
  }

  // ── Emitters ────────────────────────────────────────────────────────────────

  // Spark spray around `normal` (unit). Streaks inherit `bias` (e.g. a ricochet
  // direction) and fade fast. color = hot metal by default.
  sparks(pos, normal, { count = 8, speed = 12, spread = 0.7, color = 0xffb648, life = 0.3, size = 0.04, bias = null, grav = 1, drag = 2.4 } = {}) {
    _c.setHex(color)
    for (let i = 0; i < count; i++) {
      if (this._sparkLive >= MAX_SPARKS) return
      const p = this._sparkData[this._sparkLive++]
      p.pos.copy(pos)
      p.vel.set(rand(1), rand(1), rand(1)).multiplyScalar(spread).add(normal)
      if (bias) p.vel.addScaledVector(bias, 0.6)
      p.vel.normalize().multiplyScalar(speed * (0.45 + Math.random() * 0.75))
      p.life = p.max = life * (0.6 + Math.random() * 0.7)
      p.w = size * (0.7 + Math.random() * 0.6)
      p.len = 0.085
      p.r = _c.r; p.g = _c.g; p.b = _c.b
      p.grav = grav; p.drag = drag
    }
  }

  // Tumbling fragments thrown along `dir` (unit), bouncing on the arena floor.
  debris(pos, dir, { count = 3, speed = 8, spread = 0.6, size = 0.16, color = 0x3a3f47, life = 1.1, up = 7 } = {}) {
    _c.setHex(color)
    for (let i = 0; i < count; i++) {
      if (this._debrisLive >= MAX_DEBRIS) return
      const idx = this._debrisLive++
      const p = this._debrisData[idx]
      p.pos.copy(pos)
      p.vel.set(rand(1), rand(1), rand(1)).multiplyScalar(spread).add(dir).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.8))
      p.vel.y += up * (0.4 + Math.random() * 0.8)
      p.rot.set(rand(3), rand(3), rand(3))
      p.spin.set(rand(14), rand(14), rand(14))
      p.life = p.max = life * (0.7 + Math.random() * 0.6)
      p.size = size * (0.6 + Math.random() * 0.9)
      const shade = 0.75 + Math.random() * 0.5
      this._debris.setColorAt(idx, _cTmp.setRGB(_c.r * shade, _c.g * shade, _c.b * shade))
    }
    if (this._debris.instanceColor) this._debris.instanceColor.needsUpdate = true
  }

  smoke(pos, { size = 0.6, rise = 1.4, life = 0.9, color = 0x8a8e96, opacity = 0.34, vel = null, grow = 2.4 } = {}) {
    let p
    if (this._smokeLive.length >= MAX_SMOKE) p = this._smokeLive.shift()      // recycle the oldest puff
    else {
      let mesh = this._smoke.pop()
      if (!mesh) {
        mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._softTexture(), color: 0x8a8e96, transparent: true, opacity: 0.4, depthWrite: false }))
        mesh.userData.isArena = true; mesh.raycast = noRaycast
        this._scene.add(mesh)
      }
      p = { mesh, vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 2, op: 0.4 }
    }
    p.mesh.position.copy(pos)
    p.vel.set(rand(0.5), rise, rand(0.5))
    if (vel) p.vel.add(vel)
    p.life = p.max = life * (0.8 + Math.random() * 0.4)
    // the soft sprite falls off to nothing at its rim, so it needs more body than a flat puff
    opacity = Math.min(0.95, opacity * 1.9)
    p.size = size; p.grow = grow; p.op = opacity
    p.mesh.material.color.setHex(color)
    p.mesh.material.opacity = opacity
    p.mesh.material.rotation = Math.random() * Math.PI * 2
    p.mesh.scale.setScalar(size * 2.2)
    p.mesh.visible = true
    this._smokeLive.push(p)
  }

  // Very short additive flash at an impact point.
  flash(pos, { size = 0.5, color = 0xffe2b0, life = 0.07 } = {}) {
    if (this._flashes.length >= MAX_FLASH) return
    let mesh = this._flashPool.pop()
    if (!mesh) {
      mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._softTexture(), color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }))
      mesh.userData.isArena = true; mesh.raycast = noRaycast
      this._scene.add(mesh)
    }
    mesh.position.copy(pos)
    mesh.material.color.setHex(color)
    mesh.visible = true
    this._flashes.push({ mesh, t: 0, life, size })
  }

  // Expanding shockwave ring on the ground (blasts only).
  ring(pos, { radius = 6, color = 0xffc27a, life = 0.35 } = {}) {
    if (this._rings.length >= MAX_RINGS) return
    let mesh = this._ringPool.pop()
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      )
      mesh.userData.isArena = true; mesh.raycast = noRaycast
      this._scene.add(mesh)
    }
    mesh.position.set(pos.x, FLOOR_Y + 0.04, pos.z)
    mesh.material.color.setHex(color)
    mesh.visible = true
    this._rings.push({ mesh, t: 0, life, radius })
  }

  // Impact mark stuck to `host` (a robot part's root mesh) exactly at a world
  // point, lying ON the surface: its plane is oriented by the surface normal and
  // lifted a hair off it (plus polygon offset) so it never z-fights or floats.
  // `type` picks the look (see MARKS); all marks of a type share ONE material.
  // Returns the decal; give it back with releaseDecal().
  decal(host, worldPos, normal, { type = 'bullet', size = 0.3 } = {}) {
    let d = this._decalPool.pop()
    if (!d) {
      d = new THREE.Mesh(this._decalGeo || (this._decalGeo = new THREE.PlaneGeometry(1, 1)), this._markMaterial(type))
      d.userData.isArena = true; d.userData.isCombatDecal = true
      d.raycast = noRaycast
      d.matrixAutoUpdate = false
    }
    d.material = this._markMaterial(type)
    d.userData.markType = type
    // Broad worn patches sit under the individual hits; glow sits on top.
    d.renderOrder = type === 'wear' || type === 'scorch' || type === 'soot' ? 1 : type === 'hot' ? 3 : 2
    const lift = type === 'wear' || type === 'scorch' || type === 'soot' ? 0.008 : type === 'hot' ? 0.02 : 0.014
    // World pose → host-local matrix (host may be non-uniformly scaled).
    _q.setFromUnitVectors(_Z, normal)
    _q.multiply(_qRoll.setFromAxisAngle(_Z, Math.random() * Math.PI * 2))
    _m.compose(_v.copy(worldPos).addScaledVector(normal, lift), _q, _s.set(size, size, size))
    host.updateWorldMatrix(true, false)
    d.matrix.copy(host.matrixWorld).invert().multiply(_m)
    d.matrixWorldNeedsUpdate = true
    host.add(d)
    return d
  }

  releaseDecal(d) {
    d.removeFromParent()
    this._decalPool.push(d)
  }

  // Soft round falloff shared by smoke + flash sprites.
  _softTexture() {
    if (this._softTex) return this._softTex
    const n = 64, cv = document.createElement('canvas')
    cv.width = cv.height = n
    const g = cv.getContext('2d')
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)')
    grad.addColorStop(0.65, 'rgba(255,255,255,0.18)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, n, n)
    this._softTex = new THREE.CanvasTexture(cv)
    return this._softTex
  }

  // One shared material per mark type (never one per hit).
  _markMaterial(type) {
    if (!this._markMats) this._markMats = {}
    let m = this._markMats[type]
    if (!m) {
      const draw = MARKS[type] || MARKS.bullet
      const n = 128, cv = document.createElement('canvas')
      cv.width = cv.height = n
      draw(cv.getContext('2d'), n)
      const tex = new THREE.CanvasTexture(cv)
      tex.colorSpace = THREE.SRGBColorSpace
      m = this._markMats[type] = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        blending: type === 'hot' ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    }
    return m
  }

  // ── Per-frame ───────────────────────────────────────────────────────────────
  step(dt) {
    // Sparks.
    let n = this._sparkLive
    for (let i = 0; i < n; i++) {
      const p = this._sparkData[i]
      p.life -= dt
      if (p.life <= 0 || p.pos.y < 0) {
        // swap-remove
        const last = this._sparkData[--n]
        this._sparkData[n] = p; this._sparkData[i] = last
        i--
        continue
      }
      p.vel.y -= GRAVITY * p.grav * dt
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt))
      p.pos.addScaledVector(p.vel, dt)
      const speed = p.vel.length()
      if (speed > 1e-3) _q.setFromUnitVectors(_Z, _v.copy(p.vel).divideScalar(speed))
      const k = p.life / p.max
      _m.compose(p.pos, _q, _s.set(p.w, p.w, Math.max(p.w, speed * p.len)))
      this._sparks.setMatrixAt(i, _m)
      this._sparks.setColorAt(i, _c.setRGB(p.r * k, p.g * k, p.b * k))
    }
    this._sparkLive = n
    this._sparks.count = n
    if (n) { this._sparks.instanceMatrix.needsUpdate = true; this._sparks.instanceColor.needsUpdate = true }

    // Debris.
    n = this._debrisLive
    let colorDirty = false
    for (let i = 0; i < n; i++) {
      const p = this._debrisData[i]
      p.life -= dt
      if (p.life <= 0) {
        const lastIdx = --n, last = this._debrisData[lastIdx]
        this._debrisData[lastIdx] = p; this._debrisData[i] = last
        if (lastIdx !== i) { this._debris.getColorAt(lastIdx, _c); this._debris.setColorAt(i, _c); colorDirty = true }
        i--
        continue
      }
      p.vel.y -= DEBRIS_GRAVITY * dt
      p.pos.addScaledVector(p.vel, dt)
      if (p.pos.y < FLOOR_Y + p.size * 0.3 && p.vel.y < 0) {
        p.pos.y = FLOOR_Y + p.size * 0.3
        p.vel.y *= -0.32; p.vel.x *= 0.6; p.vel.z *= 0.6
        p.spin.multiplyScalar(0.5)
        if (Math.abs(p.vel.y) < 1) p.vel.y = 0
      }
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt
      const k = Math.min(1, p.life / (p.max * 0.25))            // shrink out at the end
      _m.compose(p.pos, _q.setFromEuler(p.rot), _s.setScalar(p.size * k))
      this._debris.setMatrixAt(i, _m)
    }
    this._debrisLive = n
    this._debris.count = n
    if (n) this._debris.instanceMatrix.needsUpdate = true
    if (colorDirty && this._debris.instanceColor) this._debris.instanceColor.needsUpdate = true

    // Smoke.
    for (let i = this._smokeLive.length - 1; i >= 0; i--) {
      const p = this._smokeLive[i]
      p.life -= dt
      if (p.life <= 0) { p.mesh.visible = false; this._smoke.push(p.mesh); this._smokeLive.splice(i, 1); continue }
      const k = p.life / p.max
      p.vel.multiplyScalar(Math.max(0, 1 - 1.2 * dt))
      p.mesh.position.addScaledVector(p.vel, dt)
      p.mesh.scale.setScalar(p.size * 2.2 * (1 + (1 - k) * p.grow))
      p.mesh.material.opacity = p.op * k
    }

    // Flashes.
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i]
      f.t += dt
      const k = f.t / f.life
      if (k >= 1) { f.mesh.visible = false; this._flashPool.push(f.mesh); this._flashes.splice(i, 1); continue }
      f.mesh.scale.setScalar(f.size * 2.6 * (0.6 + k * 0.6))
      f.mesh.material.opacity = 1 - k
    }

    // Rings.
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const r = this._rings[i]
      r.t += dt
      const k = r.t / r.life
      if (k >= 1) { r.mesh.visible = false; this._ringPool.push(r.mesh); this._rings.splice(i, 1); continue }
      r.mesh.scale.setScalar(r.radius * (0.15 + 0.85 * (1 - (1 - k) * (1 - k))))
      r.mesh.material.opacity = 0.55 * (1 - k)
    }
  }

  // Live object counts (dev/debug + tests).
  stats() {
    return { sparks: this._sparkLive, debris: this._debrisLive, smoke: this._smokeLive.length, flashes: this._flashes.length, rings: this._rings.length }
  }

  clear() {
    const drop = (m, geo = false) => { if (geo) m.geometry?.dispose(); m.material?.dispose?.(); m.removeFromParent() }
    for (const im of [this._sparks, this._debris]) if (im) { im.geometry.dispose(); im.material.dispose(); im.removeFromParent(); im.dispose?.() }
    this._sparks = this._debris = null
    this._sparkData = []; this._debrisData = []; this._sparkLive = this._debrisLive = 0
    for (const p of this._smokeLive) drop(p.mesh)
    for (const m of this._smoke) drop(m)
    for (const f of this._flashes) drop(f.mesh)
    for (const m of this._flashPool) drop(m)
    for (const r of this._rings) drop(r.mesh, true)
    for (const m of this._ringPool) drop(m, true)
    for (const d of this._decalPool) d.removeFromParent()
    for (const m of Object.values(this._markMats || {})) { m.map?.dispose(); m.dispose() }
    this._markMats = null
    this._decalGeo?.dispose(); this._softTex?.dispose()
    this._decalGeo = this._softTex = null
    this._smoke = []; this._smokeLive = []; this._flashes = []; this._flashPool = []
    this._rings = []; this._ringPool = []; this._decalPool = []
  }
}

// ── Impact mark painters (canvas → shared texture per type) ───────────────────
// Each reads on BOTH light and dark hulls: a dark pit/soot plus a bright
// bare-metal or glowing element.
function rng(seed) { let x = seed; return () => { x = (x * 16807) % 2147483647; return (x & 0xffff) / 0xffff } }
function blob(g, x, y, r, fill) { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
function haze(g, n, r0, r1, rgb, a0) {
  const gr = g.createRadialGradient(n / 2, n / 2, r0 * n, n / 2, n / 2, r1 * n)
  gr.addColorStop(0, `rgba(${rgb},${a0})`); gr.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = gr; g.fillRect(0, 0, n, n)
}
const MARKS = {
  // Bullet strike: a punched hole with a ragged lip of bare metal where the
  // paint chipped, and a faint powder burn around it.
  bullet(g, n) {
    const r = rng(7), c = n / 2
    haze(g, n, 0.1, 0.5, '6,6,8', 0.6)
    // ragged chipped lip: uneven grey arcs, not a full ring
    for (let i = 0; i < 9; i++) {
      const a0 = r() * Math.PI * 2, len = 0.35 + r() * 0.7, rad = n * (0.17 + r() * 0.035)
      const v = 135 + r() * 70 | 0
      g.strokeStyle = `rgba(${v},${v + 4},${v + 10},${0.55 + r() * 0.35})`
      g.lineWidth = n * (0.018 + r() * 0.03)
      g.beginPath(); g.arc(c + (r() - 0.5) * n * 0.02, c + (r() - 0.5) * n * 0.02, rad, a0, a0 + len); g.stroke()
    }
    for (let i = 0; i < 6; i++) {                         // a few flakes thrown outward
      const a = r() * Math.PI * 2, d = n * (0.24 + r() * 0.1), v = 120 + r() * 60 | 0
      blob(g, c + Math.cos(a) * d, c + Math.sin(a) * d, n * (0.012 + r() * 0.018), `rgba(${v},${v},${v + 8},0.7)`)
    }
    blob(g, c, c, n * 0.15, 'rgba(0,0,0,1)')              // the hole
    blob(g, c - n * 0.035, c - n * 0.03, n * 0.045, 'rgba(30,31,36,1)')
  },
  // Blast scorch: broad irregular char with radial streaks.
  scorch(g, n) {
    const r = rng(19), c = n / 2
    haze(g, n, 0.02, 0.5, '6,6,7', 0.9)
    g.strokeStyle = 'rgba(4,4,5,0.5)'
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, l = n * (0.25 + r() * 0.23)
      g.lineWidth = n * (0.01 + r() * 0.025)
      g.beginPath(); g.moveTo(c + Math.cos(a) * n * 0.08, c + Math.sin(a) * n * 0.08); g.lineTo(c + Math.cos(a) * l, c + Math.sin(a) * l); g.stroke()
    }
    for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, d = n * (0.1 + r() * 0.2); blob(g, c + Math.cos(a) * d, c + Math.sin(a) * d, n * 0.02, 'rgba(190,120,60,0.55)') }
  },
  // Dent from a heavy blow: a shadowed hollow with a worn rim and scrapes.
  dent(g, n) {
    const r = rng(31), c = n / 2
    haze(g, n, 0.0, 0.46, '8,8,10', 0.72)
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = n * 0.05
    g.beginPath(); g.arc(c, c, n * 0.33, Math.PI * 0.05, Math.PI * 1.1); g.stroke()
    g.strokeStyle = 'rgba(170,175,184,0.6)'; g.lineWidth = n * 0.02
    g.beginPath(); g.arc(c, c, n * 0.345, Math.PI * 1.2, Math.PI * 1.85); g.stroke()
    for (let i = 0; i < 9; i++) {
      const v = 120 + r() * 70 | 0
      g.strokeStyle = `rgba(${v},${v + 3},${v + 8},${0.35 + r() * 0.35})`
      g.lineWidth = n * (0.006 + r() * 0.01)
      const y = c + (r() - 0.5) * n * 0.5, x0 = c - n * (0.1 + r() * 0.25)
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + n * (0.15 + r() * 0.3), y + (r() - 0.5) * n * 0.08); g.stroke()
    }
  },
  // Flame soot: soft brown-black staining.
  soot(g, n) {
    const r = rng(43), c = n / 2
    haze(g, n, 0.0, 0.5, '18,11,7', 0.55)
    for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, d = n * r() * 0.3; blob(g, c + Math.cos(a) * d, c + Math.sin(a) * d, n * (0.03 + r() * 0.06), 'rgba(8,5,3,0.22)') }
  },
  // Worn-down patch where several rounds landed: paint scoured off to dull
  // metal, pitted, with stress cracks.
  wear(g, n) {
    const r = rng(57), c = n / 2
    haze(g, n, 0.0, 0.5, '10,10,12', 0.78)
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2, d = n * Math.sqrt(r()) * 0.38, light = r() < 0.4
      const v = 95 + r() * 60 | 0
      blob(g, c + Math.cos(a) * d, c + Math.sin(a) * d, n * (0.008 + r() * 0.02), light ? `rgba(${v},${v + 3},${v + 9},0.55)` : 'rgba(0,0,0,0.75)')
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)'
    for (let i = 0; i < 7; i++) {                        // stress cracks
      let x = c + (r() - 0.5) * n * 0.2, y = c + (r() - 0.5) * n * 0.2, a = r() * Math.PI * 2
      g.lineWidth = n * 0.011; g.beginPath(); g.moveTo(x, y)
      for (let k = 0; k < 5; k++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * n * 0.075; y += Math.sin(a) * n * 0.075; g.lineTo(x, y) }
      g.stroke()
    }
  },
  // Torn-off mounting point: a scorched socket ringed by ripped, dull metal.
  torn(g, n) {
    const r = rng(71), c = n / 2
    haze(g, n, 0.05, 0.5, '6,6,8', 0.85)
    g.fillStyle = 'rgba(128,132,142,0.92)'
    g.beginPath()
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2, d = n * (i % 2 ? 0.19 + r() * 0.04 : 0.25 + r() * 0.1)
      g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * d, c + Math.sin(a) * d)
    }
    g.closePath(); g.fill()
    g.strokeStyle = 'rgba(200,204,212,0.55)'; g.lineWidth = n * 0.012
    for (let i = 0; i < 8; i++) { const a = r() * Math.PI * 2; g.beginPath(); g.moveTo(c + Math.cos(a) * n * 0.18, c + Math.sin(a) * n * 0.18); g.lineTo(c + Math.cos(a) * n * (0.24 + r() * 0.08), c + Math.sin(a) * n * (0.24 + r() * 0.08)); g.stroke() }
    blob(g, c, c, n * 0.17, 'rgba(0,0,0,1)')
    for (let i = 0; i < 4; i++) { const a = r() * Math.PI * 2; blob(g, c + Math.cos(a) * n * 0.08, c + Math.sin(a) * n * 0.08, n * 0.028, 'rgba(58,61,70,1)') }   // sheared bolts
  },
  // Glowing hot spot (additive).
  hot(g, n) {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
    gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.25, 'rgba(255,122,31,0.8)'); gr.addColorStop(0.6, 'rgba(200,50,10,0.3)'); gr.addColorStop(1, 'rgba(120,20,0,0)')
    g.fillStyle = gr; g.fillRect(0, 0, n, n)
  },
}

const _cTmp = new THREE.Color()
const _qRoll = new THREE.Quaternion()
function rand(m) { return (Math.random() - 0.5) * 2 * m }
