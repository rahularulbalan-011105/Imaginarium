import { create } from 'zustand'
import { v4 as uuid } from 'uuid'

// Stores rigid surface bonds between objects.
// Each bond records the relative 4×4 transform of child in parent's local space
// so that when either object is moved, the other follows.
export const useRigidStore = create((set, get) => ({
  bonds: {},  // bondId → { id, parentId, childId, relativeMatrix: number[16] }

  // contactLocalNormal / contactLocalCenter are patchA's normal and center
  // stored in the PARENT object's local space — needed for on-surface rotation.
  addBond(parentId, childId, relativeMatrix, contactLocalNormal, contactLocalCenter) {
    const id = uuid()
    set(s => ({
      bonds: {
        ...s.bonds,
        [id]: { id, parentId, childId, relativeMatrix, contactLocalNormal, contactLocalCenter },
      },
    }))
    return id
  },

  updateBond(id, updates) {
    set(s => ({ bonds: { ...s.bonds, [id]: { ...s.bonds[id], ...updates } } }))
  },

  removeBond(id) {
    set(s => { const b = { ...s.bonds }; delete b[id]; return { bonds: b } })
  },

  setBonds: (bonds) => set({ bonds }),

  removeBondsForObject(objectId) {
    set(s => ({
      bonds: Object.fromEntries(
        Object.entries(s.bonds)
          .filter(([, b]) => b.parentId !== objectId && b.childId !== objectId)
      ),
    }))
  },

  getBonds() { return Object.values(get().bonds) },
}))
