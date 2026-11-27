import { useEffect, useRef, useState } from 'react'
import { strokeToOutline } from '../utils/shapes3d.js'
import { useOverlay } from './ui/overlay.js'

// ─────────────────────────────────────────────────────────────────────────────
// Scribble (Tinkercad's freehand shape): draw one closed outline with the mouse,
// finger or pen; it becomes a solid extruded to the chosen thickness.
// ─────────────────────────────────────────────────────────────────────────────
export default function ScribblePad({ onDone, onCancel }) {
  useOverlay('scribble', true)
  const canvas = useRef(null)
  const [pts, setPts] = useState([])
  const [drawing, setDrawing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    if (!drawing && pts.length > 2) ctx.closePath()
    ctx.stroke()
  }, [pts, drawing])

  const at = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * canvas.current.width, ((e.clientY - r.top) / r.height) * canvas.current.height]
  }
  const down = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setError(null); setDrawing(true); setPts([at(e)]) }
  const move = (e) => { if (drawing) setPts(p => [...p, at(e)]) }
  const up = () => setDrawing(false)
  const done = () => {
    const outline = strokeToOutline(pts)
    if (!outline) { setError('Draw a closed outline first — one continuous stroke around the shape.'); return }
    onDone(outline)
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Draw a scribble shape">
      <div className="rounded-xl p-3 w-[min(92vw,420px)]" style={{ background: 'rgb(var(--g-900))', color: 'rgb(var(--g-200))' }}>
        <div className="text-[13px] font-semibold mb-1">Scribble</div>
        <div className="text-[11px] mb-2" style={{ color: 'rgb(var(--g-400))' }}>Draw one outline. It closes by itself and becomes a solid you can resize, group and use as a hole.</div>
        <canvas ref={canvas} width={400} height={300}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
          className="w-full rounded-lg touch-none cursor-crosshair" style={{ background: 'rgb(var(--g-800))', aspectRatio: '4 / 3' }} />
        {error && <div className="text-[11px] text-red-400 mt-1">{error}</div>}
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={() => setPts([])} className="px-2 py-1 text-[12px] rounded ui-icon-btn">Clear</button>
          <button onClick={onCancel} className="px-2 py-1 text-[12px] rounded ui-icon-btn">Cancel</button>
          <button onClick={done} className="px-3 py-1 text-[12px] rounded bg-orange-600 text-white font-semibold">Create shape</button>
        </div>
      </div>
    </div>
  )
}
