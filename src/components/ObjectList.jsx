import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { wireManager } from '../managers/WireManager.js'
import { useHistory } from '../hooks/useHistory.js'

const TYPE_ICONS = {
  cylinder: '⬤', cone: '🔺', box: '⬛', sphere: '🔵',
  tetrahedron: '△', pyramid: '▲', pentpyramid: '⛛',
  octahedron: '◈', dodecahedron: '⬡', rectprism: '▭',
  csg: '🔷',
}

function pinLabel(pinId) {
  if (!pinId) return '?'
  const parts = pinId.split(':')
  return parts.length >= 2 ? parts[1] : pinId
}

function componentName(pinId, objects) {
  if (!pinId) return '?'
  const compId = pinId.split(':')[0]
  const obj = objects.find(o => o.id === compId)
  return obj ? obj.name : compId.slice(0, 8)
}

export default function ObjectList() {
  const objects = useSceneStore((s) => s.objects)
  const selectedId = useSceneStore((s) => s.selectedId)
  const secondaryId = useSceneStore((s) => s.secondaryId)
  const selectObject = useSceneStore((s) => s.selectObject)
  const setSecondaryId = useSceneStore((s) => s.setSecondaryId)
  const clearSelection = useSceneStore((s) => s.clearSelection)
  const removeObject = useSceneStore((s) => s.removeObject)
  const updateObject = useSceneStore((s) => s.updateObject)
  const connections = useElectronicsStore((s) => s.connections)
  const { snapshot } = useHistory()

  const handleRowClick = (e, id) => {
    if (e.shiftKey && selectedId && id !== selectedId) {
      // Shift+click → set as secondary for boolean ops
      setSecondaryId(id)
      return
    }
    if (selectedId === id) clearSelection()
    else selectObject(id)
  }

  const handleDelete = (e, id) => {
    e.stopPropagation()
    snapshot()
    removeObject(id)
  }

  const handleToggleVisible = (e, obj) => {
    e.stopPropagation()
    updateObject(obj.id, { visible: !obj.visible })
  }

  const connEntries = Object.entries(connections)

  const handleDeleteWire = (connId) => {
    wireManager.removeWire(connId)
  }

  if (objects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="text-3xl mb-2 opacity-30">📦</div>
        <div className="text-sm text-gray-500">No objects in scene.</div>
        <div className="text-xs text-gray-600 mt-1">Use the toolbar to add shapes.</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider px-3 py-2 border-b border-gray-700/50">
        Objects ({objects.length})
        {selectedId && (
          <span className="ml-1 text-gray-600">· Shift+click to select 2nd for Boolean</span>
        )}
      </div>
      {[...objects].reverse().map((obj) => {
        const isPrimary = obj.id === selectedId
        const isSecondary = obj.id === secondaryId
        return (
          <div
            key={obj.id}
            onClick={(e) => handleRowClick(e, obj.id)}
            className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-gray-800/50 group transition-colors ${
              isPrimary
                ? 'bg-blue-900/40 border-l-2 border-l-blue-500'
                : isSecondary
                ? 'bg-orange-900/30 border-l-2 border-l-orange-500'
                : 'hover:bg-gray-800/50'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: obj.color }} />
            <span className="text-sm shrink-0">{TYPE_ICONS[obj.type] ?? '📦'}</span>
            <span className={`flex-1 text-xs truncate ${
              isPrimary ? 'text-white' : isSecondary ? 'text-orange-300' : 'text-gray-300'
            }`}>
              {obj.name}
              {isSecondary && <span className="ml-1 text-[9px] text-orange-400 opacity-70">2nd</span>}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => handleToggleVisible(e, obj)}
                title={obj.visible ? 'Hide' : 'Show'}
                className="text-gray-400 hover:text-white text-xs px-1 py-0.5 rounded hover:bg-gray-700"
              >
                {obj.visible ? '👁' : '🚫'}
              </button>
              <button
                onClick={(e) => handleDelete(e, obj.id)}
                title="Delete"
                className="text-gray-400 hover:text-red-400 text-xs px-1 py-0.5 rounded hover:bg-gray-700"
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}

      {/* ── Wire connections list ── */}
      {connEntries.length > 0 && (
        <div className="border-t border-gray-700/60 mt-1">
          <div className="text-[10px] text-yellow-500/80 uppercase tracking-wider px-3 py-2 border-b border-gray-700/50 flex items-center gap-1">
            <span>⚡</span> Connections ({connEntries.length})
          </div>
          {connEntries.map(([connId, { fromPinId, toPinId }]) => (
            <div
              key={connId}
              className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/40 group hover:bg-gray-800/40 transition-colors"
            >
              <span className="text-[10px] text-yellow-400/70 font-mono shrink-0">
                {componentName(fromPinId, objects)}
              </span>
              <span className="text-[9px] text-gray-500 font-mono bg-gray-800 px-1 rounded shrink-0">
                {pinLabel(fromPinId)}
              </span>
              <span className="text-gray-600 text-[9px] shrink-0">→</span>
              <span className="text-[10px] text-yellow-400/70 font-mono shrink-0">
                {componentName(toPinId, objects)}
              </span>
              <span className="text-[9px] text-gray-500 font-mono bg-gray-800 px-1 rounded shrink-0">
                {pinLabel(toPinId)}
              </span>
              <button
                onClick={() => handleDeleteWire(connId)}
                title="Remove wire"
                className="ml-auto opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-1 py-0.5 rounded hover:bg-gray-700 transition-all shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
