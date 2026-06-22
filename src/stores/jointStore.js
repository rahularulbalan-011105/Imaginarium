import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'

export const JOINT_TYPES = {
  fixed:    { label: 'Fixed',    icon: '🔒', hasAxis: false, hasLimits: false, motorized: false },
  hinge:    { label: 'Hinge',    icon: '🔄', hasAxis: true,  hasLimits: true,  motorized: false },
  revolute: { label: 'Revolute', icon: '↻',  hasAxis: true,  hasLimits: true,  motorized: true  },
  slider:   { label: 'Slider',   icon: '↔',  hasAxis: true,  hasLimits: true,  motorized: true  },
  ball:     { label: 'Ball',     icon: '⚽', hasAxis: false, hasLimits: true,  motorized: false },
  servo:    { label: 'Servo',    icon: '⚙',  hasAxis: true,  hasLimits: true,  motorized: true  },
}

const defaultJoint = (parentId, childId, anchorPoint) => ({
  id: uuidv4(),
  type: 'hinge',
  parentId,
  childId,
  featureKind: null,        // 'corner' | 'edge' | 'face' — how it was created (Fusion-style)
  anchorPoint: anchorPoint ?? { x: 0, y: 0, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  limits: { minAngle: -90, maxAngle: 90, minDist: 0, maxDist: 5 },
  motorSettings: { motorized: false, speed: 45, torque: 1.0, targetAngle: 0 },
  currentAngle: 0,
  currentPosition: 0,
  ballRot: { x: 0, y: 0, z: 0 },   // ball joint — independent rotation about each axis (°)
  visible: true,
  color: '#f59e0b',
})

export const useJointStore = create((set, get) => ({
  joints: {},   // jointId → joint object

  addJoint(parentId, childId, anchorPoint, type = 'hinge', extra = {}) {
    const joint = { ...defaultJoint(parentId, childId, anchorPoint), type, ...extra }
    set(s => ({ joints: { ...s.joints, [joint.id]: joint } }))
    return joint.id
  },

  updateJoint(id, updates) {
    set(s => ({
      joints: { ...s.joints, [id]: { ...s.joints[id], ...updates } },
    }))
  },

  removeJoint(id) {
    set(s => {
      const j = { ...s.joints }
      delete j[id]
      return { joints: j }
    })
  },

  removeJointsForObject(objectId) {
    set(s => ({
      joints: Object.fromEntries(
        Object.entries(s.joints).filter(
          ([, j]) => j.parentId !== objectId && j.childId !== objectId
        )
      ),
    }))
  },

  setJoints(joints) { set({ joints }) },

  getJointsForObject(objectId) {
    return Object.values(get().joints).filter(
      j => j.parentId === objectId || j.childId === objectId
    )
  },

  getChildrenOf(parentId) {
    return Object.values(get().joints)
      .filter(j => j.parentId === parentId)
      .map(j => j.childId)
  },

  // Drive a joint to a target value (angle for rotational, distance for slider)
  driveJoint(id, value) {
    set(s => {
      const j = s.joints[id]
      if (!j) return {}
      const isRotational = ['hinge', 'revolute', 'servo'].includes(j.type)
      const isSlider = j.type === 'slider'
      const clamped = isRotational
        ? Math.max(j.limits.minAngle, Math.min(j.limits.maxAngle, value))
        : isSlider
          ? Math.max(j.limits.minDist, Math.min(j.limits.maxDist, value))
          : value
      return {
        joints: {
          ...s.joints,
          [id]: {
            ...j,
            currentAngle: isRotational ? clamped : j.currentAngle,
            currentPosition: isSlider ? clamped : j.currentPosition,
            motorSettings: { ...j.motorSettings, targetAngle: isRotational ? clamped : j.motorSettings.targetAngle },
          },
        },
      }
    })
  },

  // Ball joint — set rotation about one axis (deg) through the pivot point
  driveBall(id, axis, value) {
    set(s => {
      const j = s.joints[id]
      if (!j) return {}
      const lim = j.limits ?? {}
      const clamped = Math.max(lim.minAngle ?? -180, Math.min(lim.maxAngle ?? 180, value))
      return {
        joints: { ...s.joints, [id]: { ...j, ballRot: { ...j.ballRot, [axis]: clamped } } },
      }
    })
  },
}))
