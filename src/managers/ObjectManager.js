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

    // Keep attachmentOffset in userData in sync with Zustand
    if (obj.attachmentOffset !== undefined) {
      o.userData.attachmentOffset = obj.attachmentOffset
    }

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

    const ap = mesh.userData.attachmentOffset

    if (ap?.normal) {
      // ── Face-flush / perpendicular-to-shaft attachment ──────────────────────
      const rotorAxis = motorMesh.userData.rotorAxis ?? 'y'

      // Shaft direction in WORLD space (motor may be rotated, so apply rotorWorldQuat)
      const shaftDirLocal = new THREE.Vector3()
      shaftDirLocal[rotorAxis] = 1
      const shaftDirWorld = shaftDirLocal.clone().applyQuaternion(rotorWorldQuat)

      // Face normal from mesh local → world space
      const faceNormalWorld = new THREE.Vector3(ap.normal.x, ap.normal.y, ap.normal.z)
        .normalize().applyQuaternion(worldQuat)

      // Rotate so the picked face becomes perpendicular to the shaft
      // (face normal anti-parallel to shaft direction = face plane ⊥ shaft axis).
      // Do this entirely in world space, then convert to rotor-local once.
      let alignedWorldQuat = worldQuat.clone()
      if (faceNormalWorld.lengthSq() > 0.0001) {
        const alignQuat = new THREE.Quaternion()
          .setFromUnitVectors(faceNormalWorld, shaftDirWorld.clone().negate())
        alignedWorldQuat = alignQuat.multiply(worldQuat)
      }
      const newLocalQuat = rotorWorldQuat.clone().invert().multiply(alignedWorldQuat)

      // Offset: move mesh so the picked point lands at the shaft tip (rotorGroup origin)
      const attachPt = new THREE.Vector3(
        ap.x * mesh.scale.x,
        ap.y * mesh.scale.y,
        ap.z * mesh.scale.z
      ).applyQuaternion(newLocalQuat)

      if (mesh.parent) mesh.parent.remove(mesh)
      rotorGroup.add(mesh)
      mesh.position.copy(new THREE.Vector3().sub(attachPt))
      mesh.quaternion.copy(newLocalQuat)
      this.attachedObjects.set(objectId, motorId)
      return true
    }

    // ── Standard snap-based attachment (no face picked) ────────────────────────
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
        if (alignX === 'front') localPos.x = snapX - maxXc
        if (alignX === 'back')  localPos.x = snapX - minXc
      }
    }

    // Simple offset (attachment point set but no face normal)
    if (ap) {
      const offset = new THREE.Vector3(ap.x * mesh.scale.x, ap.y * mesh.scale.y, ap.z * mesh.scale.z)
      offset.applyQuaternion(localQuat)
      localPos.sub(offset)
    }

    if (mesh.parent) mesh.parent.remove(mesh)
    rotorGroup.add(mesh)
    mesh.position.copy(localPos)
    mesh.quaternion.copy(localQuat)
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

  // ── Attachment-point marker ───────────────────────────────────────────────

  setAttachmentMarker(id, localPos) {
    const o = this.objects.get(id)
    if (!o) return
    this.clearAttachmentMarker(id)
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff6600, depthTest: false, transparent: true, opacity: 0.9 })
    )
    marker.position.copy(localPos)
    marker.userData.isAttachMarker = true
    o.add(marker)
    o.userData.attachMarker = marker
  }

  clearAttachmentMarker(id) {
    const o = this.objects.get(id)
    if (!o?.userData.attachMarker) return
    o.remove(o.userData.attachMarker)
    o.userData.attachMarker.geometry?.dispose()
    o.userData.attachMarker.material?.dispose()
    delete o.userData.attachMarker
  }

  // ── Surface-to-surface rigid attach ──────────────────────────────────────

  // Align patchB's object so its surface is face-to-face with patchA's surface.
  // patchA stays fixed; patchB's object is moved/rotated.
  // Returns { position, rotation } for the Zustand store update, or null on failure.
  attachBySurface(patchA, patchB) {
    const meshA = this.objects.get(patchA.objectId)
    const meshB = this.objects.get(patchB.objectId)
    if (!meshA || !meshB) return null

    meshA.updateMatrixWorld(true)
    meshB.updateMatrixWorld(true)

    // World-space center and outward normal of patch A
    const wqA = new THREE.Quaternion(); meshA.getWorldQuaternion(wqA)
    const nA  = new THREE.Vector3(patchA.localNormal.x, patchA.localNormal.y, patchA.localNormal.z)
      .applyQuaternion(wqA).normalize()
    const cA  = new THREE.Vector3(patchA.localCenter.x, patchA.localCenter.y, patchA.localCenter.z)
      .applyMatrix4(meshA.matrixWorld)

    // World-space center and outward normal of patch B
    const wqB = new THREE.Quaternion(); meshB.getWorldQuaternion(wqB)
    const nB  = new THREE.Vector3(patchB.localNormal.x, patchB.localNormal.y, patchB.localNormal.z)
      .applyQuaternion(wqB).normalize()
    const cB  = new THREE.Vector3(patchB.localCenter.x, patchB.localCenter.y, patchB.localCenter.z)
      .applyMatrix4(meshB.matrixWorld)

    // Step 1: Rotate meshB so nB → -nA (patches face each other)
    const rotQ       = new THREE.Quaternion().setFromUnitVectors(nB, nA.clone().negate())
    const newWorldQB = rotQ.clone().multiply(wqB)

    // Step 2: Translate meshB so cB (after rotation) lands on cA
    const meshBPos = new THREE.Vector3(); meshB.getWorldPosition(meshBPos)
    const newCB    = cB.clone().sub(meshBPos).applyQuaternion(rotQ).add(meshBPos)
    const newPos   = meshBPos.clone().add(cA.clone().sub(newCB))

    meshB.position.copy(newPos)
    meshB.quaternion.copy(newWorldQB)
    meshB.updateMatrixWorld(true)
    meshA.updateMatrixWorld(true)

    // Relative transform: child (B) expressed in parent (A)'s local space
    const relMat = meshA.matrixWorld.clone().invert().multiply(meshB.matrixWorld)

    const euler = new THREE.Euler().setFromQuaternion(newWorldQB)
    return {
      position: { x: newPos.x,   y: newPos.y,   z: newPos.z   },
      rotation: { x: euler.x,    y: euler.y,     z: euler.z    },
      relativeMatrix: relMat.toArray(),
    }
  }

  // Compute the new world-space position+rotation for the dependent object in a
  // rigid bond when the "mover" object has just been transformed.
  // isPar = true  → mover is parent, compute child's new world pose
  // isPar = false → mover is child,  compute parent's new world pose
  // Returns { position, rotation } ready for updateObject(), or null on failure.
  propagateBond(moverId, relativeMatrix, isPar, depId) {
    const moverMesh = this.objects.get(moverId)
    const depMesh   = this.objects.get(depId)
    if (!moverMesh || !depMesh) return null

    moverMesh.updateMatrixWorld(true)
    const relMat = new THREE.Matrix4().fromArray(relativeMatrix)
    const newWorldMat = isPar
      ? moverMesh.matrixWorld.clone().multiply(relMat)                   // child = parent × rel
      : moverMesh.matrixWorld.clone().multiply(relMat.clone().invert())  // parent = child × rel⁻¹

    const pos  = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl  = new THREE.Vector3()
    newWorldMat.decompose(pos, quat, scl)
    const euler = new THREE.Euler().setFromQuaternion(quat)

    // Apply directly to mesh for immediate visual response
    depMesh.position.copy(pos)
    depMesh.rotation.set(euler.x, euler.y, euler.z)
    depMesh.updateMatrixWorld(true)

    return {
      position: { x: pos.x,   y: pos.y,   z: pos.z   },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
    }
  }

  // Rotate selectedId by angleDeg degrees around the bond's contact-surface normal,
  // pivoting at the contact point so the face stays in place.
  // Returns { position, rotation, relativeMatrix } for store updates, or null.
  rotateBondedObjectOnSurface(selectedId, bond, angleDeg = 90) {
    const { parentId, childId, contactLocalNormal, contactLocalCenter } = bond
    const parentMesh = this.objects.get(parentId)
    const childMesh  = this.objects.get(childId)
    if (!parentMesh || !childMesh || !contactLocalNormal || !contactLocalCenter) return null

    parentMesh.updateMatrixWorld(true)
    childMesh.updateMatrixWorld(true)

    // Contact point and outward normal in world space (always stored in parent's local space)
    const parentWorldQuat = new THREE.Quaternion()
    parentMesh.getWorldQuaternion(parentWorldQuat)

    const contactWorld = new THREE.Vector3(
      contactLocalCenter.x, contactLocalCenter.y, contactLocalCenter.z
    ).applyMatrix4(parentMesh.matrixWorld)

    const normalWorld = new THREE.Vector3(
      contactLocalNormal.x, contactLocalNormal.y, contactLocalNormal.z
    ).applyQuaternion(parentWorldQuat).normalize()

    const rotQ  = new THREE.Quaternion().setFromAxisAngle(normalWorld, angleDeg * Math.PI / 180)
    const tPos  = new THREE.Matrix4().makeTranslation(contactWorld.x, contactWorld.y, contactWorld.z)
    const tNeg  = new THREE.Matrix4().makeTranslation(-contactWorld.x, -contactWorld.y, -contactWorld.z)
    const rMat  = new THREE.Matrix4().makeRotationFromQuaternion(rotQ)
    const pivot = new THREE.Matrix4().copy(tPos).multiply(rMat).multiply(tNeg)

    const selectedMesh = this.objects.get(selectedId)
    if (!selectedMesh) return null

    const newWorldMat = pivot.clone().multiply(selectedMesh.matrixWorld.clone())
    const pos  = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl  = new THREE.Vector3()
    newWorldMat.decompose(pos, quat, scl)
    const euler = new THREE.Euler().setFromQuaternion(quat)

    selectedMesh.position.copy(pos)
    selectedMesh.rotation.set(euler.x, euler.y, euler.z)
    selectedMesh.updateMatrixWorld(true)

    // Recompute relative matrix so future bond propagation reflects the new orientation
    parentMesh.updateMatrixWorld(true)
    childMesh.updateMatrixWorld(true)
    const newRelMat = parentMesh.matrixWorld.clone().invert().multiply(childMesh.matrixWorld)

    return {
      position:       { x: pos.x,   y: pos.y,   z: pos.z   },
      rotation:       { x: euler.x, y: euler.y, z: euler.z },
      relativeMatrix: newRelMat.toArray(),
    }
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
