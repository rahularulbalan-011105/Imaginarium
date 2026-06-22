import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'

const fmt = v => v.toFixed(2)

function getActualSize(mesh) {
  if (mesh.isMesh && mesh.geometry) {
    mesh.geometry.computeBoundingBox()
    const ls = mesh.geometry.boundingBox.getSize(new THREE.Vector3())
    return new THREE.Vector3(
      ls.x * Math.abs(mesh.scale.x),
      ls.y * Math.abs(mesh.scale.y),
      ls.z * Math.abs(mesh.scale.z),
    )
  }
  return new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3())
}

function LabelBox({ left, top, width, height, radius, axis, val, editAxis, draftVal, onStartEdit, onDraftChange, onApply, onCancel }) {
  const isEditing = editAxis === axis
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        background: isEditing ? '#1d4ed8' : 'white',
        border: `1px solid ${isEditing ? '#60a5fa' : '#cbd5e1'}`,
        borderRadius: radius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,.12)',
        cursor: 'text',
        pointerEvents: 'auto',
        zIndex: 10,
        transition: 'background 0.1s',
      }}
      title="Click to edit"
      onClick={() => !isEditing && onStartEdit(axis, val)}
    >
      {isEditing ? (
        <input
          autoFocus
          type="number"
          value={draftVal}
          onChange={e => onDraftChange(e.target.value)}
          onBlur={e => onApply(axis, e.target.value)}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') onApply(axis, draftVal)
            if (e.key === 'Escape') onCancel()
          }}
          style={{
            width: '100%',
            height: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'white',
            fontSize: 11,
            fontFamily: "ui-monospace,'Cascadia Code',monospace",
            fontWeight: '700',
            textAlign: 'center',
            padding: '0 3px',
          }}
        />
      ) : (
        <span
          style={{
            fontSize: 11.5,
            fontFamily: "ui-monospace,'Cascadia Code',monospace",
            fontWeight: '600',
            color: '#0f172a',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        >
          {fmt(val)}
        </span>
      )}
    </div>
  )
}

