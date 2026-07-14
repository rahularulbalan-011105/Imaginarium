import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// HitEffects — pooled 3D combat VFX in the arena scene.
//
// Impact sparks, smoke puffs, debris chunks, hit flashes (brief emissive pulse on
// the struck robot), armor-break shards, and burning/destroyed smoke+fire. All
// meshes are pooled and tagged userData.isArena so CombatManager's hide/cleanup
// treats them as arena furniture. WeaponManager already owns muzzle flashes +
// tracers; this covers the "on impact / on death" side of the feedback.
// ─────────────────────────────────────────────────────────────────────────────

const UP = new THREE.Vector3(0, 1, 0)

export class HitEffects {
  constructor() {
    this._scene = null
    this._particles = []     // { mesh, vel, life, maxLife, kind, spin }
    this._pool = { spark: [], smoke: [], debris: [] }
    this._flashes = []       // { mesh, mats, orig, t, life }
    this._fires = []         // persistent destroyed-robot smoke/fire emitters
  }

  configure(scene) { this._scene = scene; return this }

  // ── Public effect calls ─────────────────────────────────────────────────────

  // Weapon/impact spark burst + a little smoke at a world point.
  impact(pos, { armorBreak = false, crit = false } = {}) {
    const n = crit ? 14 : armorBreak ? 12 : 7
    for (let i = 0; i < n; i++) {
      const p = this._acquire('spark')
      p.mesh.position.copy(pos)
      const dir = randDir(0.6)
      p.vel.copy(dir).multiplyScalar(6 + Math.random() * 10)
      p.vel.y += 3
      p.life = p.maxLife = 0.28 + Math.random() * 0.22
      p.kind = 'spark'
      p.mesh.material.color.setHex(crit ? 0xfff2a0 : armorBreak ? 0x9fd8ff : 0xffb648)
      p.mesh.visible = true
      this._particles.push(p)
    }
    this._smokePuff(pos, 0.6, 1)
    if (armorBreak) this._armorShards(pos)
  }

  // Brief emissive flash across every mesh of the struck robot's mover set.
  hitFlash(movers, color = 0xff5544) {
    if (!movers || !movers.length) return
    const mats = []
    for (const mv of movers) {
      mv.mesh.traverse(o => {
        if (o.isMesh && o.material && o.material.emissive) {
          mats.push({ m: o.material, e: o.material.emissive.getHex(), i: o.material.emissiveIntensity ?? 1 })
        }
      })
    }
    if (!mats.length) return
    const c = new THREE.Color(color)
    for (const r of mats) { r.m.emissive.copy(c); r.m.emissiveIntensity = 1.2 }
    this._flashes.push({ mats, t: 0, life: 0.16 })
  }

  // A little push-back shudder is done in CombatManager (impulse). Here: dust.
  scuff(pos) { this._smokePuff(pos, 0.5, 1) }

  // Armor-break: a ring of blue shards.
  _armorShards(pos) {
    for (let i = 0; i < 8; i++) {
      const p = this._acquire('debris')
      p.mesh.position.copy(pos)
      const a = (i / 8) * Math.PI * 2
      p.vel.set(Math.cos(a) * 7, 4 + Math.random() * 3, Math.sin(a) * 7)
      p.life = p.maxLife = 0.5
      p.kind = 'debris'
      p.spin.set(rand(8), rand(8), rand(8))
      p.mesh.material.color.setHex(0x7dd3fc)
      p.mesh.visible = true
      this._particles.push(p)
    }
  }

