import { create } from 'zustand'

// Two patches describe the SAME face when they sit on the same object, point the
// same way, and share a centre. `_detectFace` derives both from the face itself
// (not the click point), so re-clicking one flat face reproduces them to float
// precision — hence the tight tolerance. If it ever misses, the worst case is
// the old behaviour (a second patch), never two different faces merged by mistake.
const SAME_DIR = 0.999          // ~2.5 degrees
const SAME_SPOT = 1e-3
const sameFace = (a, b) =>
  a.objectId === b.objectId &&
  a.localNormal.x * b.localNormal.x + a.localNormal.y * b.localNormal.y + a.localNormal.z * b.localNormal.z > SAME_DIR &&
  Math.hypot(a.localCenter.x - b.localCenter.x, a.localCenter.y - b.localCenter.y, a.localCenter.z - b.localCenter.z) < SAME_SPOT

export const useSurfaceStore = create((set) => ({
  patches: {},      // id → patch object
  selectedIds: [],  // up to 2 selected patch ids

  addPatch(patch) {
    set(s => ({ patches: { ...s.patches, [patch.id]: patch } }))
  },
  removePatch(id) {
    set(s => {
      const patches = { ...s.patches }
      delete patches[id]
      return { patches, selectedIds: s.selectedIds.filter(x => x !== id) }
    })
  },
  updatePatch(id, updates) {
    set(s => ({ patches: { ...s.patches, [id]: { ...s.patches[id], ...updates } } }))
  },
  toggleSelectPatch(id) {
    set(s => {
      if (s.selectedIds.includes(id)) return { selectedIds: s.selectedIds.filter(x => x !== id) }
      const next = s.selectedIds.length >= 2 ? [s.selectedIds[1], id] : [...s.selectedIds, id]
      return { selectedIds: next }
    })
  },
  /**
   * Make sure the clicked face has a patch and that it is SELECTED.
   *
   * The click handler only reaches here when `patchManager.pick()` found no
   * existing patch — but pick() can miss one it should have hit (the plane sits
   * just 0.005 above the surface, and it is a finite rectangle, so a click near
   * the face edge or on curved geometry can fall outside it). Creating a patch
   * unconditionally then left TWO patches on one object, and because attaching
   * needs two DIFFERENT objects, the Connect prompt silently never appeared.
   *
   * Selects rather than toggles: a deliberate re-click on a visible patch is
   * handled by the pick() branch, so arriving here means the user believes they
   * are selecting a face, not clearing one.
   */
  addOrSelectPatch(patch) {
    set(s => {
      const existing = Object.values(s.patches).find(p => sameFace(p, patch))
      if (existing) {
        return s.selectedIds.includes(existing.id)
          ? s
          : { selectedIds: s.selectedIds.length >= 2 ? [s.selectedIds[1], existing.id] : [...s.selectedIds, existing.id] }
      }
      return {
        patches: { ...s.patches, [patch.id]: patch },
        selectedIds: s.selectedIds.length >= 2 ? [s.selectedIds[1], patch.id] : [...s.selectedIds, patch.id],
      }
    })
  },
  clearPatchSelection() { set({ selectedIds: [] }) },
  setPatches(patches) { set({ patches }) },
  removePatchesForObject(objectId) {
    set(s => {
      const patches = {}
      const removed = new Set()
      for (const [id, p] of Object.entries(s.patches)) {
        if (p.objectId === objectId) removed.add(id)
        else patches[id] = p
      }
      return { patches, selectedIds: s.selectedIds.filter(id => !removed.has(id)) }
    })
  },
}))
