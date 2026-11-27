// Edit actions on the current selection (one part or many) — shared by the
// edit toolbar, the selection inspector and the keyboard shortcuts, so a button
// and its shortcut can never behave differently. Every action records exactly
// one undo step.
import * as THREE from 'three'
import { create } from 'zustand'
import { useSceneStore, selectedIdsOf } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { recordSnapshot } from './history/editorDispatch.js'
import { objectManager } from './ObjectManager.js'
import { loadCSG } from '../utils/csgLib.js'
import { PIN_DEFS } from '../utils/electronicsFactory.js'

const scene = () => useSceneStore.getState()
const now = () => new Date().toISOString()
const isWired = (o) => !!PIN_DEFS[o.type] || o.type === 'subo' || o.type === 'esp32'

/** The selected scene objects, primary first. */
export function selectedObjects() {
  const s = scene()
  const byId = new Map(s.objects.map((o) => [o.id, o]))
  return selectedIdsOf(s).map((id) => byId.get(id)).filter(Boolean)
}

const cloneOf = (o, offset = { x: 2, z: 2 }) => ({
  ...JSON.parse(JSON.stringify(o)),
  id: crypto.randomUUID(),
  name: o.name.replace(/_copy.*$/, '') + '_copy',
  locked: false,
  position: { x: o.position.x + offset.x, y: o.position.y, z: o.position.z + offset.z },
  metadata: { createdAt: now(), updatedAt: now() },
})

// ── Clipboard ────────────────────────────────────────────────────────────────
let clipboard = []
/** Reactive clipboard size, so a Paste button can enable itself. */
export const useClipboard = create(() => ({ count: 0 }))

export function copySelection() {
  // Wired parts keep their pins/wires by id — copying them would make orphan
  // connections, so (as before) only shapes and mechanical parts are copied.
  clipboard = selectedObjects().filter((o) => !isWired(o)).map((o) => JSON.parse(JSON.stringify(o)))
  useClipboard.setState({ count: clipboard.length })
  return clipboard.length
}
export const canPaste = () => clipboard.length > 0

export function paste() {
  if (!clipboard.length) return
  const copies = clipboard.map((o) => cloneOf(o))
  const s = scene()
  for (const c of copies) s.insertObject(c)
  s.setSelectionList(copies.map((c) => c.id))
  clipboard = copies.map((c) => JSON.parse(JSON.stringify(c)))   // paste again → next step along
  recordSnapshot('Paste')
}

// ── Duplicate (Tinkercad smart duplicate for one part) ───────────────────────
// The FIRST duplicate offsets a copy; move/rotate/scale that copy and each
// further duplicate repeats the same step, building an array from one example.
let dupChain = null   // { newId, prev: { position, rotation, scale } }

export function duplicateSelection() {
  const sel = selectedObjects()
  if (!sel.length) return
  const s = scene()
  if (sel.length > 1) {
    const copies = sel.map((o) => cloneOf(o))
    for (const c of copies) s.insertObject(c)
    s.setSelectionList(copies.map((c) => c.id))
    dupChain = null
    recordSnapshot('Duplicate')
    return
  }
  const src = sel[0]
  const keep = (o) => ({ position: { ...o.position }, rotation: { ...o.rotation }, scale: { ...o.scale } })
  if (dupChain && dupChain.newId === src.id) {
    const p = dupChain.prev
    const dPos = { x: src.position.x - p.position.x, y: src.position.y - p.position.y, z: src.position.z - p.position.z }
    const dRot = { x: src.rotation.x - p.rotation.x, y: src.rotation.y - p.rotation.y, z: src.rotation.z - p.rotation.z }
    const dScl = { x: src.scale.x / (p.scale.x || 1), y: src.scale.y / (p.scale.y || 1), z: src.scale.z / (p.scale.z || 1) }
    const moved = Math.abs(dPos.x) + Math.abs(dPos.y) + Math.abs(dPos.z) +
                  Math.abs(dRot.x) + Math.abs(dRot.y) + Math.abs(dRot.z) +
                  Math.abs(dScl.x - 1) + Math.abs(dScl.y - 1) + Math.abs(dScl.z - 1) > 1e-6
    if (moved) {
      const clone = {
        ...cloneOf(src, { x: 0, z: 0 }),
        position: { x: src.position.x + dPos.x, y: src.position.y + dPos.y, z: src.position.z + dPos.z },
        rotation: { x: src.rotation.x + dRot.x, y: src.rotation.y + dRot.y, z: src.rotation.z + dRot.z },
        scale:    { x: src.scale.x * dScl.x,    y: src.scale.y * dScl.y,    z: src.scale.z * dScl.z },
      }
      s.insertObject(clone)
      dupChain = { newId: clone.id, prev: keep(src) }
      recordSnapshot('Duplicate')
      return
    }
  }
  const dupe = s.duplicateObject(src.id)
  if (dupe) { dupChain = { newId: dupe.id, prev: keep(src) }; recordSnapshot('Duplicate') }
}

