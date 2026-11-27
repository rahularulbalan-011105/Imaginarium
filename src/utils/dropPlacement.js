// Drag-and-drop from the libraries into the 3D workspace.
//
// A library card sets DRAG_MIME = JSON { type, variant? } on dragstart; the
// viewport's drop handler turns the cursor position into a point on the
// workplane (y = 0) and creates the object there.
import * as THREE from 'three'

export const DRAG_MIME = 'application/x-constructa-object'

export function setDragPayload(e, payload) {
  try {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
  } catch { /* old browsers: click-to-add still works */ }
}

export function readDragPayload(e) {
  try {
    const raw = e.dataTransfer?.getData(DRAG_MIME)
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && typeof p.type === 'string' ? p : null
  } catch { return null }
}

/**
 * Where a screen point lands on the horizontal plane y = planeY. Returns null
 * when the ray is parallel to (or points away from) the plane.
 */
export function screenToPlane(clientX, clientY, rect, camera, planeY = 0) {
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), hit) ? hit : null
}