  // Destroyed robot: persistent smoke column + fire glow + a debris burst. The
  // wreck itself is left in place by CombatManager (robots remain on the field).
  destroyed(pos) {
    // Debris burst.
    for (let i = 0; i < 16; i++) {
      const p = this._acquire('debris')
      p.mesh.position.copy(pos).add(new THREE.Vector3(rand(1), rand(1), rand(1)))
      p.vel.copy(randDir(1)).multiplyScalar(5 + Math.random() * 9); p.vel.y = 5 + Math.random() * 6
      p.life = p.maxLife = 0.7 + Math.random() * 0.5
      p.kind = 'debris'; p.spin.set(rand(10), rand(10), rand(10))
      p.mesh.material.color.setHex(0x3a3f47)
      p.mesh.visible = true
      this._particles.push(p)
    }
    // Fire glow (short) + smoke column (persistent while in the arena).
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.9, depthWrite: false }),
    )
    fire.position.copy(pos).add(new THREE.Vector3(0, 1, 0))
    fire.userData.isArena = true
    this._scene.add(fire)
    this._fires.push({ mesh: fire, t: 0, pos: pos.clone(), nextPuff: 0 })
  }

  // ── Per-frame ───────────────────────────────────────────────────────────────
  step(dt) {
    // Particles (sparks/smoke/debris).
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i]
      p.life -= dt
      if (p.life <= 0) { p.mesh.visible = false; this._release(p); this._particles.splice(i, 1); continue }
      const k = p.life / p.maxLife
      if (p.kind !== 'smoke') { p.vel.y -= 22 * dt; p.vel.multiplyScalar(1 - 2.2 * dt) }   // gravity + drag
      else { p.vel.multiplyScalar(1 - 1.5 * dt); p.vel.y += 1.5 * dt }                       // smoke rises
      p.mesh.position.addScaledVector(p.vel, dt)
      if (p.kind === 'debris') p.mesh.rotation.set(p.mesh.rotation.x + p.spin.x * dt, p.mesh.rotation.y + p.spin.y * dt, p.mesh.rotation.z + p.spin.z * dt)
      if (p.kind === 'smoke') { const s = 1 + (1 - k) * 2.5; p.mesh.scale.setScalar(s); p.mesh.material.opacity = 0.4 * k }
      else if (p.kind === 'spark') p.mesh.material.opacity = k
    }
    // Hit flashes decay back to original emissive.
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i]; f.t += dt
      const k = 1 - f.t / f.life
      if (k <= 0) { for (const r of f.mats) { r.m.emissive.setHex(r.e); r.m.emissiveIntensity = r.i } this._flashes.splice(i, 1); continue }
      for (const r of f.mats) r.m.emissiveIntensity = 0.2 + 1.2 * k
    }
    // Destroyed-robot fire + smoke emitters.
    for (const fr of this._fires) {
      fr.t += dt
      const flick = 0.6 + Math.sin(fr.t * 20) * 0.2 + Math.random() * 0.15
      fr.mesh.material.opacity = Math.max(0, (fr.t < 1.2 ? 0.9 : 0.9 - (fr.t - 1.2) * 0.5)) * flick
      fr.mesh.scale.setScalar(1 + Math.sin(fr.t * 8) * 0.12)
      fr.nextPuff -= dt
      if (fr.nextPuff <= 0) { fr.nextPuff = 0.18; this._smokePuff(new THREE.Vector3(fr.pos.x, fr.pos.y + 1.4, fr.pos.z), 0.9, 1.4) }
    }
  }

  _smokePuff(pos, size, upBias) {
    const p = this._acquire('smoke')
    p.mesh.position.copy(pos)
    p.vel.set(rand(1.5), 1.2 * upBias, rand(1.5))
    p.life = p.maxLife = 0.6 + Math.random() * 0.4
    p.kind = 'smoke'
    p.mesh.scale.setScalar(size)
    p.mesh.material.opacity = 0.4
    p.mesh.material.color.setHex(0x555a63)
    p.mesh.visible = true
    this._particles.push(p)
  }

  // ── Pooling ─────────────────────────────────────────────────────────────────
  _acquire(kind) {
    const pool = this._pool[kind]
    let mesh = pool.pop()
    if (!mesh) {
      if (kind === 'spark') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 1, depthWrite: false }))
      else if (kind === 'smoke') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0x555a63, transparent: true, opacity: 0.4, depthWrite: false }))
      else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 }))
      mesh.userData.isArena = true
      this._scene.add(mesh)
    }
    return { mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, maxLife: 0, kind }
  }

  _release(p) { this._pool[p.kind]?.push(p.mesh) }

  clear() {
    for (const f of this._flashes) for (const r of f.mats) { r.m.emissive.setHex(r.e); r.m.emissiveIntensity = r.i }
    const dispose = (m) => { m.geometry?.dispose(); m.material?.dispose?.(); m.removeFromParent() }
    for (const p of this._particles) dispose(p.mesh)
    for (const k of Object.keys(this._pool)) { for (const m of this._pool[k]) dispose(m); this._pool[k] = [] }
    for (const fr of this._fires) dispose(fr.mesh)
    this._particles = []; this._flashes = []; this._fires = []
  }
}

function rand(m) { return (Math.random() - 0.5) * 2 * m }
function randDir(spread) {
  const v = new THREE.Vector3(rand(1), Math.random() * spread + 0.2, rand(1))
  if (v.lengthSq() < 1e-4) v.set(0, 1, 0)
  return v.normalize()
}
