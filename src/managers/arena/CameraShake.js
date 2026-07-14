import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────────────
// CameraShake — trauma-based procedural shake (Squirrel Eiserloh model).
//
// Sources ADD trauma (0..1); the visible shake = trauma² (so small hits are
// subtle, big ones violent), and trauma decays linearly every frame. Shake is a
// smooth pseudo-noise offset in position + a tiny yaw/pitch — never a roll, never
// a snap. The ArenaCameraRig adds getOffset() on top of the settled camera pose.
// ─────────────────────────────────────────────────────────────────────────────

// Preset trauma amounts for the three named intensities in the spec.
export const SHAKE = {
  small:  0.22,   // weapon recoil
  medium: 0.5,    // explosions
  heavy:  0.9,    // robot destruction
}

export class CameraShake {
  constructor() {
    this._trauma = 0
    this._t = 0
    this._maxPos = 0.9      // scene units of positional shake at full trauma
    this._maxRot = 0.06     // radians of yaw/pitch shake at full trauma
    this._seed = [12.9898, 78.233, 37.719]
    this._offset = new THREE.Vector3()
    this._rot = { yaw: 0, pitch: 0 }
  }

  // Add trauma from a named preset or a raw 0..1 amount.
  add(amount) {
    const v = typeof amount === 'string' ? (SHAKE[amount] ?? 0) : amount
    this._trauma = Math.min(1, this._trauma + v)
  }

  reset() { this._trauma = 0; this._t = 0; this._offset.set(0, 0, 0); this._rot.yaw = 0; this._rot.pitch = 0 }

  // Advance and compute the current shake. `decay` per second.
  update(dt, decay = 1.3) {
    this._t += dt
    this._trauma = Math.max(0, this._trauma - decay * dt)
    const shake = this._trauma * this._trauma
    if (shake <= 0.0001) { this._offset.set(0, 0, 0); this._rot.yaw = 0; this._rot.pitch = 0; return }
    // Smooth, decorrelated noise per axis via layered sines (no Math.random →
    // no per-frame jitter discontinuity).
    const n = (k) => Math.sin(this._t * (14 + k * 3.3) + this._seed[k % 3]) * Math.sin(this._t * (5.7 + k * 1.9))
    this._offset.set(n(0), n(1) * 0.6, n(2)).multiplyScalar(shake * this._maxPos)
    this._rot.yaw   = n(3) * shake * this._maxRot
    this._rot.pitch = n(4) * shake * this._maxRot
  }

  get positionOffset() { return this._offset }
  get rotationOffset() { return this._rot }
  get active() { return this._trauma > 0.0001 }
}
