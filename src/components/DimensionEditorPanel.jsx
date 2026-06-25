import { useState, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { objectManager } from '../managers/ObjectManager.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'

/**
 * DimensionEditorPanel — shows live bounding-box dimensions (W/H/D) and
 * allows typing new values. Supports Center and One-Sided scaling modes.
 *
 * Center mode:   scale factor = newDim / currentDim applied at object origin
 * One-Sided mode: same scale but position shifts by half the delta so one face stays fixed
 */

const AXIS_LABELS = [
  { key: 'w', axis: 'x', label: 'Width',  color: '#ef4444' },
  { key: 'h', axis: 'y', label: 'Height', color: '#22c55e' },
  { key: 'd', axis: 'z', label: 'Depth',  color: '#3b82f6' },
]

function getDimensions(id) {
  const mesh = objectManager.getMesh(id)
  if (!mesh) return null
  const box  = new THREE.Box3().setFromObject(mesh)
  const size = box.getSize(new THREE.Vector3())
  return { w: parseFloat(size.x.toFixed(3)), h: parseFloat(size.y.toFixed(3)), d: parseFloat(size.z.toFixed(3)) }
}

export default function DimensionEditorPanel({ obj }) {
  const updateObject = useSceneStore(s => s.updateObject)
  const { snapshot }  = useHistory()

  const [dims, setDims]     = useState(null)
  const [editing, setEditing] = useState({})       // axis → draft string
  const [mode, setMode]     = useState('center')    // 'center' | 'one-sided'
  const [lockSide, setLockSide] = useState('min')   // which face stays fixed: 'min' | 'max'

  // Refresh dims from Three.js bounding box whenever obj changes
  const refresh = useCallback(() => {
    const d = getDimensions(obj.id)
    if (d) setDims(d)
  }, [obj.id])

  useEffect(() => { refresh() }, [obj.id, obj.scale, refresh])

  if (!dims) return null

  const applyDimension = (axis, newSizeStr) => {
    const newSize = parseFloat(newSizeStr)
    if (!isFinite(newSize) || newSize <= 0.001) { setEditing(e => ({ ...e, [axis]: undefined })); return }

    const key = axis === 'x' ? 'w' : axis === 'y' ? 'h' : 'd'
    const currentSize = dims[key]
    if (currentSize <= 0.001) return

    const scaleFactor = newSize / currentSize

    const newScale = {
      x: axis === 'x' ? obj.scale.x * scaleFactor : obj.scale.x,
      y: axis === 'y' ? obj.scale.y * scaleFactor : obj.scale.y,
      z: axis === 'z' ? obj.scale.z * scaleFactor : obj.scale.z,
    }

    let newPosition = { ...obj.position }

    if (mode === 'one-sided') {
      // Move position so the chosen face stays fixed
      const delta = newSize - currentSize
      const halfDelta = delta / 2
      // lock 'min' → the negative-axis face stays; object moves in +axis direction by halfDelta
      // lock 'max' → the positive-axis face stays; object moves in -axis direction by halfDelta
      const sign = lockSide === 'min' ? 1 : -1
      newPosition = {
        ...newPosition,
        x: axis === 'x' ? obj.position.x + halfDelta * sign : newPosition.x,
        y: axis === 'y' ? obj.position.y + halfDelta * sign : newPosition.y,
        z: axis === 'z' ? obj.position.z + halfDelta * sign : newPosition.z,
      }
    }

    updateObject(obj.id, { scale: newScale, position: newPosition })
    const mesh = objectManager.getMesh(obj.id)
    if (mesh) {
      mesh.scale.set(newScale.x, newScale.y, newScale.z)
      mesh.position.set(newPosition.x, newPosition.y, newPosition.z)
    }
    snapshot()
    setEditing(e => ({ ...e, [axis]: undefined }))
    // Refresh dims after a tick
    setTimeout(refresh, 50)
  }

  const handleKey = (e, axis) => {
    if (e.key === 'Enter') applyDimension(axis, editing[axis] ?? '')
    if (e.key === 'Escape') setEditing(ev => ({ ...ev, [axis]: undefined }))
  }

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => setMode('center')}
          className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
            mode === 'center'
              ? 'bg-indigo-700/40 text-indigo-700 border border-indigo-600/50'
              : 'bg-gray-700/40 text-gray-500 hover:text-gray-300'
          }`}
          title="Scale symmetrically from center"
        >
          ⬜ Center
        </button>
        <button
          onClick={() => setMode('one-sided')}
          className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
            mode === 'one-sided'
              ? 'bg-indigo-700/40 text-indigo-700 border border-indigo-600/50'
              : 'bg-gray-700/40 text-gray-500 hover:text-gray-300'
          }`}
          title="Move only one face — the opposite face stays fixed"
        >
          ▷ One-Sided
        </button>
      </div>

      {/* Fixed-face selector for one-sided mode */}
      {mode === 'one-sided' && (
        <div className="flex gap-1">
          <div className="text-[9px] text-gray-500 self-center mr-1">Fixed face:</div>
          <button
            onClick={() => setLockSide('min')}
            className={`flex-1 py-0.5 rounded text-[9px] transition-colors ${
              lockSide === 'min' ? 'bg-gray-600 text-gray-100' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >− face</button>
          <button
            onClick={() => setLockSide('max')}
            className={`flex-1 py-0.5 rounded text-[9px] transition-colors ${
              lockSide === 'max' ? 'bg-gray-600 text-gray-100' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >+ face</button>
        </div>
      )}

      {/* W / H / D inputs */}
      {AXIS_LABELS.map(({ key, axis, label, color }) => {
        const currentVal = dims[key]
        const draftVal = editing[axis]
        const isEditing = draftVal !== undefined
        return (
          <div key={axis} className="flex items-center gap-2">
            <div className="w-12 text-[10px] font-medium" style={{ color }}>
              {label}
            </div>
            <input
              type="number"
              min="0.01"
              step="0.1"
              value={isEditing ? draftVal : currentVal}
              onChange={e => setEditing(ev => ({ ...ev, [axis]: e.target.value }))}
              onBlur={e => { if (isEditing) applyDimension(axis, e.target.value) }}
              onKeyDown={e => handleKey(e, axis)}
              onFocus={e => {
                setEditing(ev => ({ ...ev, [axis]: String(currentVal) }))
                e.target.select()
              }}
              className={`flex-1 bg-gray-700 text-gray-100 text-[11px] px-2 py-1 rounded border focus:outline-none ${
                isEditing ? 'border-indigo-500' : 'border-gray-600'
              }`}
            />
            <div className="text-[9px] text-gray-500 w-5">u</div>
          </div>
        )
      })}

      <div className="text-[9px] text-gray-600">Press Enter to apply · u = scene units</div>
    </div>
  )
}
