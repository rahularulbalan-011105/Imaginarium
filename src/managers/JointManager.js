import * as THREE from 'three'
import { useJointStore } from '../stores/jointStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { sceneManager } from './SceneManager.js'

/**
 * JointManager — visual helpers + constraint solving for the mechanical joint system.
 *
 * Responsibilities:
 *  - Render joint markers (axes, cones, spheres) in the Three.js scene
 *  - Drive child objects when a joint is animated (hinge/revolute/slider/servo)
 *  - Propagate joint constraints up the hierarchy on each frame
 *  - Create/destroy Three.js helpers when joints are added/removed
 */

const _helpers = new Map()   // jointId → THREE.Group (visual helper)
const _pivotGroups = new Map() // jointId → { parent: THREE.Object3D, child: THREE.Object3D }
const _rest = new Map()      // jointId → { pos: Vector3, quat: Quaternion } child rest pose

class JointManager {
  constructor() {
    this.scene = null
    this.objectManager = null  // set by App after objectManager is initialized
  }

  init(scene, objectManager) {
    this.scene = scene
    this.objectManager = objectManager
  }

  // ── Visual helpers ────────────────────────────────────────────────────────

  _makeHelper(joint) {
    const group = new THREE.Group()
    group.userData.isJointHelper = true

    const { x, y, z } = joint.anchorPoint
    group.position.set(x, y, z)

    // Sphere at anchor point
    const sphereGeo = new THREE.SphereGeometry(0.18, 8, 6)
    const sphereMat = new THREE.MeshBasicMaterial({ color: joint.color ?? '#f59e0b', depthTest: false, transparent: true, opacity: 0.85 })
    group.add(new THREE.Mesh(sphereGeo, sphereMat))

    // Axis arrow (for joints that have an axis)
    if (['hinge', 'revolute', 'slider', 'servo'].includes(joint.type)) {
      const { x: ax, y: ay, z: az } = joint.axis
      const dir = new THREE.Vector3(ax, ay, az).normalize()
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 1.5, joint.color ?? '#f59e0b', 0.3, 0.15)
      group.add(arrow)
    }

