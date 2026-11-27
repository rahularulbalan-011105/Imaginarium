// Click-to-place (Tinkercad style). Choosing a shape or part in a library no
// longer drops it at a fixed spawn point — it "picks it up": a marker follows
// the mouse over the workplane and a click on the grid puts it there (Shift
// keeps placing more of the same; Esc cancels). Dragging a library card onto
// the 3D view does the same in one gesture.
//
// The library decides HOW a part is created (`create`); this module only
// decides WHERE. `create()` must add the object(s) and return the new scene
// object (or its id) — its default height (which already rests it on the
// workplane) is kept, only x/z move to the chosen point.
import * as THREE from 'three'
import { create } from 'zustand'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { sceneManager } from './SceneManager.js'
import { recordSnapshot } from './history/editorDispatch.js'

export const usePlacement = create(() => ({ pending: null }))   // { key, label, create }

export function beginPlacement(p) {
  const cur = usePlacement.getState().pending
  // Choosing the same card again puts it back down (cancels).
  if (cur && cur.key === p.key) { cancelPlacement(); return }
  usePlacement.setState({ pending: p })
}

export function cancelPlacement() {
  usePlacement.setState({ pending: null })
  hideMarker()
}

const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const ray = new THREE.Raycaster()

/** Workplane point under a mouse/drag event, snapped to the move-snap step (else 0.5). */
export function groundPointFromEvent(e, bounds) {
  const cam = sceneManager.camera
  if (!cam) return null
  const ndc = new THREE.Vector2(
    ((e.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((e.clientY - bounds.top) / bounds.height) * 2 + 1,
  )
  ray.setFromCamera(ndc, cam)
  const hit = new THREE.Vector3()
  if (!ray.ray.intersectPlane(ground, hit)) return null
  const step = useUiStore.getState().snapTranslate || 0.5
  return { x: Math.round(hit.x / step) * step, z: Math.round(hit.z / step) * step }
}

/** Where the camera is looking, on the workplane — for keyboard users ("put it in the middle"). */
export function viewCenterPoint() {
  const t = sceneManager.orbitControls?.target
  const step = useUiStore.getState().snapTranslate || 0.5
  return t ? { x: Math.round(t.x / step) * step, z: Math.round(t.z / step) * step } : { x: 0, z: 0 }
}

/** Create the pending part at `pt` ({x, z}). Shift (`keep`) stays in placing mode. */
export async function placeAt(pt, keep = false) {
  const p = usePlacement.getState().pending
  if (!p || !pt) return null
  if (!keep) cancelPlacement()            // clear first so a second click can't place twice
  const made = await p.create()
  const id = typeof made === 'string' ? made : made?.id
  const scene = useSceneStore.getState()
  const obj = id && scene.objects.find((o) => o.id === id)
  if (obj) {
    scene.updateObject(obj.id, { position: { ...obj.position, x: pt.x, z: pt.z } })
    scene.selectObject(obj.id)
  }
  recordSnapshot(`Add ${p.label}`)
  return obj ?? null
}

/**
 * Props for a library card: click picks the part up (click again to put it
 * back), or drag the card onto the 3D view to drop it in one go.
 * `prepare` (optional) starts loading what `create` needs, e.g. a GLB.
 */
export function placeCardProps({ key, label, create, prepare }, pendingKey) {
  return {
    'aria-pressed': pendingKey === key,
    onClick: () => { prepare?.(); beginPlacement({ key, label, create }) },
    draggable: true,
    onDragStart: (e) => {
      prepare?.()
      usePlacement.setState({ pending: { key, label, create } })
      try { e.dataTransfer.setData('text/plain', label); e.dataTransfer.effectAllowed = 'copy' } catch { /* ignore */ }
    },
    onDragEnd: (e) => { if (e.dataTransfer?.dropEffect === 'none') cancelPlacement() },
  }
}

// ── The marker: a flat ring + cross on the workplane under the cursor ─────────
let marker = null
function ensureMarker() {
  if (marker || !sceneManager.scene) return marker
  marker = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide })
  const fill = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.12, depthTest: false, side: THREE.DoubleSide })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.1, 48), mat)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), fill)
  const barA = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.08), mat)
  const barB = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.7), mat)
  for (const m of [ring, disc, barA, barB]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 999; marker.add(m) }
  marker.position.y = 0.02
  marker.userData.isHelper = true
  marker.visible = false
  sceneManager.scene.add(marker)
  return marker
}

export function showMarkerAt(pt) {
  const m = ensureMarker()
  if (!m) return
  if (!pt) { hideMarker(); return }
  m.position.x = pt.x; m.position.z = pt.z
  m.visible = true
  sceneManager.requestRender?.(200)
}

export function hideMarker() {
  if (marker?.visible) { marker.visible = false; sceneManager.requestRender?.(200) }
}

// Esc puts the part back; switching to simulation cancels too.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && usePlacement.getState().pending) { e.stopPropagation(); cancelPlacement() }
  }, true)
  useUiStore.subscribe((s, prev) => { if (s.simActive && !prev.simActive) cancelPlacement() })
}
