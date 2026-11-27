import { memo, useCallback, useState } from 'react'
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

  // Stable handlers (read the live selection at click time) so memoized rows
  // don't re-render just because the list did.
  const handleRowClick = useCallback((e, id) => {
    const { selectedId: sel } = useSceneStore.getState()
    if (e.shiftKey && sel && id !== sel) {
      // Shift+click → set as secondary for boolean ops
      setSecondaryId(id)
      return
    }
    if (sel === id) clearSelection()
    else selectObject(id)
  }, [setSecondaryId, clearSelection, selectObject])

  const handleDelete = useCallback((e, id) => {
    e.stopPropagation()
    removeObject(id)
    snapshot()   // record the deletion itself as the undo step (was taken before it)
  }, [removeObject, snapshot])

  const handleToggleVisible = useCallback((e, obj) => {
    e.stopPropagation()
    updateObject(obj.id, { visible: !obj.visible })
  }, [updateObject])

  const connEntries = Object.entries(connections)

  const handleDeleteWire = (connId) => {
    wireManager.removeWire(connId)
  }

  if (objects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="text-[13px] text-gray-400">Nothing here yet.</div>
        <div className="text-[12px] text-gray-500 mt-1">Add shapes from Library, or parts from Build → Electronics.</div>
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
      {[...objects].reverse().map((obj) => (
        <ObjectRow
          key={obj.id}
          obj={obj}
          isPrimary={obj.id === selectedId}
          isSecondary={obj.id === secondaryId}
          onRowClick={handleRowClick}
          onDelete={handleDelete}
          onToggleVisible={handleToggleVisible}
        />
      ))}

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
              <span className="text-[10px] text-yellow-700 font-mono shrink-0">
                {componentName(fromPinId, objects)}
              </span>
              <span className="text-[9px] text-gray-500 font-mono bg-gray-800 px-1 rounded shrink-0">
                {pinLabel(fromPinId)}
              </span>
              <span className="text-gray-600 text-[9px] shrink-0">→</span>
              <span className="text-[10px] text-yellow-700 font-mono shrink-0">
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

// One row. Memoized: updateObject keeps unchanged objects by reference, so a
// drag re-renders only the dragged row. `content-visibility: auto` lets the
// browser skip layout/paint for off-screen rows (large scenes stay cheap).
// The part's picture (public/thumbs), else a swatch in the object's colour.
const THUMB_BASE = `${import.meta.env.BASE_URL}thumbs/`
const SHAPE_THUMBS = new Set(['box', 'cylinder', 'sphere', 'cone', 'rectprism', 'torus', 'capsule', 'tetrahedron', 'octahedron', 'dodecahedron', 'prism', 'hexagon', 'pyramid', 'pentpyramid', 'plane'])
function RowThumb({ obj }) {
  const [failed, setFailed] = useState(false)
  const src = SHAPE_THUMBS.has(obj.type) ? `${THUMB_BASE}shape_${obj.type}.webp`
    : obj.type in TYPE_ICONS || obj.type.startsWith('weapon_') || /^[a-z0-9_]+$/.test(obj.type) ? `${THUMB_BASE}${obj.type}.webp` : null
  if (!src || failed || obj.type === 'csg' || obj.type === 'model' || obj.type === 'text') {
    return <span className="w-6 h-6 rounded shrink-0" style={{ background: obj.color, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.12)' }} />
  }
  return <img src={src} alt="" className="w-6 h-6 object-contain shrink-0" loading="lazy" draggable={false} onError={() => setFailed(true)} />
}

const ObjectRow = memo(function ObjectRow({ obj, isPrimary, isSecondary, onRowClick, onDelete, onToggleVisible }) {
  return (
    <div
      onClick={(e) => onRowClick(e, obj.id)}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 33px' }}
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-gray-800/50 group transition-colors ${
        isPrimary
          ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
          : isSecondary
          ? 'bg-indigo-500/5 border-l-2 border-l-indigo-300'
          : 'hover:bg-gray-800/50'
      }`}
    >
      <RowThumb obj={obj} />
      <span className={`flex-1 text-xs truncate ${
        isPrimary ? 'text-gray-50 font-medium' : 'text-gray-300'
      }`}>
        {obj.name}
        {isSecondary && <span className="ml-1 text-[11px] text-gray-500">(2nd)</span>}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => onToggleVisible(e, obj)}
          title={obj.visible ? 'Hide' : 'Show'}
          className="text-gray-400 hover:text-slate-900 text-xs px-1 py-0.5 rounded hover:bg-gray-700"
        >
          {obj.visible ? '👁' : '🚫'}
        </button>
        <button
          onClick={(e) => onDelete(e, obj.id)}
          title="Delete"
          className="text-gray-400 hover:text-red-400 text-xs px-1 py-0.5 rounded hover:bg-gray-700"
        >
          ✕
        </button>
      </div>
    </div>
  )
})
