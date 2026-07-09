import * as THREE from 'three'
import { physicsManager } from '../managers/physics/PhysicsManager.js'
import { explosionSystem } from './ExplosionSystem.js'

// ─────────────────────────────────────────────────────────────────────────────
// ProjectileManager — physical rockets (bullets are instant raycasts handled by
// WeaponManager, so 1000 "projectiles" ≠ 1000 bodies).
//
// A rocket is advanced by a SWEPT raycast each frame (cheap, pool-friendly): cast
// from its current position along travel; a hit within the step → detonate at the
// impact point; else advance. Detonates on contact, on the ground, or at end of
// life (airburst). Meshes are pooled.
// ─────────────────────────────────────────────────────────────────────────────

class ProjectileManager {
  constructor() { this._scene = null; this._rockets = []; this._pool = [] }

  init(scene) { this._scene = scene }

  spawnRocket(origin, dir, ownerId, def) {
    const d = dir.clone().normalize()
    const speed = def.projectileSpeed || 55
    this._rockets.push({
      pos: origin.clone(), dir: d, speed, ownerId, def,
      life: (def.range || 80) / speed + 0.15,
      mesh: this._acquireMesh(),
    })
  }

  // Advance all rockets; detonate via ExplosionSystem.
  step(dt) {
    for (let i = this._rockets.length - 1; i >= 0; i--) {
      const rk = this._rockets[i]
      const stepLen = rk.speed * dt
      // Swept ray: does the rocket hit something in this step?
      const hit = physicsManager.raycast(rk.pos, rk.dir, stepLen + 0.4, rk.ownerId)
      let detonateAt = null
      if (hit && hit.toi <= stepLen + 0.4) detonateAt = hit.point
      else {
        rk.pos.addScaledVector(rk.dir, stepLen)
        rk.life -= dt
        if (rk.pos.y <= 0.25) detonateAt = { x: rk.pos.x, y: 0.25, z: rk.pos.z }   // ground hit
        else if (rk.life <= 0) detonateAt = { x: rk.pos.x, y: rk.pos.y, z: rk.pos.z } // airburst
      }

      if (detonateAt) {
        explosionSystem.detonate(new THREE.Vector3(detonateAt.x, detonateAt.y, detonateAt.z), rk.def, rk.ownerId)
        this._release(rk); this._rockets.splice(i, 1)
        continue
      }
      // Update mesh pose (point along travel).
      rk.mesh.position.set(rk.pos.x, rk.pos.y, rk.pos.z)
      rk.mesh.quaternion.setFromUnitVectors(FORWARD, rk.dir)
    }
  }

  _acquireMesh() {
    let m = this._pool.pop()
    if (!m) {
      m = new THREE.Mesh(
        new THREE.ConeGeometry(0.25, 1.1, 8),
        new THREE.MeshStandardMaterial({ color: 0xffcc44, emissive: 0x552200, roughness: 0.5 }),
      )
      m.geometry.rotateX(Math.PI / 2)   // cone points +Z
      m.userData.isArena = true
      this._scene?.add(m)
    }
    m.visible = true
    return m
  }

  _release(rk) { rk.mesh.visible = false; this._pool.push(rk.mesh) }

  clear() {
    for (const rk of this._rockets) { rk.mesh.geometry.dispose(); rk.mesh.material.dispose(); rk.mesh.removeFromParent() }
    for (const m of this._pool) { m.geometry.dispose(); m.material.dispose(); m.removeFromParent() }
    this._rockets = []; this._pool = []
  }
}

const FORWARD = new THREE.Vector3(0, 0, 1)

export const projectileManager = new ProjectileManager()