// ── Delete ───────────────────────────────────────────────────────────────────
export function deleteSelection() {
  const sel = selectedObjects()
  if (!sel.length) return
  const s = scene()
  for (const o of sel) s.removeObject(o.id)
  s.clearSelection()
  recordSnapshot('Delete')
}

// ── Group / Ungroup (CSG: solids join, holes cut) ────────────────────────────
export async function groupSelection() {
  const sel = selectedObjects()
  if (sel.length < 2) return false
  await loadCSG()
  const s = scene()
  // Fold the selection into one group, two at a time (the CSG step is pairwise).
  let acc = sel[0].id
  for (const o of sel.slice(1)) {
    s.setSelectionList([acc, o.id])
    const g = s.groupSelected()
    if (!g) break
    acc = g.id
  }
  s.selectObject(acc)
  recordSnapshot('Group')
  return true
}

export async function ungroupSelection() {
  await loadCSG()
  if (scene().ungroupSelected()) { recordSnapshot('Ungroup'); return true }
  return false
}

export const canUngroup = () => {
  const o = selectedObjects()[0]
  return !!o && Array.isArray(o.groupMembers) && o.groupMembers.length > 0
}

// ── Align (Tinkercad: line parts up on the selection's bounding box) ─────────
function worldBox(id) {
  const m = objectManager.getMesh(id)
  if (!m) return null
  m.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(m)
  return b.isEmpty() ? null : b
}

/** axis: 'x'|'y'|'z' · where: 'min'|'center'|'max'. Needs 2+ parts. */
export function alignSelection(axis, where) {
  const sel = selectedObjects().filter((o) => !o.locked)
  if (sel.length < 2) return
  const boxes = sel.map((o) => [o, worldBox(o.id)]).filter(([, b]) => b)
  if (boxes.length < 2) return
  const lo = Math.min(...boxes.map(([, b]) => b.min[axis]))
  const hi = Math.max(...boxes.map(([, b]) => b.max[axis]))
  const target = where === 'min' ? lo : where === 'max' ? hi : (lo + hi) / 2
  const s = scene()
  for (const [o, b] of boxes) {
    const cur = where === 'min' ? b.min[axis] : where === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2
    s.updateObject(o.id, { position: { ...o.position, [axis]: o.position[axis] + (target - cur) } })
  }
  recordSnapshot('Align')
}

// ── Mirror (flip in place; several parts flip as one around their middle) ────
export function mirrorSelection(axis) {
  const sel = selectedObjects().filter((o) => !o.locked && !isWired(o))
  if (!sel.length) return
  const boxes = sel.map((o) => worldBox(o.id)).filter(Boolean)
  const mid = boxes.length ? (Math.min(...boxes.map((b) => b.min[axis])) + Math.max(...boxes.map((b) => b.max[axis]))) / 2 : 0
  const s = scene()
  for (const o of sel) {
    const pos = { ...o.position }
    if (sel.length > 1) pos[axis] = 2 * mid - pos[axis]
    s.updateObject(o.id, { position: pos, scale: { ...o.scale, [axis]: -o.scale[axis] } })
  }
  recordSnapshot('Mirror')
}

// ── Lock / Hide ──────────────────────────────────────────────────────────────
export function toggleLockSelection() {
  const sel = selectedObjects()
  if (!sel.length) return
  const lock = !sel.every((o) => o.locked)
  const s = scene()
  for (const o of sel) s.updateObject(o.id, { locked: lock })
  recordSnapshot(lock ? 'Lock' : 'Unlock')
}

export function hideSelection() {
  const sel = selectedObjects()
  if (!sel.length) return
  const s = scene()
  for (const o of sel) s.updateObject(o.id, { visible: false })
  s.clearSelection()
  recordSnapshot('Hide')
}

export function showAll() {
  const s = scene()
  const hidden = s.objects.filter((o) => o.visible === false)
  if (!hidden.length) return
  for (const o of hidden) s.updateObject(o.id, { visible: true })
  recordSnapshot('Show all')
}

// Parts riding a motor shaft are positioned by the motor, not by the user.
export const isMovable = (o) => !!o && !o.locked && !useElectronicsStore.getState().attachments[o.id]
