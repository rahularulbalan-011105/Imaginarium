import { useState, useRef } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { sceneManager } from '../managers/SceneManager.js'
import { sliceByScreenPolyline } from '../utils/sliceTool.js'
import { loadCSG } from '../utils/csgLib.js'

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

  const apply = async () => {
    setErr(null)
    if (!selectedId) { setErr('Select the shape you want to slice first.'); return }
    if (pts.length < 2) { setErr('Draw a line across the shape (add at least 2 points).'); return }
    const r = containerRef.current.getBoundingClientRect()
    const screenPts = pts.map(p => ({ x: p.x + r.left, y: p.y + r.top }))
    await loadCSG()   // CSG engine loads on demand
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

      {/* Controls — same bottom-centre toast as the other tool modes */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 pl-4 pr-1.5 py-1.5 rounded-lg text-[12px] text-white"
        style={{ background: 'rgba(31,41,55,0.94)', boxShadow: '0 6px 20px rgba(0,0,0,0.18)' }}>
        <span>Click to draw the cut line. Drag a dot to bend it; double-click a dot to remove it.</span>
        <button onClick={apply}    className="h-7 px-3 rounded-md font-semibold bg-orange-500 hover:bg-orange-600 text-white">Slice</button>
        <button onClick={clearAll} className="h-7 px-3 rounded-md font-semibold bg-white/10 hover:bg-white/20">Clear</button>
        <button onClick={exit}     className="h-7 px-3 rounded-md font-semibold bg-white/10 hover:bg-white/20">Done</button>
      </div>

      {err && (
        <div className="absolute bottom-[88px] left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg text-[12px] text-white pointer-events-none"
          style={{ background: '#b91c1c' }}>
          {err}
        </div>
      )}
    </div>
  )
}
