import { useSceneStore } from '../stores/sceneStore.js'

export function useSelection() {
  const selectedId = useSceneStore((s) => s.selectedId)
  const selectObject = useSceneStore((s) => s.selectObject)
  const clearSelection = useSceneStore((s) => s.clearSelection)
  const selectedObject = useSceneStore((s) => s.objects.find((o) => o.id === selectedId) ?? null)

  return { selectedId, selectedObject, selectObject, clearSelection }
}
