// Direct manipulation on the workplane (Tinkercad style):
//   • left-drag a part  → slide it (and everything selected with it) on the grid
//   • left-drag on empty space → rubber-band box; parts it touches get selected
// Camera: right-drag orbits, middle-drag (or Shift+right-drag) pans, wheel
// zooms; Alt+left-drag also orbits for one-button mice / trackpads.
import * as THREE from 'three'
import { useSceneStore, selectedIdsOf } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { sceneManager } from './SceneManager.js'
import { objectManager } from './ObjectManager.js'
import { recordSnapshot } from './history/editorDispatch.js'

export const DRAG_THRESHOLD_PX = 4

/** Tinkercad mouse mapping. Called on every mouse-down (before OrbitControls). */
export function applyMouseMapping(e) {
  const oc = sceneManager.orbitControls
  if (!oc) return
  oc.mouseButtons.LEFT = e.altKey ? THREE.MOUSE.ROTATE : -1     // -1 = OrbitControls ignores the button
  oc.mouseButtons.MIDDLE = THREE.MOUSE.PAN
  oc.mouseButtons.RIGHT = e.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
}

const ray = new THREE.Raycaster()
function planeHit(e, bounds, plane) {
  const ndc = new THREE.Vector2(((e.clientX - bounds.left) / bounds.width) * 2 - 1, -((e.clientY - bounds.top) / bounds.height) * 2 + 1)
  ray.setFromCamera(ndc, sceneManager.camera)
  const p = new THREE.Vector3()
  return ray.ray.intersectPlane(plane, p) ? p : null
}

// A bonded part moves its whole welded assembly: drag the root of its bond chain
// (children follow through the per-frame bond pass).
function bondRoot(id) {
  const bonds = useRigidStore.getState().getBonds()
  let cur = id
  for (let i = 0; i < 32; i++) {
    const b = bonds.find((x) => x.childId === cur)
    if (!b) break
    cur = b.parentId
  }
  return cur
}

const movable = (o) => o && !o.locked && !useElectronicsStore.getState().attachments[o.id]

// Write the new pose of every part welded under `rootId` into the store (the
// per-frame bond pass only moves meshes) — so a slid assembly saves where it is.
function propagateFrom(rootId) {
  const bonds = useRigidStore.getState().getBonds()
  const s = useSceneStore.getState()
  const queue = [rootId], seen = new Set(queue)
  while (queue.length) {
    const id = queue.shift()
    for (const b of bonds) {
      if (b.parentId !== id || seen.has(b.childId)) continue
      const r = objectManager.propagateBond(id, b.relativeMatrix, true, b.childId)
      if (r) s.updateObject(b.childId, r)
      seen.add(b.childId); queue.push(b.childId)
    }
  }
}

// ── Slide on the grid ─────────────────────────────────────────────────────────
let drag = null   // { ids, starts: Map(id → position), plane, from: Vector3 }

/** Start sliding the part under the cursor (selecting it first if needed). */
export function beginSlide(e, bounds, hitId) {
  const s = useSceneStore.getState()
  let sel = selectedIdsOf(s)
  if (!sel.includes(hitId)) { s.selectObject(hitId); sel = [hitId] }
  const byId = new Map(s.objects.map((o) => [o.id, o]))
  // A locked part stays put — and so does the assembly it is welded into
  // (dragging it must not slide the unlocked chassis it hangs on).
  const ids = [...new Set(sel.filter((id) => movable(byId.get(id))).map(bondRoot))].filter((id) => movable(byId.get(id)))
  if (!ids.length) return false
  const mesh = objectManager.getMesh(hitId)
  const y = mesh ? new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).y : 0
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)
  const from = planeHit(e, bounds, plane)
  if (!from) return false
  drag = { ids, plane, from, starts: new Map(ids.map((id) => [id, { ...byId.get(id).position }])) }
  if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = false
  return true
}

export function updateSlide(e, bounds) {
  if (!drag) return
  const p = planeHit(e, bounds, drag.plane)
  if (!p) return
  const step = useUiStore.getState().snapTranslate
  const snap = (v) => (step > 0 ? Math.round(v / step) * step : v)
  const dx = snap(p.x - drag.from.x), dz = snap(p.z - drag.from.z)
  const s = useSceneStore.getState()
  for (const id of drag.ids) {
    const st = drag.starts.get(id)
    const pos = { x: st.x + dx, y: st.y, z: st.z + dz }
    s.updateObject(id, { position: pos })
    const m = objectManager.getMesh(id)
    if (m) { m.position.set(pos.x, pos.y, pos.z); m.updateMatrixWorld(true) }
    propagateFrom(id)
  }
  sceneManager.requestRender?.(200)
}

export function endSlide() {
  if (!drag) return false
  const moved = drag.ids.some((id) => {
    const a = drag.starts.get(id), b = useSceneStore.getState().objects.find((o) => o.id === id)?.position
    return b && (a.x !== b.x || a.z !== b.z)
  })
  drag = null
  if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
  if (moved) recordSnapshot('Move')
  return true
}
export const isSliding = () => !!drag

// ── Box select ────────────────────────────────────────────────────────────────
/** Select every visible part whose on-screen box touches the rectangle (client px). */
export function boxSelect(rect, bounds, additive) {
  const cam = sceneManager.camera
  if (!cam) return
  const s = useSceneStore.getState()
  const hits = []
  const v = new THREE.Vector3()
  for (const o of s.objects) {
    if (o.visible === false) continue
    const m = objectManager.getMesh(o.id)
    if (!m || !m.parent) continue
    const box = new THREE.Box3().setFromObject(m)
    if (box.isEmpty()) continue
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = false
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam)
      if (v.z < 1) front = true
      const sx = bounds.left + ((v.x + 1) / 2) * bounds.width
      const sy = bounds.top + ((1 - v.y) / 2) * bounds.height
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy)
    }
    if (front && x1 >= rect.x0 && x0 <= rect.x1 && y1 >= rect.y0 && y0 <= rect.y1) hits.push(o.id)
  }
  const base = additive ? selectedIdsOf(s) : []
  s.setSelectionList([...base, ...hits.filter((id) => !base.includes(id))])
}