export default function DimensionOverlay() {
  const selectedId   = useSceneStore(s => s.selectedId)
  const updateObject = useSceneStore(s => s.updateObject)
  const { snapshot } = useHistory()

  const [d, setD]           = useState(null)
  const rafRef              = useRef(null)
  const [editAxis, setEditAxis] = useState(null)
  const [draftVal, setDraftVal] = useState('')

  useEffect(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick)

      if (!selectedId || !sceneManager.camera || !sceneManager.renderer) {
        setD(null); return
      }
      const mesh = objectManager.getMesh(selectedId)
      if (!mesh) { setD(null); return }

      mesh.updateMatrixWorld(true)

      const size = getActualSize(mesh)

      const wb = new THREE.Box3().setFromObject(mesh)
      const dom = sceneManager.renderer.domElement
      const W = dom.clientWidth, H = dom.clientHeight

      const proj = v => {
        const p = v.clone().project(sceneManager.camera)
        if (p.z < -1 || p.z > 1) return null
        return [(p.x + 1) / 2 * W, (-p.y + 1) / 2 * H]
      }

      const { min: mn, max: mx } = wb
      const pts = [
        [mn.x,mn.y,mn.z],[mx.x,mn.y,mn.z],[mx.x,mx.y,mn.z],[mn.x,mx.y,mn.z],
        [mn.x,mn.y,mx.z],[mx.x,mn.y,mx.z],[mx.x,mx.y,mx.z],[mn.x,mx.y,mx.z],
      ].map(([x,y,z]) => proj(new THREE.Vector3(x,y,z))).filter(Boolean)

      if (pts.length < 4) { setD(null); return }

      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      const x0 = Math.min(...xs), x1 = Math.max(...xs)
      const y0 = Math.min(...ys), y1 = Math.max(...ys)

      if (x1 - x0 < 24 || y1 - y0 < 24) { setD(null); return }

      setD({ size, x0, x1, y0, y1 })
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [selectedId])

  const applyDimension = useCallback((axis, valStr) => {
    const obj = useSceneStore.getState().objects.find(o => o.id === selectedId)
    if (!obj || !d) { setEditAxis(null); return }

    const newSize = parseFloat(valStr)
    if (!isFinite(newSize) || newSize <= 0.001) { setEditAxis(null); return }

    const currentSize = axis === 'x' ? d.size.x : axis === 'y' ? d.size.y : d.size.z
    if (currentSize <= 0.001) { setEditAxis(null); return }

    const scaleFactor = newSize / currentSize
    const newScale = {
      x: axis === 'x' ? obj.scale.x * scaleFactor : obj.scale.x,
      y: axis === 'y' ? obj.scale.y * scaleFactor : obj.scale.y,
      z: axis === 'z' ? obj.scale.z * scaleFactor : obj.scale.z,
    }

    updateObject(obj.id, { scale: newScale })
    const mesh = objectManager.getMesh(obj.id)
    if (mesh) mesh.scale.set(newScale.x, newScale.y, newScale.z)
    snapshot()
    setEditAxis(null)
  }, [selectedId, d, updateObject, snapshot])

  const handleStartEdit = (axis, val) => {
    setEditAxis(axis)
    setDraftVal(String(val.toFixed(3)))
  }

  if (!d) return null

  const { size, x0, x1, y0, y1 } = d
  const G   = 32
  const EL  = 10
  const topY = y0 - G
  const rgtX = x1 + G
  const botY = y1 + G
  const midX = (x0 + x1) / 2
  const midY = (y0 + y1) / 2
  const LW = 56, LH = 20, LR = 4

  const labelProps = {
    width: LW, height: LH, radius: LR,
    editAxis, draftVal,
    onStartEdit: handleStartEdit,
    onDraftChange: setDraftVal,
    onApply: applyDimension,
    onCancel: () => setEditAxis(null),
  }

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
      {/* Dimension lines — still pointer-events-none */}
      <svg
        className="absolute inset-0"
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <defs>
          <marker id="dimA" markerWidth="7" markerHeight="5.4" refX="6.5" refY="2.7" orient="auto">
            <polygon points="0,0 7,2.7 0,5.4" fill="#1e293b" />
          </marker>
          <marker id="dimAr" markerWidth="7" markerHeight="5.4" refX="0.5" refY="2.7" orient="auto">
            <polygon points="7,0 0,2.7 7,5.4" fill="#1e293b" />
          </marker>
        </defs>

        {/* Width (X) — top */}
        <line x1={x0} y1={y0} x2={x0} y2={topY - EL} stroke="#94a3b8" strokeWidth="0.75" />
        <line x1={x1} y1={y0} x2={x1} y2={topY - EL} stroke="#94a3b8" strokeWidth="0.75" />
        <line x1={x0+1} y1={topY} x2={x1-1} y2={topY} stroke="#1e293b" strokeWidth="1.5" markerStart="url(#dimAr)" markerEnd="url(#dimA)" />
        <text x={x0-4} y={topY-2} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="sans-serif">W</text>

        {/* Height (Y) — right */}
        <line x1={x1} y1={y0} x2={rgtX+EL} y2={y0} stroke="#94a3b8" strokeWidth="0.75" />
        <line x1={x1} y1={y1} x2={rgtX+EL} y2={y1} stroke="#94a3b8" strokeWidth="0.75" />
        <line x1={rgtX} y1={y0+1} x2={rgtX} y2={y1-1} stroke="#1e293b" strokeWidth="1.5" markerStart="url(#dimAr)" markerEnd="url(#dimA)" />
        <text x={rgtX-4} y={y0-2} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="sans-serif">H</text>

        {/* Depth (Z) — bottom */}
        <line x1={x0} y1={y1} x2={x0} y2={botY+EL} stroke="#94a3b8" strokeWidth="0.75" />
        <line x1={x1} y1={y1} x2={x1} y2={botY+EL} stroke="#94a3b8" strokeWidth="0.75" />
        <line x1={x0+1} y1={botY} x2={x1-1} y2={botY} stroke="#475569" strokeWidth="1.5" strokeDasharray="4,2" markerStart="url(#dimAr)" markerEnd="url(#dimA)" />
        <text x={x0-4} y={botY+2} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="sans-serif">D</text>
      </svg>

      {/* Clickable label boxes (HTML so they can hold <input>) */}
      <LabelBox {...labelProps} left={midX - LW/2} top={topY - LH - 5} axis="x" val={size.x} />
      <LabelBox {...labelProps} left={rgtX + 7}    top={midY - LH/2}   axis="y" val={size.y} />
      <LabelBox {...labelProps} left={midX - LW/2} top={botY + 5}      axis="z" val={size.z} />
    </div>
  )
}
