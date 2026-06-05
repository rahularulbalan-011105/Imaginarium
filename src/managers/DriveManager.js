import * as THREE from 'three'
import { simulationManager } from './SimulationManager.js'

const MOTOR_TYPES = new Set(['motor', 'motor_bo', 'motor_dc'])
const SPEED_SCALE = 6.0   // world units/sec at 100% speed

class DriveManager {
  constructor() {
    this.scene        = null
    this.objectMgr    = null
    this.rootGroup    = null
    this._leftIds     = []
    this._rightIds    = []
    this._lastTime    = null
    this.wheelbase    = 3.0
    this.manualSpeeds = { l: 0, r: 0 }
  }

  init(scene, objectMgr) {
    this.scene     = scene
    this.objectMgr = objectMgr
  }

  get isActive() { return !!this.rootGroup }

  enter(objects) {
    if (!this.scene || this.rootGroup) return

    // Only top-level scene objects (skip wheels attached to motor rotors, etc.)
    const topLevel = objects.filter(obj => {
      const mesh = this.objectMgr.getMesh(obj.id)
      return mesh && mesh.parent === this.scene
    })
    if (topLevel.length === 0) return

    // Compute XZ centroid of top-level objects
    let cx = 0, cz = 0, n = 0
    for (const obj of topLevel) {
      const mesh = this.objectMgr.getMesh(obj.id)
      if (!mesh) continue
      mesh.updateMatrixWorld(true)
      const p = new THREE.Vector3()
      mesh.getWorldPosition(p)
      cx += p.x; cz += p.z; n++
    }
    if (n > 0) { cx /= n; cz /= n }

    this.rootGroup = new THREE.Group()
    this.rootGroup.userData.isDriveRoot = true
    this.rootGroup.position.set(cx, 0, cz)
    this.scene.add(this.rootGroup)

    // Re-parent each top-level mesh into the root group
    for (const obj of topLevel) {
      const mesh = this.objectMgr.getMesh(obj.id)
      if (!mesh || mesh.parent !== this.scene) continue
      mesh.updateMatrixWorld(true)
      const wm = mesh.matrixWorld.clone()
      mesh.removeFromParent()
      this.rootGroup.add(mesh)
      // Convert world matrix to rootGroup-local
      const localMat = new THREE.Matrix4()
        .copy(this.rootGroup.matrixWorld)
        .invert()
        .multiply(wm)
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      localMat.decompose(p, q, s)
      mesh.position.copy(p)
      mesh.quaternion.copy(q)
      mesh.scale.copy(s)
    }

    // Detect left / right motors by local X in rootGroup space
    const motors = topLevel.filter(o => MOTOR_TYPES.has(o.type))
    if (motors.length >= 2) {
      const sorted = motors
        .map(o => ({ id: o.id, x: this.objectMgr.getMesh(o.id)?.position.x ?? 0 }))
        .sort((a, b) => a.x - b.x)
      const half = Math.max(1, Math.floor(sorted.length / 2))
      this._leftIds  = sorted.slice(0, half).map(m => m.id)
      this._rightIds = sorted.slice(-half).map(m => m.id)
      this.wheelbase = Math.max(0.5, sorted[sorted.length - 1].x - sorted[0].x)
    } else {
      // No motor objects — use a default wheelbase for manual driving
      this._leftIds  = []
      this._rightIds = []
      this.wheelbase = 3.0
    }

    this.manualSpeeds = { l: 0, r: 0 }
    this._lastTime    = null
  }

  exit(updateObject) {
    if (!this.rootGroup) return
    const children = [...this.rootGroup.children]
    for (const mesh of children) {
      const id = mesh.userData.id
      mesh.updateMatrixWorld(true)
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      mesh.matrixWorld.decompose(p, q, s)
      this.rootGroup.remove(mesh)
      this.scene.add(mesh)
      mesh.position.copy(p); mesh.quaternion.copy(q); mesh.scale.copy(s)
      if (id && updateObject) {
        const e = new THREE.Euler().setFromQuaternion(q)
        updateObject(id, {
          position: { x: p.x, y: p.y, z: p.z },
          rotation: { x: e.x, y: e.y, z: e.z },
        })
      }
    }
    this.scene.remove(this.rootGroup)
    this.rootGroup    = null
    this._leftIds     = []
    this._rightIds    = []
    this._lastTime    = null
    this.manualSpeeds = { l: 0, r: 0 }
  }

  // Called every animation frame. Reads from simulationManager.motorSpeeds when code
  // is running, otherwise falls back to manualSpeeds set by DrivePanel sliders.
  step() {
    if (!this.rootGroup) return
    const now = performance.now() / 1000
    const dt  = this._lastTime !== null ? Math.min(now - this._lastTime, 0.05) : 0
    this._lastTime = now
    if (dt === 0) return

    let leftPct, rightPct

    // Prefer code-driven speeds when the Arduino simulation is active
    const mSpeeds  = simulationManager.motorSpeeds
    const codeMode = simulationManager.isRunning()
      && this._leftIds.length > 0
      && this._rightIds.length > 0
    const hasCodeMotion = codeMode
      && [...this._leftIds, ...this._rightIds].some(id => (mSpeeds[id] ?? 0) > 0)

    if (hasCodeMotion) {
      const avg = (ids) =>
        ids.reduce((s, id) => s + (mSpeeds[id] ?? 0), 0) / ids.length
      leftPct  = (avg(this._leftIds)  / 255) * 100
      rightPct = (avg(this._rightIds) / 255) * 100
    } else {
      leftPct  = this.manualSpeeds.l
      rightPct = this.manualSpeeds.r
    }

    if (leftPct === 0 && rightPct === 0) return

    const vL    = (leftPct  / 100) * SPEED_SCALE
    const vR    = (rightPct / 100) * SPEED_SCALE
    const v     = (vL + vR) / 2
    const omega = (vR - vL) / this.wheelbase
    const yaw   = this.rootGroup.rotation.y

    // Forward direction for robot facing -Z: (-sin yaw, 0, -cos yaw)
    this.rootGroup.position.x -= v * Math.sin(yaw) * dt
    this.rootGroup.position.z -= v * Math.cos(yaw) * dt
    this.rootGroup.rotation.y += omega * dt
  }
}

export const driveManager = new DriveManager()
