import * as THREE from 'three'
import { physicsManager } from '../managers/physics/PhysicsManager.js'
import { damageManager } from './DamageManager.js'

// ─────────────────────────────────────────────────────────────────────────────
// ExplosionSystem — physics-driven blasts (rockets now; grenades/hazards later).
//
// detonate() applies to every combatant in the splash radius: damage (falloff),
// an outward impulse (knockback, reduced by explosionResist), plus self-damage to
// the owner if caught in the blast. Emits a pooled flash + a camera shake.
//
// Configured by CombatManager with getRobots() → [{ id, bodyId, stats }].
// ─────────────────────────────────────────────────────────────────────────────

class ExplosionSystem {
  constructor() {
    this._scene = null
    this._getRobots = null
    this._flashes = []       // active flash VFX
    this._pool = []          // idle flash meshes
    this._shake = 0          // current camera-shake magnitude
    this._camera = null
  }

  configure({ scene, camera, getRobots, onDetonate = null }) {
    this._scene = scene; this._camera = camera; this._getRobots = getRobots
    this._onDetonate = onDetonate   // (pos) → arena effects hook (audio/shake/VFX)
    this._shake = 0
    return this
  }

  detonate(pos, def, ownerId) {
    const radius = def.splashRadius || 8
    const robots = this._getRobots ? this._getRobots() : []
    for (const r of robots) {
      const body = physicsManager.getBody(r.bodyId)
      if (!body) continue
      const bp = body.translation()
      const d = Math.hypot(bp.x - pos.x, bp.y - pos.y, bp.z - pos.z)
      if (d > radius) continue
      const falloff = Math.max(0, 1 - d / radius)

      const dm = def.damage || {}
      damageManager.apply({
        targetId: r.id, sourceId: ownerId, damageType: 'explosion',
        amounts: {
          armor: Math.round((dm.armor || 0) * falloff),
          core:  Math.round((dm.core || 0) * falloff),
          stability: Math.round((dm.stability || 0) * falloff),
          heat: Math.round((dm.heat || 0) * falloff),
        },
      })

      // Outward impulse (up-biased so robots pop a little), reduced by resistance.
      const resist = r.stats?.explosionResist ?? 0.2
      const mag = (def.knockback || 10) * falloff * (1 - resist)
      const dir = new THREE.Vector3(bp.x - pos.x, 0, bp.z - pos.z)
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1)
      dir.normalize()
      const mass = body.mass() || 1
      physicsManager.applyImpulse(r.id, { x: dir.x * mag * mass, y: mag * mass * 0.35, z: dir.z * mag * mass })

      // Self-damage: owner caught in its own blast.
      if (r.id === ownerId && def.selfDamage) {
        damageManager.apply({ targetId: r.id, damageType: 'explosion', amounts: { ...def.selfDamage } })
      }
    }

    this._flash(pos, radius)
    this._shake = Math.min(1.2, this._shake + 0.6)
    if (this._onDetonate) this._onDetonate(pos)
  }

  // Advance flash VFX + decay camera shake. Call each frame.
  step(dt) {
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i]
      f.t += dt
      const k = f.t / f.life
      if (k >= 1) { f.mesh.visible = false; this._pool.push(f.mesh); this._flashes.splice(i, 1); continue }
      const s = f.radius * (0.4 + k * 0.9)
      f.mesh.scale.setScalar(s)
      f.mesh.material.opacity = 0.85 * (1 - k)
    }
    if (this._shake > 0 && this._camera) {
      const m = this._shake
      this._camera.position.x += (Math.random() - 0.5) * m
      this._camera.position.y += (Math.random() - 0.5) * m
      this._shake = Math.max(0, this._shake - dt * 3)
    }
  }

  _flash(pos, radius) {
    let mesh = this._pool.pop()
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.85, depthWrite: false }),
      )
      mesh.userData.isArena = true
      this._scene?.add(mesh)
    }
    mesh.position.set(pos.x, pos.y, pos.z)
    mesh.scale.setScalar(radius * 0.4)
    mesh.material.opacity = 0.85
    mesh.visible = true
    this._flashes.push({ mesh, t: 0, life: 0.4, radius })
  }

  clear() {
    for (const f of this._flashes) { f.mesh.geometry.dispose(); f.mesh.material.dispose(); f.mesh.removeFromParent() }
    for (const m of this._pool) { m.geometry.dispose(); m.material.dispose(); m.removeFromParent() }
    this._flashes = []; this._pool = []; this._shake = 0
    this._getRobots = null; this._onDetonate = null
  }
}

export const explosionSystem = new ExplosionSystem()
