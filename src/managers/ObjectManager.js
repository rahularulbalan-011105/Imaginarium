import * as THREE from 'three'
import { BufferGeometryLoader } from 'three'
import { createGeometry, createMaterial } from '../utils/geometryFactory.js'
import { createArduinoGroup, createMotorGroup, createMotorBOGroup, createMotorDCGroup, createLEDGroup } from '../utils/electronicsFactory.js'
import { wireManager } from './WireManager.js'

const ELECTRONICS = new Set(['arduino', 'motor', 'motor_bo', 'motor_dc', 'led'])
const MOTOR_TYPES = new Set(['motor', 'motor_bo', 'motor_dc'])

class ObjectManager {
  constructor() {
    this.scene = null
    // id → THREE.Mesh | THREE.Group
    this.objects = new Map()
    // id → THREE.Line (connection wires)
    this.wires = new Map()
    // objectId → motorId  (mesh is a child of that motor's rotorGroup)
    this.attachedObjects = new Map()
  }

  init(scene) {
    this.scene = scene
  }

  // ── Create ────────────────────────────────────────────────────────────────

  createMesh(obj) {
    let object3d

    if (obj.type === 'arduino') {
      object3d = createArduinoGroup()
    } else if (obj.type === 'motor_bo') {
      object3d = createMotorBOGroup()
    } else if (obj.type === 'motor_dc') {
      object3d = createMotorDCGroup()
    } else if (obj.type === 'motor') {
      object3d = createMotorGroup()
    } else if (obj.type === 'led') {
      object3d = createLEDGroup(obj.color)
    } else if (obj.type === 'csg' && obj.geometryJSON) {
      const geo = new BufferGeometryLoader().parse(obj.geometryJSON)
      const mat = createMaterial(obj.color, obj.material)
      object3d = new THREE.Mesh(geo, mat)
    } else {
      const geo = createGeometry(obj.type)
      const mat = createMaterial(obj.color, obj.material)
      object3d = new THREE.Mesh(geo, mat)
    }

    object3d.userData.id = obj.id
    object3d.userData.type = obj.type
    // Mark every descendant so raycasting can walk up to the root
    object3d.traverse(child => { child.userData.rootId = obj.id })

    if (!ELECTRONICS.has(obj.type)) {
      object3d.castShadow = true
      object3d.receiveShadow = true
    }

    this._applyTransform(object3d, obj)
    object3d.visible = obj.visible !== false
    this.scene.add(object3d)
    this.objects.set(obj.id, object3d)

    // Register pins for interactive wire drawing
    if (ELECTRONICS.has(obj.type) && wireManager.scene) {
      wireManager.registerComponent(object3d, obj.id, obj.type)
    }

    return object3d
  }

  // ── Update ────────────────────────────────────────────────────────────────

  updateMesh(id, obj) {
    const o = this.objects.get(id)
    if (!o) return

    // Transform is managed by Three.js parenting while attached to a rotor
    if (this.attachedObjects.has(id)) {
      o.visible = obj.visible !== false
      return
    }

    this._applyTransform(o, obj)
    o.visible = obj.visible !== false

    // Non-electronics: update material color
    if (!ELECTRONICS.has(obj.type) && obj.type !== 'csg') {
      if (o.material) {
        o.material.color.set(obj.color)
        if (obj.material && o.material.userData.matType !== obj.material) {
          const newMat = createMaterial(obj.color, obj.material)
          newMat.userData.matType = obj.material
          o.material.dispose()
          o.material = newMat
        }
      }
    }
  }

