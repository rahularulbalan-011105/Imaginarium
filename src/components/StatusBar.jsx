import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'

export default function StatusBar() {
  const objects = useSceneStore((s) => s.objects)
  const selectedId = useSceneStore((s) => s.selectedId)
  const selectedObj = useSceneStore((s) => s.objects.find((o) => o.id === selectedId))
  const transformMode = useUiStore((s) => s.transformMode)

  return (
    <div className="flex items-center gap-4 px-4 h-7 bg-gray-900/80 border-t border-gray-700/50 text-[11px] text-gray-500 shrink-0">
      <span>Objects: <span className="text-gray-300">{objects.length}</span></span>
      {selectedObj ? (
        <>
          <span>│</span>
          <span>
            Selected: <span className="text-amber-400">{selectedObj.name}</span>
          </span>
          <span>│</span>
          <span>
            Pos ({
              [selectedObj.position.x, selectedObj.position.y, selectedObj.position.z]
                .map((v) => v.toFixed(2))
                .join(', ')
            })
          </span>
          <span>│</span>
          <span>Mode: <span className="text-gray-300 capitalize">{transformMode}</span></span>
        </>
      ) : (
        <span>No selection</span>
      )}
      <span className="ml-auto">
        Shortcuts: <span className="text-gray-400">1-6 add shape · G grid · A axes · Del delete · Ctrl+Z/Y undo/redo · F fit · Shift+S snap axes</span>
      </span>
    </div>
  )
}
