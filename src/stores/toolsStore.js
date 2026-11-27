import { create } from 'zustand'

// State of the Tinkercad-style 3D Design tools (utils/workplane.js):
//   workplane   null = floor, else { origin, normal } — new objects land on it
//   ruler       null, or { origin } — readings / typed edits for the selection
//   pickMode    which tool is waiting for a click in the viewport
// Kept out of uiStore so sceneStore can read the workplane without a cycle.
export const useToolsStore = create((set) => ({
  workplane: null,
  ruler: null,
  pickMode: null,            // 'workplane' | 'ruler' | 'note' | null
  setWorkplane: (wp) => set({ workplane: wp }),
  setRuler: (r) => set({ ruler: r }),
  setPickMode: (m) => set((s) => ({ pickMode: s.pickMode === m ? null : m })),
  clearPickMode: () => set({ pickMode: null }),
}))