  _applyTransform(o, obj) {
    o.position.set(obj.position.x, obj.position.y, obj.position.z)
    o.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z)
    o.scale.set(obj.scale.x, obj.scale.y, obj.scale.z)
  }

  // ── Shaft attachment ──────────────────────────────────────────────────────

  // Reparent objectId's mesh into motorId's rotorGroup so it spins automatically.
  // snapX:  explicit X along shaft axis (null = derive from world position).
  // alignX: 'center' | 'front' | 'back'
  //   center → mesh origin at snapX
  //   front  → +X extremity of mesh at snapX (e.g. cone tip pointing toward shaft)
  //   back   → -X extremity of mesh at snapX (e.g. cone base at shaft, tip extends past)
  attachMeshToRotor(objectId, motorId, snapX = null, alignX = 'center') {
    const mesh = this.objects.get(objectId)
    const motorMesh = this.objects.get(motorId)
    if (!mesh || !motorMesh?.userData.rotorGroup) return false

    const rotorGroup = motorMesh.userData.rotorGroup
    motorMesh.updateMatrixWorld(true)
    mesh.updateMatrixWorld(true)

    // Preserve the mesh's world orientation as rotor-local orientation so the
    // user's deliberate rotations (e.g. cone tip pointing toward shaft) survive.
    const worldQuat = new THREE.Quaternion()
    mesh.getWorldQuaternion(worldQuat)
    const rotorWorldQuat = new THREE.Quaternion()
    rotorGroup.getWorldQuaternion(rotorWorldQuat)
    const localQuat = rotorWorldQuat.clone().invert().multiply(worldQuat)

    // Base position: center on shaft axis at snapX (or derive from world pos)
    const worldPos = new THREE.Vector3()
    mesh.getWorldPosition(worldPos)
    const localPos = rotorGroup.worldToLocal(worldPos.clone())
    localPos.x = snapX !== null ? snapX : localPos.x
    localPos.y = 0
    localPos.z = 0

    // Bounding-box alignment: shift X so the chosen face lands at snapX
    if (snapX !== null && alignX !== 'center' && mesh.geometry) {
      mesh.geometry.computeBoundingBox()
      const bb = mesh.geometry.boundingBox
      if (bb) {
        const ms = new THREE.Vector3(); mesh.getWorldScale(ms)
        const rs = new THREE.Vector3(); rotorGroup.getWorldScale(rs)
        let minXc = Infinity, maxXc = -Infinity
        for (let xi = 0; xi < 2; xi++)
          for (let yi = 0; yi < 2; yi++)
            for (let zi = 0; zi < 2; zi++) {
              const c = new THREE.Vector3(
                (xi === 0 ? bb.min.x : bb.max.x) * ms.x / rs.x,
                (yi === 0 ? bb.min.y : bb.max.y) * ms.y / rs.y,
                (zi === 0 ? bb.min.z : bb.max.z) * ms.z / rs.z,
              )
              c.applyQuaternion(localQuat)
              if (c.x < minXc) minXc = c.x
              if (c.x > maxXc) maxXc = c.x
            }
        if (alignX === 'front') localPos.x = snapX - maxXc  // +X face at snapX
        if (alignX === 'back')  localPos.x = snapX - minXc  // -X face at snapX
      }
    }

    if (mesh.parent) mesh.parent.remove(mesh)
    rotorGroup.add(mesh)
    mesh.position.copy(localPos)
    mesh.quaternion.copy(localQuat)  // Preserve user's orientation

    this.attachedObjects.set(objectId, motorId)
    return true
  }

  // Read the attached object's local position within the rotorGroup.
  getAttachedLocalPosition(objectId) {
    const mesh = this.objects.get(objectId)
    if (!mesh || !this.attachedObjects.has(objectId)) return null
    return { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
  }

  // Move an attached object to a new local position within the rotorGroup.
  updateAttachedLocalPosition(objectId, x, y, z) {
    const mesh = this.objects.get(objectId)
    if (!mesh || !this.attachedObjects.has(objectId)) return false
    mesh.position.set(x, y, z)
    return true
  }

  // Remove objectId's mesh from the rotorGroup and place it back in the scene
  // at its current world position. Returns the world position (or null).
  detachMeshFromRotor(objectId) {
    const mesh = this.objects.get(objectId)
    if (!mesh || !this.attachedObjects.has(objectId)) return null

    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    mesh.getWorldPosition(worldPos)
    mesh.getWorldQuaternion(worldQuat)

    mesh.removeFromParent()
    if (this.scene) {
      this.scene.add(mesh)
      mesh.position.copy(worldPos)
      mesh.quaternion.copy(worldQuat)
    }

    this.attachedObjects.delete(objectId)
    return worldPos
  }

  // Returns the motorId if objectId's mesh is within threshold units of any
  // motor body centre, otherwise returns null. Threshold is generous so the
  // drag-drop prompt fires whenever the prop is anywhere near the motor.
  findNearbyMotorShaft(objectId, threshold = 8.0) {
    const mesh = this.objects.get(objectId)
    if (!mesh) return null

    const objPos = new THREE.Vector3()
    mesh.getWorldPosition(objPos)

    for (const [id, motorMesh] of this.objects) {
      if (!MOTOR_TYPES.has(motorMesh.userData.type)) continue
      if (!motorMesh.userData.rotorGroup) continue
      if (id === objectId) continue

      const motorPos = new THREE.Vector3()
      motorMesh.getWorldPosition(motorPos)
      if (objPos.distanceTo(motorPos) < threshold) return id
    }
    return null
  }

  // Returns the motorId of the motor whose centre is closest to objectId.
  findNearestMotor(objectId) {
    const mesh = this.objects.get(objectId)
    if (!mesh) return null

    const objPos = new THREE.Vector3()
    mesh.getWorldPosition(objPos)

    let nearestId = null
    let nearestDist = Infinity

    for (const [id, motorMesh] of this.objects) {
      if (!MOTOR_TYPES.has(motorMesh.userData.type)) continue
      if (!motorMesh.userData.rotorGroup) continue
      if (id === objectId) continue

      const motorPos = new THREE.Vector3()
      motorMesh.getWorldPosition(motorPos)
      const dist = objPos.distanceTo(motorPos)
      if (dist < nearestDist) { nearestDist = dist; nearestId = id }
    }
    return nearestId
  }

  // ── Motor animation ───────────────────────────────────────────────────────

  // Called every frame from SceneManager. speed = 0-255
  animateMotor(id, speed) {
    const o = this.objects.get(id)
    if (!o) return
    const radsPerFrame = (speed / 255) * (Math.PI * 2 * 4) / 60
    const axis = o.userData.rotorAxis ?? 'y'
    // Spin the physical shaft mesh (visual)
    if (o.userData.rotorMesh) o.userData.rotorMesh.rotation[axis] += radsPerFrame
    // Spin the virtual attachment group (carries props)
    if (o.userData.rotorGroup) o.userData.rotorGroup.rotation[axis] += radsPerFrame
  }

  // Called from simulation tick or on stop. brightness = 0-255
  animateLed(id, brightness) {
    const o = this.objects.get(id)
    if (!o || !o.userData.emissiveMeshes) return
    const intensity = Math.max(0, Math.min(1, brightness / 255))
    const ledColor  = new THREE.Color(o.userData.ledColor ?? '#ff0000')
    for (const mesh of o.userData.emissiveMeshes) {
      if (!mesh.material) continue
      mesh.material.emissive.copy(ledColor).multiplyScalar(intensity)
      mesh.material.emissiveIntensity = intensity * 3  // ×3 so it visibly glows
    }
  }

  // Turn off all LEDs — called when simulation stops
  resetAllLeds() {
    for (const [id, o] of this.objects) {
      if (o.userData.emissiveMeshes) this.animateLed(id, 0)
    }
  }

  // ── Selection highlights ──────────────────────────────────────────────────

  setSelectionHighlights(primaryId, secondaryId) {
    this.objects.forEach((o, id) => {
      const emissive = id === primaryId
        ? new THREE.Color(0x1a2a66)
        : id === secondaryId
          ? new THREE.Color(0x662a00)
          : new THREE.Color(0x000000)

      o.traverse(child => {
        if (child.isMesh && child.material?.emissive !== undefined) {
          child.material.emissive.copy(emissive)
        }
      })
    })
  }

  clearHighlight() {
    this.setSelectionHighlights(null, null)
  }

  setHighlight(id) {
    this.setSelectionHighlights(id, null)
  }

  // ── Wires ─────────────────────────────────────────────────────────────────

  addWire(connId, line) {
    this.scene.add(line)
    this.wires.set(connId, line)
  }

  removeWire(connId) {
    const line = this.wires.get(connId)
    if (!line) return
    this.scene.remove(line)
    line.geometry.dispose()
    line.material.dispose()
    this.wires.delete(connId)
  }

  getWire(connId) {
    return this.wires.get(connId)
  }

  // ── Remove ────────────────────────────────────────────────────────────────

  removeMesh(id) {
    const o = this.objects.get(id)
    if (!o) return

    // Motor deleted → detach any objects riding its rotor back to the scene
    if (MOTOR_TYPES.has(o.userData.type)) {
      for (const [attachedId, motorId] of this.attachedObjects) {
        if (motorId === id) this.detachMeshFromRotor(attachedId)
      }
    }

    // Unregister pins before removing
    if (ELECTRONICS.has(o.userData.type)) {
      wireManager.unregisterComponent(id)
    }

    // If this object itself is attached, just remove from the rotor group's children list
    if (this.attachedObjects.has(id)) {
      this.attachedObjects.delete(id)
    }

    // removeFromParent works whether parent is the scene or a rotorGroup
    o.removeFromParent()
    o.traverse(child => {
      if (child.isMesh) {
        child.geometry?.dispose()
        child.material?.dispose()
      }
    })
    this.objects.delete(id)
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  // ── Motor shaft manual picker ─────────────────────────────────────────────

  getMotorMeshNames(id) {
    return this.objects.get(id)?.userData.motorMeshNames ?? []
  }

  setMotorShaft(id, meshName) {
    const o = this.objects.get(id)
    if (!o) return false
    let target = null
    o.traverse(c => { if (c.isMesh && c.name === meshName) target = c })
    if (!target) return false

    target.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(target)
    const s   = box.getSize(new THREE.Vector3())
    let axis = 'x'
    if (s.y > s.x && s.y > s.z) axis = 'y'
    else if (s.z > s.x && s.z > s.y) axis = 'z'

    // Shaft tip position in world/root space
    const tipPos = box.getCenter(new THREE.Vector3())
    tipPos[axis] = box.max[axis]

    // Remove old virtual group if it exists
    const old = o.userData.rotorGroup
    if (old && !old.isMesh) o.remove(old)

    // Create fresh virtual attachment group at shaft tip
    const vGroup = new THREE.Group()
    vGroup.position.copy(tipPos)
    o.add(vGroup)

    o.userData.rotorMesh        = target
    o.userData.rotorGroup       = vGroup
    o.userData.rotorAxis        = axis
    o.userData.currentRotorName = meshName
    return true
  }

  getMesh(id) { return this.objects.get(id) }

  getAllMeshes() { return Array.from(this.objects.values()) }

  // Resolve a clicked child back to the root id
  resolveId(object3d) {
    if (object3d.userData.id) return object3d.userData.id
    if (object3d.userData.rootId) return object3d.userData.rootId
    let cur = object3d.parent
    while (cur) {
      if (cur.userData.id) return cur.userData.id
      cur = cur.parent
    }
    return null
  }

  clearAll() {
    for (const id of [...this.objects.keys()]) this.removeMesh(id)
    for (const id of [...this.wires.keys()]) this.removeWire(id)
  }
}

export const objectManager = new ObjectManager()
