import { useCallback } from 'react'
import { historyManager } from '../managers/HistoryManager.js'
import { useSceneStore } from '../stores/sceneStore.js'

export function useHistory() {
  const setObjects = useSceneStore((s) => s.setObjects)

  const snapshot = useCallback(() => {
    const objects = useSceneStore.getState().objects
    historyManager.push(JSON.parse(JSON.stringify(objects)))
  }, [])

  const undo = useCallback(() => {
    const state = historyManager.undo()
    if (state !== null) setObjects(state)
  }, [setObjects])

  const redo = useCallback(() => {
    const state = historyManager.redo()
    if (state !== null) setObjects(state)
  }, [setObjects])

  return { snapshot, undo, redo }
}
