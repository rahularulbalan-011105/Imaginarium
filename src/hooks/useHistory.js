import { useCallback } from 'react'
import * as dispatch from '../managers/history/editorDispatch.js'

// Thin facade over the command-based history system (editorDispatch). Existing
// call sites keep calling snapshot()/undo()/redo() unchanged; under the hood each
// snapshot() now records a before→after SnapshotCommand on the command stack.
// (Domain operations will migrate to fine-grained commands incrementally.)
export function useHistory() {
  const snapshot = useCallback((label) => dispatch.recordSnapshot(label), [])
  const undo     = useCallback(() => dispatch.undo(), [])
  const redo     = useCallback(() => dispatch.redo(), [])
  return { snapshot, undo, redo }
}
