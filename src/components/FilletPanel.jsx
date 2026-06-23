import { useState } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../stores/sceneStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { applyFillet } from '../managers/FilletTool.js'
import { useHistory } from '../hooks/useHistory.js'

const UNSUPPORTED = ['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo', 'gear', 'bolt', 'screw']

export default function FilletPanel({ obj }) {
  const addCSGObject = useSceneStore(s => s.addCSGObject)
  const removeObject = useSceneStore(s => s.removeObject)
  const { snapshot } = useHistory()

  const [radius,   setRadius]   = useState(0.2)
  const [segments, setSegments] = useState(2)
  const [angle,    setAngle]    = useState(30)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)

  if (UNSUPPORTED.includes(obj.type)) {
    return <div className="text-[10px] text-gray-500 text-center py-2">Not available for this object type</div>
  }

  const handleApply = () => {
    setError(null)
    setBusy(true)
    try {
      const mesh = objectManager.getMesh(obj.id)
      if (!mesh) { setError('Mesh not found'); setBusy(false); return }

      let srcGeo = null
      if (mesh.isGroup || mesh.type === 'Group') {
        mesh.traverse(c => { if (c.isMesh && !srcGeo) srcGeo = c.geometry })
      } else {
        srcGeo = mesh.geometry
      }
      if (!srcGeo) { setError('No geometry found'); setBusy(false); return }

      const geo = srcGeo.clone()
      const scaleMatrix = new THREE.Matrix4().makeScale(obj.scale.x, obj.scale.y, obj.scale.z)
      geo.applyMatrix4(scaleMatrix)

      const result = applyFillet(geo, parseFloat(radius), parseInt(segments), parseFloat(angle))
      result.computeBoundingBox()
      const center = new THREE.Vector3()
      result.boundingBox.getCenter(center)
      result.translate(-center.x, -center.y, -center.z)

      const newPos = {
        x: obj.position.x + center.x,
        y: obj.position.y + center.y,
        z: obj.position.z + center.z,
      }

      addCSGObject(`${obj.name}_filleted`, result.toJSON(), obj.color, newPos, { x:0, y:0, z:0 }, { x:1, y:1, z:1 })
      removeObject(obj.id)
      snapshot()
    } catch (e) {
      setError(e.message)
      console.error('[FilletPanel]', e)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      {/* Mode: Fillet vs Bevel */}
      <div className="flex gap-1">
        <button
          onClick={() => setSegments(1)}
          className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
            segments === 1
<<<<<<< HEAD
              ? 'bg-indigo-700/40 text-indigo-300 border border-indigo-600/50'
=======
              ? 'bg-amber-700/40 text-amber-300 border border-amber-600/50'
>>>>>>> master
              : 'bg-gray-700/40 text-gray-500 hover:text-gray-300'
          }`}
        >◧ Chamfer</button>
        <button
          onClick={() => setSegments(3)}
          className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
            segments >= 2
<<<<<<< HEAD
              ? 'bg-indigo-700/40 text-indigo-300 border border-indigo-600/50'
=======
              ? 'bg-amber-700/40 text-amber-300 border border-amber-600/50'
>>>>>>> master
              : 'bg-gray-700/40 text-gray-500 hover:text-gray-300'
          }`}
        >◔ Fillet</button>
      </div>

      {/* Radius */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Radius</div>
<<<<<<< HEAD
          <div className="text-[10px] text-indigo-400">{radius.toFixed(2)}</div>
=======
          <div className="text-[10px] text-amber-400">{radius.toFixed(2)}</div>
>>>>>>> master
        </div>
        <input
          type="range" min={0.05} max={2} step={0.05}
          value={radius}
          onChange={e => setRadius(parseFloat(e.target.value))}
<<<<<<< HEAD
          className="w-full accent-indigo-500"
=======
          className="w-full accent-amber-500"
>>>>>>> master
        />
      </div>

      {/* Segments (only for fillet mode) */}
      {segments >= 2 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Smoothness</div>
<<<<<<< HEAD
            <div className="text-[10px] text-indigo-400">{segments}</div>
=======
            <div className="text-[10px] text-amber-400">{segments}</div>
>>>>>>> master
          </div>
          <input
            type="range" min={2} max={6} step={1}
            value={segments}
            onChange={e => setSegments(parseInt(e.target.value))}
<<<<<<< HEAD
            className="w-full accent-indigo-500"
=======
            className="w-full accent-amber-500"
>>>>>>> master
          />
        </div>
      )}

      {/* Edge angle threshold */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider">Min Edge Angle</div>
<<<<<<< HEAD
          <div className="text-[10px] text-indigo-400">{angle}°</div>
=======
          <div className="text-[10px] text-amber-400">{angle}°</div>
>>>>>>> master
        </div>
        <input
          type="range" min={10} max={90} step={5}
          value={angle}
          onChange={e => setAngle(parseInt(e.target.value))}
<<<<<<< HEAD
          className="w-full accent-indigo-500"
=======
          className="w-full accent-amber-500"
>>>>>>> master
        />
        <div className="text-[9px] text-gray-600">Only sharper edges than this angle are beveled</div>
      </div>

      {error && <div className="text-[10px] text-red-400 bg-red-900/20 rounded p-2">{error}</div>}

      <button
        onClick={handleApply}
        disabled={busy}
<<<<<<< HEAD
        className="w-full py-2 rounded text-xs bg-indigo-700/40 hover:bg-indigo-600/50 border border-indigo-600/50 text-indigo-300 font-semibold transition-colors disabled:opacity-50"
=======
        className="w-full py-2 rounded text-xs bg-amber-700/40 hover:bg-amber-600/50 border border-amber-600/50 text-amber-300 font-semibold transition-colors disabled:opacity-50"
>>>>>>> master
      >
        {busy ? '⏳ Applying…' : (segments === 1 ? '◧ Apply Chamfer' : '◔ Apply Fillet')}
      </button>

      <div className="text-[9px] text-gray-600">
        Replaces the object with a filleted version. Undo to revert.
      </div>
    </div>
  )
}
