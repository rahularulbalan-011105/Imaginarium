import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useJointStore } from '../stores/jointStore.js'
import { objectManager } from '../managers/ObjectManager.js'

export const r3 = (v) => Math.round(v * 1000) / 1000

export function vec3FromObject(obj) {
  return { x: r3(obj.x), y: r3(obj.y), z: r3(obj.z) }
}

export function radToDeg(r) { return (r * 180) / Math.PI }
export function degToRad(d) { return (d * Math.PI) / 180 }

export function snapRotationToAxes(rotation) {
  const snap = (rad) => {
    const deg = radToDeg(rad)
    return degToRad(Math.round(deg / 90) * 90)
  }
  return { x: snap(rotation.x), y: snap(rotation.y), z: snap(rotation.z) }
}

export function buildProjectSnapshot(sceneState, electronicsState) {
  const surfaceState = useSurfaceStore.getState()
  const rigidState   = useRigidStore.getState()
  const jointState   = useJointStore.getState()
  const attachments  = electronicsState?.attachments ?? {}

  // For attached objects (wheels on a motor shaft) we store TWO things:
  //  • the live world position (so attachment-unaware loaders still place it),
  //  • the EXACT local transform inside the motor's rotor (`attach`), which is
  //    the ground truth used to restore the attachment perfectly on import.
  const objects = sceneState.objects.map(obj => {
    if (!attachments[obj.id]) return obj
    const wp = objectManager.getWorldPos(obj.id)
    const lt = objectManager.getAttachedLocalTransform(obj.id)
    const out = { ...obj }
    if (wp) out.position = { x: r3(wp.x), y: r3(wp.y), z: r3(wp.z) }
    if (lt) out.attach = { motorId: attachments[obj.id], ...lt }
    return out
  })

  return {
    projectId: sceneState.projectId,
    name: sceneState.projectName,
    version: '1.0',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    objects,
    settings: {
      gridVisible: sceneState.gridVisible,
      axesVisible: sceneState.axesVisible,
    },
    electronics: electronicsState ? {
      connections: electronicsState.connections,
      code: electronicsState.code,
      attachments: electronicsState.attachments,
    } : undefined,
    surface: { patches: surfaceState.patches },
    rigid:   { bonds:   rigidState.bonds   },
    joints:  { joints:  jointState.joints  },
  }
}
