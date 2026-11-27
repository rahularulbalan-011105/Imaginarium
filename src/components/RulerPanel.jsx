import { useEffect, useState } from 'react'
import { useToolsStore } from '../stores/toolsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { rulerReadings, applyRulerEdit } from '../utils/workplane.js'
import { recordSnapshot } from '../managers/history/editorDispatch.js'

// ─────────────────────────────────────────────────────────────────────────────
// Ruler (Tinkercad 3D Design tool). With a ruler placed and an object selected:
// shows the object's distance from the ruler (to its nearest box corner) along
// X / Y / Z and its size W / H / D, in scene units and millimetres. Typing a
// value moves (offset) or resizes (size) the object, keeping the corner nearest
// the ruler fixed. Measures along the world axes.
// ─────────────────────────────────────────────────────────────────────────────
const MM_PER_UNIT = 50            // 1 scene unit = 5 cm (EnvironmentConfig / printExport)
const FIELDS = [['x', 'X'], ['y', 'Y'], ['z', 'Z'], ['w', 'W'], ['h', 'H'], ['d', 'D']]

export default function RulerPanel() {
  const ruler = useToolsStore(s => s.ruler)
  const setRuler = useToolsStore(s => s.setRuler)
  const selectedId = useSceneStore(s => s.selectedId)
  const obj = useSceneStore(s => s.objects.find(o => o.id === s.selectedId))
  const updateObject = useSceneStore(s => s.updateObject)
  const [box, setBox] = useState(null)

  // The mesh's world box changes on any edit; sample it while the panel is up.
  useEffect(() => {
    if (!ruler || !selectedId) { setBox(null); return }
    let raf, last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const mesh = objectManager.getMesh(selectedId)
      if (!mesh) return
      mesh.updateMatrixWorld(true)
      const b = objectManager.worldBoxExcludingAttached(mesh)
      if (b.isEmpty()) return
      const key = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(v => v.toFixed(3)).join()
      if (key !== last) { last = key; setBox({ min: { ...b.min }, max: { ...b.max } }) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ruler, selectedId])

  if (!ruler) return null
  const r = box && obj ? rulerReadings(box, ruler.origin) : null
  const commit = (field, text) => {
    const v = Number(text)
    if (!r || !Number.isFinite(v)) return
    const patch = applyRulerEdit(field, v, obj, box, ruler.origin)
    if (patch) { updateObject(obj.id, patch); recordSnapshot?.('ruler') }
  }
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-[25] rounded-xl px-3 py-2 shadow-lg" data-tour="ruler-panel"
      style={{ background: 'rgb(var(--g-900) / 0.92)', color: 'rgb(var(--g-200))', border: '1px solid rgb(var(--a-600) / 0.5)' }}>
      <div className="flex items-center gap-2 text-[11px] font-semibold mb-1">
        <span style={{ color: 'rgb(var(--a-500))' }}>Ruler</span>
        <span style={{ color: 'rgb(var(--g-400))' }}>{r ? obj.name : 'Select an object to measure it'}</span>
        <button onClick={() => setRuler(null)} className="ml-auto ui-icon-btn rounded px-1" aria-label="Remove ruler">×</button>
      </div>
      {r && (
        <div className="grid grid-cols-6 gap-1.5">
          {FIELDS.map(([k, label]) => (
            <label key={`${obj.id}-${k}`} className="flex flex-col items-center text-[10px]">
              <span style={{ color: k === 'x' || k === 'w' ? '#ef4444' : k === 'y' || k === 'h' ? '#22c55e' : '#3b82f6' }}>{label}</span>
              <input defaultValue={r[k]} key={r[k]} type="number" step="0.1"
                onBlur={(e) => commit(k, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                aria-label={`Ruler ${label}`}
                className="w-16 text-[11px] text-right bg-gray-800 border border-gray-700 rounded px-1 py-0.5" />
              <span style={{ color: 'rgb(var(--g-500))' }}>{Math.round(r[k] * MM_PER_UNIT)} mm</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
