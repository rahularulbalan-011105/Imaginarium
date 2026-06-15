export const r3 = (v) => Math.round(v * 1000) / 1000

export function vec3FromObject(obj) {
  return { x: r3(obj.x), y: r3(obj.y), z: r3(obj.z) }
}

export function radToDeg(r) { return (r * 180) / Math.PI }
export function degToRad(d) { return (d * Math.PI) / 180 }

// Round each rotation axis to the nearest 90° increment (keeps 0, 90, 180, 270)
export function snapRotationToAxes(rotation) {
  const snap = (rad) => {
    const deg = radToDeg(rad)
    return degToRad(Math.round(deg / 90) * 90)
  }
  return { x: snap(rotation.x), y: snap(rotation.y), z: snap(rotation.z) }
}

export function buildProjectSnapshot(sceneState, electronicsState) {
  return {
    projectId: sceneState.projectId,
    name: sceneState.projectName,
    version: '1.0',
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    objects: sceneState.objects,
    settings: {
      gridVisible: sceneState.gridVisible,
      axesVisible: sceneState.axesVisible,
    },
    electronics: electronicsState ? {
      connections: electronicsState.connections,
      code: electronicsState.code,
      attachments: electronicsState.attachments,
    } : undefined,
  }
}
