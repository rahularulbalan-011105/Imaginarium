import * as THREE from 'three'
import { physicsManager } from '../physics/PhysicsManager.js'
import { ArenaCameraRig } from './ArenaCameraRig.js'
import { CameraShake } from './CameraShake.js'
import { CAMERA_MODES, MODE_KEYS, DEFAULT_MODE } from './ArenaCameraModes.js'

// ─────────────────────────────────────────────────────────────────────────────
// ArenaCameraManager — owns the arena camera for the duration of a match ONLY.
//
// On activate() it SNAPSHOTS the shared editor camera + OrbitControls, disables
// orbit controls, and drives the camera itself through ArenaCameraRig. On stop()
// it restores everything exactly, so the editor camera is untouched. It also owns
// the mode hotkeys (F1–F4), the F3 free-orbit mouse look, and the CameraShake that
// combat effects feed. Nothing here runs outside Arena mode.
// ─────────────────────────────────────────────────────────────────────────────

export class ArenaCameraManager {
  constructor() {
    this._camera = null
    this._controls = null
    this._rig = new ArenaCameraRig()
    this.shake = new CameraShake()
    this._mode = DEFAULT_MODE
    this._playerId = null
    this._active = false
    this._saved = null
    this._onKey = null
    this._onMouseMove = null
  }

  get shakeRef() { return this.shake }

  activate({ camera, orbitControls, playerRobot }) {
    this._camera = camera
    this._controls = orbitControls
    this._playerId = playerRobot?.bodyId ?? playerRobot?.id ?? null
    this._mode = DEFAULT_MODE
    this.shake.reset()

    // Snapshot the shared camera + controls so exit restores the editor exactly.
    this._saved = {
      pos: camera.position.clone(),
      up: camera.up.clone(),
      fov: camera.fov,
      target: orbitControls ? orbitControls.target.clone() : new THREE.Vector3(),
      controlsEnabled: orbitControls ? orbitControls.enabled : true,
    }
    if (orbitControls) orbitControls.enabled = false

    this._rig.configure(camera, this._playerId, CAMERA_MODES[this._mode])

    // Mode hotkeys + free-orbit mouse.
    this._onKey = (e) => {
      const code = e.code || e.key
      if (code in MODE_KEYS) {
        e.preventDefault()
        const next = MODE_KEYS[code]
        this.setMode(this._mode === next ? DEFAULT_MODE : next)   // press again → back to Default
      }
    }
    this._onMouseMove = (e) => {
      if (this._mode !== 'orbit') return
      this._rig.addOrbit(e.movementX || 0, e.movementY || 0)
    }
    window.addEventListener('keydown', this._onKey)
    window.addEventListener('mousemove', this._onMouseMove)
    this._active = true
  }

  setMode(key) {
    if (!CAMERA_MODES[key]) return
    this._mode = key
    this._rig.setModeTarget(CAMERA_MODES[key])
  }

  get mode() { return this._mode }

  // Called each frame from CombatManager.step BEFORE effects.
  update(dt) {
    if (!this._active || !this._playerId) return
    const body = physicsManager.getBody(this._playerId)
    if (!body) return
    this._rig.update(dt, body)
    // Shake: positional jitter + small pitch/yaw on top of the settled pose
    // (never a roll — we only rotateX/rotateY in camera-local space).
    this.shake.update(dt)
    if (this.shake.active) {
      const off = this.shake.positionOffset
      // Offset in camera-local axes so shake feels attached to the view.
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this._camera.quaternion)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this._camera.quaternion)
      this._camera.position.addScaledVector(right, off.x).addScaledVector(up, off.y)
      const r = this.shake.rotationOffset
      this._camera.rotateX(r.pitch)
      this._camera.rotateY(r.yaw)
    }
  }

  addShake(amount) { this.shake.add(amount) }

  stop() {
    this._active = false
    window.removeEventListener('keydown', this._onKey)
    window.removeEventListener('mousemove', this._onMouseMove)
    this._onKey = this._onMouseMove = null
    // Restore the shared editor camera + controls exactly as they were.
    if (this._saved && this._camera) {
      this._camera.position.copy(this._saved.pos)
      this._camera.up.copy(this._saved.up)
      if (this._camera.fov !== this._saved.fov) { this._camera.fov = this._saved.fov; this._camera.updateProjectionMatrix() }
      if (this._controls) {
        this._controls.target.copy(this._saved.target)
        this._controls.enabled = this._saved.controlsEnabled
        this._controls.update()
      }
    }
    this._saved = null
    this._playerId = null
    this.shake.reset()
  }
}

export const arenaCameraManager = new ArenaCameraManager()
