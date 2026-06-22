import * as THREE from 'three'
import { useState, useEffect } from 'react'
import { useUiStore } from '../stores/uiStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { runBoolean } from '../utils/csg.js'

export default function ExtrudePanel() {
  const extrudeState    = useUiStore(s => s.extrudeState)
  const setExtrudeState = useUiStore(s => s.setExtrudeState)
  const setExtrudeTool  = useUiStore(s => s.setExtrudeTool)

  const objects      = useSceneStore(s => s.objects)
  const updateObject = useSceneStore(s => s.updateObject)
  const removeObject = useSceneStore(s => s.removeObject)
  const addCSGObject = useSceneStore(s => s.addCSGObject)
  const selectObject = useSceneStore(s => s.selectObject)
  const { snapshot } = useHistory()

  const sourceObj  = extrudeState ? objects.find(o => o.id === extrudeState.sourceObjectId)  : null
  const extrudeObj = extrudeState ? objects.find(o => o.id === extrudeState.extrudeObjectId) : null

  // Depth in scene units = scale.z * 2  (BoxGeometry is 2 units deep at scale=1)
  const computedDepth = extrudeObj ? +(extrudeObj.scale.z * 2).toFixed(3) : 1
  const [draftDepth, setDraftDepth] = useState(String(computedDepth))

  // Keep draft in sync when depth changes externally (e.g., via gizmo scale)
  useEffect(() => {
    setDraftDepth(String(computedDepth))
  }, [computedDepth])

  if (!extrudeState || !extrudeObj) return null

  const { sourceObjectId, extrudeObjectId, faceCenterWorld, faceNormalWorld } = extrudeState

  const applyDepth = (val) => {
    const d = Math.max(0.1, parseFloat(val) || 0.1)
    const N  = new THREE.Vector3(faceNormalWorld.x, faceNormalWorld.y, faceNormalWorld.z)
    const FC = new THREE.Vector3(faceCenterWorld.x, faceCenterWorld.y, faceCenterWorld.z)
    // Move center outward so the back face stays flush against the source face
    const newPos = FC.clone().addScaledVector(N, d / 2)
    updateObject(extrudeObjectId, {
      position: { x: newPos.x, y: newPos.y, z: newPos.z },
      scale:    { ...extrudeObj.scale, z: d / 2 },
    })
    setDraftDepth(String(d))
  }

  const handleMerge = () => {
    const result = runBoolean(sourceObjectId, extrudeObjectId, 'union')
    if (result) {
      addCSGObject(
        (sourceObj?.name ?? 'Object') + '_ext',
        result.geometryJSON,
        result.color,
        result.position,
      )
      removeObject(sourceObjectId)
      removeObject(extrudeObjectId)
    }
    setExtrudeState(null)
    setExtrudeTool(false)
    snapshot()
  }

  const handleKeep = () => {
    setExtrudeState(null)
    setExtrudeTool(false)
    snapshot()
  }

  const handleCancel = () => {
    removeObject(extrudeObjectId)
    setExtrudeState(null)
    setExtrudeTool(false)
    if (sourceObjectId) selectObject(sourceObjectId)
  }

  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 pointer-events-auto select-none">
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl"
        style={{
          background: 'linear-gradient(135deg,#1a0a2e 0%,#230f3a 100%)',
          border: '1.5px solid rgba(168,85,247,0.55)',
          boxShadow: '0 0 24px rgba(168,85,247,0.18), 0 4px 24px rgba(0,0,0,0.5)',
        }}
      >
        <div className="text-purple-400 text-lg shrink-0">⬆</div>

        <div className="text-xs">
          <div className="text-purple-300 font-semibold leading-tight mb-1">
            Extruding <span className="text-white">{sourceObj?.name ?? '…'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">Depth:</span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={draftDepth}
              onChange={e => setDraftDepth(e.target.value)}
              onBlur={e => applyDepth(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') applyDepth(e.target.value)
              }}
              className="w-16 bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-600 text-center"
            />
            <span className="text-gray-500">units</span>
          </div>
        </div>

        <button
          onClick={handleMerge}
          className="px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap"
          style={{ background: 'linear-gradient(90deg,#7c3aed,#6d28d9)', color: 'white', boxShadow: '0 0 10px rgba(124,58,237,0.3)' }}
          onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.15)'}
          onMouseLeave={e => e.currentTarget.style.filter = ''}
        >
          ⊕ Merge
        </button>

        <button
          onClick={handleKeep}
          className="px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap"
          style={{ background: '#374151', color: '#d1d5db' }}
          onMouseEnter={e => e.currentTarget.style.background = '#4b5563'}
          onMouseLeave={e => e.currentTarget.style.background = '#374151'}
        >
          Keep
        </button>

        <button
          onClick={handleCancel}
          className="text-gray-600 hover:text-gray-300 text-base leading-none transition-colors px-1"
          title="Cancel extrude"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
