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
//
// SHELLS (autocannon) are fast ballistic rounds: a velocity vector with a small
// gameplay gravity, advanced by the same swept raycast along the segment it
// travels this frame (no tunnelling at 150 su/s). A shell does damage ONLY when
// that sweep actually meets a robot body (onShellHit → WeaponManager's damage
// path); walls / floor / max range end it with an impact puff. Owner is
// excluded from its sweep so a robot never shoots itself.
// ─────────────────────────────────────────────────────────────────────────────

class ProjectileManager {
  constructor() {
    this._scene = null; this._rockets = []; this._pool = []
    this._shells = []; this._shellPool = []
    this.onShellHit = null      // (shell, hitId, point, dir) → void — set by WeaponManager
    this.onShellImpact = null   // (point) → void — optional spark on walls/floor
  }

  init(scene) { this._scene = scene }

  spawnShell(origin, dir, ownerId, def, inst = null) {
    const d = dir.clone().normalize()
    const speed = def.projectileSpeed || 150
    this._shells.push({
      pos: origin.clone(), vel: d.multiplyScalar(speed), ownerId, def, inst, pass: [ownerId],
      travelled: 0, maxDist: def.range || 70, g: def.gravity || 0,
      mesh: this._acquireShellMesh(),
    })
  }

  spawnRocket(origin, dir, ownerId, def) {
    const d = dir.clone().normalize()
    const speed = def.projectileSpeed || 55
    this._rockets.push({
      pos: origin.clone(), dir: d, speed, ownerId, def,
      life: (def.range || 80) / speed + 0.15,
      mesh: this._acquireMesh(),
    })
  }

  // Advance all rockets (detonate via ExplosionSystem) and shells.
  step(dt) {
    this._stepShells(dt)
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

  _stepShells(dt) {
    const dir = new THREE.Vector3()
    for (let i = this._shells.length - 1; i >= 0; i--) {
      const sh = this._shells[i]
      sh.vel.y -= sh.g * dt
      const stepLen = sh.vel.length() * dt
      dir.copy(sh.vel).normalize()
      const hit = physicsManager.raycast(sh.pos, dir, stepLen, sh.pass.length > 1 ? sh.pass : sh.ownerId)
      if (hit && hit.toi <= stepLen) {
        const point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
        let consumed = true
        if (hit.id != null && hit.id !== sh.ownerId && this.onShellHit) consumed = this.onShellHit(sh, hit.id, point, dir.clone()) !== false
        else this.onShellImpact?.(point)
        if (consumed) { this._releaseShell(sh); this._shells.splice(i, 1); continue }
        sh.pass.push(hit.id)   // only clipped that robot's box: fly on through it
      }
      sh.pos.addScaledVector(dir, stepLen)
      sh.travelled += stepLen
      if (sh.pos.y <= 0.02) { this.onShellImpact?.(sh.pos.clone()); this._releaseShell(sh); this._shells.splice(i, 1); continue }
      if (sh.travelled >= sh.maxDist) { this._releaseShell(sh); this._shells.splice(i, 1); continue }
      sh.mesh.position.copy(sh.pos)
      sh.mesh.quaternion.setFromUnitVectors(FORWARD, dir)
    }
  }

  get shellCount() { return this._shells.length }

  _acquireShellMesh() {
    let m = this._shellPool.pop()
    if (!m) {
      // A short glowing tracer streak along +Z (stretched along travel).
      m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe08a }),
      )
      m.geometry.rotateX(Math.PI / 2)
      m.geometry.translate(0, 0, -0.8)       // tail trails behind the round
      m.userData.isArena = true
      this._scene?.add(m)
    }
    m.visible = true
    return m
  }

  _releaseShell(sh) { sh.mesh.visible = false; this._shellPool.push(sh.mesh) }

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
    for (const sh of this._shells) { sh.mesh.geometry.dispose(); sh.mesh.material.dispose(); sh.mesh.removeFromParent() }
    for (const m of this._shellPool) { m.geometry.dispose(); m.material.dispose(); m.removeFromParent() }
    this._rockets = []; this._pool = []; this._shells = []; this._shellPool = []
  }
}

const FORWARD = new THREE.Vector3(0, 0, 1)

export const projectileManager = new ProjectileManager()