    // Type label (as small sprite)
    group.visible = joint.visible !== false
    return group
  }

  showJoint(joint) {
    this.hideJoint(joint.id)
    if (!this.scene) return
    const helper = this._makeHelper(joint)
    _helpers.set(joint.id, helper)
    this.scene.add(helper)
  }

  hideJoint(jointId) {
    const h = _helpers.get(jointId)
    if (h) { h.removeFromParent(); _helpers.delete(jointId) }
  }

  updateHelperVisibility(jointId, visible) {
    const h = _helpers.get(jointId)
    if (h) h.visible = visible
  }

  refreshAll() {
    const joints = Object.values(useJointStore.getState().joints)
    joints.forEach(j => this.showJoint(j))
  }

  // ── Constraint solving ────────────────────────────────────────────────────

  /**
   * Apply joint constraints for all joints every frame.
   * Call this from the App.jsx animation loop AFTER propagateAllBonds().
   */
  step() {
    const joints = Object.values(useJointStore.getState().joints)

    // Don't fight the user: if a child is being dragged by the gizmo, let it move
    // freely and re-capture its rest pose so the joint resumes from the new spot.
    const tc = sceneManager.transformControls
    const draggingId = (tc?.dragging && tc.object?.userData?.id) ? tc.object.userData.id : null

    for (const joint of joints) {
      const parentMesh = this.objectManager?.getMesh(joint.parentId)
      const childMesh  = this.objectManager?.getMesh(joint.childId)
      if (!parentMesh || !childMesh) continue

      // If the PARENT is being dragged, let it move; the child follows via the
      // parent-relative math in _applyJointConstraint.
      // If the CHILD is dragged, drag the PARENT along rigidly so the welded pair
      // moves as one (joining makes them a single rigid assembly).
      if (draggingId && joint.childId === draggingId) {
        this._dragParentWithChild(joint, parentMesh, childMesh)
        continue
      }

      this._applyJointConstraint(joint, parentMesh, childMesh)
    }
  }

  // Capture the joint geometry RELATIVE TO THE PARENT, so that when the parent
  // moves/rotates, the anchor, axis and child rest pose all move with it.
  _captureRest(joint) {
    const parentMesh = this.objectManager?.getMesh(joint.parentId)
    const childMesh  = this.objectManager?.getMesh(joint.childId)
    if (!parentMesh || !childMesh) return
    parentMesh.updateMatrixWorld(true)
    childMesh.updateMatrixWorld(true)

    const invParent = parentMesh.matrixWorld.clone().invert()
    const Qp = parentMesh.getWorldQuaternion(new THREE.Quaternion())
    const QpInv = Qp.clone().invert()

    // anchor (world) → parent-local
    const anchorLocal = new THREE.Vector3(joint.anchorPoint.x, joint.anchorPoint.y, joint.anchorPoint.z)
      .applyMatrix4(invParent)
    // axis (world dir) → parent-local
    const axisLocal = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z)
    if (axisLocal.lengthSq() < 1e-6) axisLocal.set(0, 1, 0)
    axisLocal.applyQuaternion(QpInv).normalize()

    // child rest pose, expressed relative to the parent
    const childRel = invParent.clone().multiply(childMesh.matrixWorld)
    const cpos = new THREE.Vector3(), cquat = new THREE.Quaternion(), cscl = new THREE.Vector3()
    childRel.decompose(cpos, cquat, cscl)

    _rest.set(joint.id, {
      anchorLocal, axisLocal,
      childRelPos: cpos, childRelQuat: cquat,
      childRelMatrix: childRel.clone(),   // full matrix — used to drag parent rigidly
    })
  }

  _restPose(joint) {
    let r = _rest.get(joint.id)
    if (!r) { this._captureRest(joint); r = _rest.get(joint.id) }
    return r
  }

  _applyJointConstraint(joint, parentMesh, childMesh) {
    const rest = this._restPose(joint)
    if (!rest) return
    parentMesh.updateMatrixWorld(true)

    const Mp = parentMesh.matrixWorld
    const Qp = parentMesh.getWorldQuaternion(new THREE.Quaternion())

    // Re-derive world-space anchor / axis / child-rest from the CURRENT parent
    // pose — this is what makes the child follow when the parent moves.
    const anchor   = rest.anchorLocal.clone().applyMatrix4(Mp)
    const axis     = rest.axisLocal.clone().applyQuaternion(Qp).normalize()
    const restPos  = rest.childRelPos.clone().applyMatrix4(Mp)
    const restQuat = Qp.clone().multiply(rest.childRelQuat)

    const h = _helpers.get(joint.id)

    if (joint.type === 'hinge' || joint.type === 'revolute' || joint.type === 'servo') {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(joint.currentAngle))
      const off = restPos.clone().sub(anchor).applyQuaternion(q)
      childMesh.position.copy(anchor).add(off)
      childMesh.quaternion.copy(q).multiply(restQuat)

    } else if (joint.type === 'slider') {
      childMesh.position.copy(restPos).addScaledVector(axis, joint.currentPosition)
      childMesh.quaternion.copy(restQuat)

    } else if (joint.type === 'ball') {
      const b = joint.ballRot ?? { x: 0, y: 0, z: 0 }
      const e = new THREE.Euler(
        THREE.MathUtils.degToRad(b.x),
        THREE.MathUtils.degToRad(b.y),
        THREE.MathUtils.degToRad(b.z),
        'XYZ'
      )
      const q = new THREE.Quaternion().setFromEuler(e)
      const off = restPos.clone().sub(anchor).applyQuaternion(q)
      childMesh.position.copy(anchor).add(off)
      childMesh.quaternion.copy(q).multiply(restQuat)

    } else {
      // fixed — child stays rigidly glued to the parent
      childMesh.position.copy(restPos)
      childMesh.quaternion.copy(restQuat)
    }
    if (h) h.position.copy(anchor)
  }

  // While the user drags the CHILD, move the PARENT so their relative pose stays
  // fixed — the whole jointed assembly translates/rotates together.
  _dragParentWithChild(joint, parentMesh, childMesh) {
    const rest = this._restPose(joint)
    if (!rest?.childRelMatrix) return
    childMesh.updateMatrixWorld(true)

    // childWorld = parentWorld * childRel  →  parentWorld = childWorld * childRel⁻¹
    const Pw = childMesh.matrixWorld.clone().multiply(rest.childRelMatrix.clone().invert())
    const ppos = new THREE.Vector3(), pquat = new THREE.Quaternion(), pscl = new THREE.Vector3()
    Pw.decompose(ppos, pquat, pscl)

    parentMesh.position.copy(ppos)
    parentMesh.quaternion.copy(pquat)   // leave parent scale untouched
    parentMesh.updateMatrixWorld(true)

    const pe = new THREE.Euler().setFromQuaternion(pquat, 'XYZ')
    useSceneStore.getState().updateObject(joint.parentId, {
      position: { x: ppos.x, y: ppos.y, z: ppos.z },
      rotation: { x: pe.x, y: pe.y, z: pe.z },
    })

    // Keep the anchor marker glued to the moving assembly
    const h = _helpers.get(joint.id)
    if (h) h.position.copy(rest.anchorLocal.clone().applyMatrix4(parentMesh.matrixWorld))
  }

  // ── Drive API ─────────────────────────────────────────────────────────────

  /** Animate a joint to a target value. Updates store + immediate Three.js visual. */
  driveJoint(jointId, value) {
    useJointStore.getState().driveJoint(jointId, value)
    const joint = useJointStore.getState().joints[jointId]
    if (!joint) return

    const parentMesh = this.objectManager?.getMesh(joint.parentId)
    const childMesh  = this.objectManager?.getMesh(joint.childId)
    if (parentMesh && childMesh) this._applyJointConstraint(joint, parentMesh, childMesh)
  }

  /** Drive one rotation axis of a ball joint (deg). */
  driveBall(jointId, axis, value) {
    useJointStore.getState().driveBall(jointId, axis, value)
    const joint = useJointStore.getState().joints[jointId]
    if (!joint) return
    const parentMesh = this.objectManager?.getMesh(joint.parentId)
    const childMesh  = this.objectManager?.getMesh(joint.childId)
    if (parentMesh && childMesh) this._applyJointConstraint(joint, parentMesh, childMesh)
  }

  // ── Create joint from two selected objects ────────────────────────────────

  /**
   * Create a joint between two objects.
   * Anchor point = midpoint between the two object centers.
   */
  createJoint(parentId, childId, type = 'hinge') {
    const parentMesh = this.objectManager?.getMesh(parentId)
    const childMesh  = this.objectManager?.getMesh(childId)

    let anchor = { x: 0, y: 0, z: 0 }
    if (parentMesh && childMesh) {
      const mid = parentMesh.position.clone().add(childMesh.position).multiplyScalar(0.5)
      anchor = { x: mid.x, y: mid.y, z: mid.z }
    }

    const jointId = useJointStore.getState().addJoint(parentId, childId, anchor, type)
    const joint = useJointStore.getState().joints[jointId]
    this._captureRest(joint)
    this.showJoint(joint)
    return jointId
  }

  /**
   * Fusion-style joint from two picked features (corner/edge/face).
   * Snaps the child's feature onto the parent's feature, then infers the joint
   * type and the axis of allowed motion from the parent feature:
   *   corner → ball (pivots about the point)
   *   edge   → slider (slides along the edge direction)
   *   face   → hinge (rotates about the face normal)
   */
  createFeatureJoint(featA, featB) {
    const parentId = featA.objectId, childId = featB.objectId
    if (parentId === childId) return null
    const parentMesh = this.objectManager?.getMesh(parentId)
    const childMesh  = this.objectManager?.getMesh(childId)
    if (!parentMesh || !childMesh) return null
    childMesh.updateMatrixWorld(true)

    const pA = new THREE.Vector3(featA.point.x, featA.point.y, featA.point.z)
    const pB = new THREE.Vector3(featB.point.x, featB.point.y, featB.point.z)

    // ── Mate: rotate + translate the child so its picked feature lands flush on
    // the parent's. Faces are made to OPPOSE (touch, not overlap); edges align
    // parallel; corners just meet at the point.
    let q = new THREE.Quaternion()
    if (featA.dir && featB.dir) {
      const dirA = new THREE.Vector3(featA.dir.x, featA.dir.y, featA.dir.z).normalize()
      const dirB = new THREE.Vector3(featB.dir.x, featB.dir.y, featB.dir.z).normalize()
      const target = featA.kind === 'face' ? dirA.clone().negate() : dirA.clone()
      // setFromUnitVectors is unstable for exactly-opposite vectors — nudge if so
      if (dirB.clone().add(target).lengthSq() < 1e-6) {
        const ortho = Math.abs(dirB.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
        const axisPerp = new THREE.Vector3().crossVectors(dirB, ortho).normalize()
        q = new THREE.Quaternion().setFromAxisAngle(axisPerp, Math.PI)
      } else {
        q = new THREE.Quaternion().setFromUnitVectors(dirB, target)
      }
    }
    const rB     = pB.clone().sub(childMesh.position).applyQuaternion(q)
    const newPos = pA.clone().sub(rB)
    const newQuat = q.clone().multiply(childMesh.quaternion)

    childMesh.position.copy(newPos)
    childMesh.quaternion.copy(newQuat)
    const euler = new THREE.Euler().setFromQuaternion(newQuat, 'XYZ')
    useSceneStore.getState().updateObject(childId, {
      position: { x: newPos.x, y: newPos.y, z: newPos.z },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
    })

    // Infer the joint type + motion axis from the PARENT feature
    let type = 'ball'
    let axis = { x: 0, y: 1, z: 0 }
    if (featA.kind === 'edge')      { type = 'slider'; if (featA.dir) axis = { ...featA.dir } }
    else if (featA.kind === 'face') { type = 'hinge';  if (featA.dir) axis = { ...featA.dir } }

    const anchor = { x: pA.x, y: pA.y, z: pA.z }
    const limits = type === 'slider'
      ? { minAngle: -90, maxAngle: 90, minDist: -3, maxDist: 3 }
      : { minAngle: -180, maxAngle: 180, minDist: -5, maxDist: 5 }

    const jointId = useJointStore.getState().addJoint(parentId, childId, anchor, type, {
      axis, featureKind: featA.kind, limits,
    })
    const joint = useJointStore.getState().joints[jointId]
    childMesh.updateMatrixWorld(true)
    this._captureRest(joint)
    this.showJoint(joint)
    return jointId
  }

  removeJoint(jointId) {
    this.hideJoint(jointId)
    _rest.delete(jointId)
    useJointStore.getState().removeJoint(jointId)
  }

  dispose() {
    _helpers.forEach(h => h.removeFromParent())
    _helpers.clear()
    _rest.clear()
  }
}

export const jointManager = new JointManager()
