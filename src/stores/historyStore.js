import { create } from 'zustand'

// Reactive mirror of the command stacks, purely for the History Debug Panel and
// any UI that wants to show undo/redo availability. The HistoryManager pushes
// updates here via _set(); nothing reads back into the manager.
export const useHistoryStore = create((set) => ({
  undo: [],      // labels of commands on the undo stack (oldest → newest)
  redo: [],      // labels of commands on the redo stack (next → furthest)
  open: null,    // label of the open transaction, or null
  _set: (partial) => set(partial),
}))
