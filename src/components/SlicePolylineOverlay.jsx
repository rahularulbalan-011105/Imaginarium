import { useState, useRef } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { sceneManager } from '../managers/SceneManager.js'
import { sliceByScreenPolyline } from '../utils/sliceTool.js'

// On-canvas editable polyline for the Slice tool.
//  • click empty space → add a point (the line continues from the last point)
//  • drag any point → bend the line there
//  • double-click a point → delete it
//  • Slice → cut the selected shape into two along the line
export default function SlicePolylineOverlay({ containerRef }) {
  const selectedId   = useSceneStore(s => s.selectedId)
  const addCSGObject = useSceneStore(s => s.addCSGObject)
  const removeObject = useSceneStore(s => s.removeObject)
  const setSliceTool = useUiStore(s => s.setSliceTool)
  const { snapshot }  = useHistory()

  const [pts, setPts] = useState([])
  const [err, setErr] = useState(null)
  const dragIdx = useRef(null)

  const rel = (e) => {
    const r = containerRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onBgDown   = (e) => { setErr(null); setPts(p => [...p, rel(e)]) }
  const onPtDown   = (i) => (e) => { e.stopPropagation(); dragIdx.current = i }
  const onMove     = (e) => { if (dragIdx.current != null) { const p = rel(e); setPts(a => a.map((q, i) => i === dragIdx.current ? p : q)) } }
  const onUp       = () => { dragIdx.current = null }
  const onPtDelete = (i) => (e) => { e.stopPropagation(); setPts(a => a.filter((_, j) => j !== i)) }

  const clearAll = () => { setPts([]); setErr(null) }
  const exit = () => { clearAll(); setSliceTool(false) }

  const apply = () => {
    setErr(null)
    if (!selectedId) { setErr('Select the shape you want to slice first.'); return }
    if (pts.length < 2) { setErr('Draw a line across the shape (add at least 2 points).'); return }
    const r = containerRef.current.getBoundingClientRect()
    const screenPts = pts.map(p => ({ x: p.x + r.left, y: p.y + r.top }))
    try {
      const res = sliceByScreenPolyline(selectedId, screenPts, sceneManager.camera, r)
      if (!res) { setErr('Cut failed — make sure the line crosses right through the shape.'); return }
      const base = useSceneStore.getState().objects.find(o => o.id === selectedId)
      const name = base?.name ?? 'Piece'
      addCSGObject(`${name}_A`, res.pieceA.geometryJSON, res.pieceA.color, res.pieceA.position)
      addCSGObject(`${name}_B`, res.pieceB.geometryJSON, res.pieceB.color, res.pieceB.position)
      removeObject(base.id)
      snapshot()
      exit()
    } catch (e) {
      console.error('[slice]', e)
      setErr('Cut error: ' + (e?.message ?? e))
    }
  }

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <div className="absolute inset-0 z-40">
      <svg
        className="absolute inset-0 w-full h-full"
        style={{ cursor: 'crosshair' }}
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        {pts.length > 1 && (
          <path d={path} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeDasharray="7 4" />
        )}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y} r="7"
            fill="#ffffff" stroke="#ef4444" strokeWidth="2.5"
            style={{ cursor: 'grab' }}
            onPointerDown={onPtDown(i)}
            onDoubleClick={onPtDelete(i)}
          />
        ))}
      </svg>

      {/* Controls */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-gray-900/90 border border-red-500/60 text-red-200 text-xs font-medium px-3 py-2 rounded-full shadow-lg">
        <span className="text-base">🔪</span>
        <span>Click to draw the cut line · drag a dot to bend · double-click a dot to delete</span>
        <button onClick={apply}   className="ml-1 px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white">✂ Slice</button>
        <button onClick={clearAll} className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200">Clear</button>
        <button onClick={exit}    className="px-2 py-1 rounded text-red-300 hover:text-white">✕ Exit</button>
      </div>

      {err && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-500 text-red-100 text-xs px-3 py-1.5 rounded-lg shadow pointer-events-none">
          {err}
        </div>
      )}
    </div>
  )
}
