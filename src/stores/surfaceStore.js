import { create } from 'zustand'

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
