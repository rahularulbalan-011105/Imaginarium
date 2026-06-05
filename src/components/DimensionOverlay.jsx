import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { useSceneStore } from '../stores/sceneStore.js'

const fmt = v => v.toFixed(2)

// For a simple Mesh: geometry local size × scale (rotation-independent).
// For a Group (electronics): fall back to world AABB size.
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

export default function DimensionOverlay() {
  const selectedId = useSceneStore(s => s.selectedId)
  const [d, setD] = useState(null)
  const rafRef = useRef(null)

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

      // World-space AABB → screen bbox (used to position annotation lines)
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

  if (!d) return null

  const { size, x0, x1, y0, y1 } = d
  const G  = 32   // gap between bbox edge and dimension line
  const EL = 10   // extension line overshoot past dim line

  const topY = y0 - G       // width (X) line
  const rgtX = x1 + G       // height (Y) line
  const botY = y1 + G       // depth (Z) line

  const midX = (x0 + x1) / 2
  const midY = (y0 + y1) / 2

  // Label box dimensions
  const LW = 54, LH = 18, LR = 3

  return (
    <svg
      className="absolute inset-0 pointer-events-none select-none"
      style={{ width: '100%', height: '100%' }}
    >
      <defs>
        {/* Arrow pointing right / down (for markerEnd) */}
        <marker id="dimA" markerWidth="7" markerHeight="5.4" refX="6.5" refY="2.7" orient="auto">
          <polygon points="0,0 7,2.7 0,5.4" fill="#1e293b" />
        </marker>
        {/* Arrow pointing left / up (for markerStart) */}
        <marker id="dimAr" markerWidth="7" markerHeight="5.4" refX="0.5" refY="2.7" orient="auto">
          <polygon points="7,0 0,2.7 7,5.4" fill="#1e293b" />
        </marker>
      </defs>

      {/* ── Width (X) — top ──────────────────────────────────────────── */}
      {/* Extension lines from bbox top corners to dim line */}
      <line x1={x0} y1={y0} x2={x0} y2={topY - EL} stroke="#94a3b8" strokeWidth="0.75" />
      <line x1={x1} y1={y0} x2={x1} y2={topY - EL} stroke="#94a3b8" strokeWidth="0.75" />
      {/* Dim line with arrowheads */}
      <line
        x1={x0 + 1} y1={topY} x2={x1 - 1} y2={topY}
        stroke="#1e293b" strokeWidth="1.5"
        markerStart="url(#dimAr)" markerEnd="url(#dimA)"
      />
      {/* Label */}
      <rect x={midX - LW / 2} y={topY - LH - 5} width={LW} height={LH} rx={LR}
        fill="white" stroke="#cbd5e1" strokeWidth="0.75" filter="drop-shadow(0 1px 2px rgba(0,0,0,.08))" />
      <text
        x={midX} y={topY - LH / 2 - 5}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="11.5" fill="#0f172a"
        fontFamily="ui-monospace,'Cascadia Code',monospace" fontWeight="600"
      >
        {fmt(size.x)}
      </text>

      {/* ── Height (Y) — right ───────────────────────────────────────── */}
      <line x1={x1} y1={y0} x2={rgtX + EL} y2={y0} stroke="#94a3b8" strokeWidth="0.75" />
      <line x1={x1} y1={y1} x2={rgtX + EL} y2={y1} stroke="#94a3b8" strokeWidth="0.75" />
      <line
        x1={rgtX} y1={y0 + 1} x2={rgtX} y2={y1 - 1}
        stroke="#1e293b" strokeWidth="1.5"
        markerStart="url(#dimAr)" markerEnd="url(#dimA)"
      />
      <rect x={rgtX + 7} y={midY - LH / 2} width={LW} height={LH} rx={LR}
        fill="white" stroke="#cbd5e1" strokeWidth="0.75" filter="drop-shadow(0 1px 2px rgba(0,0,0,.08))" />
      <text
        x={rgtX + 7 + LW / 2} y={midY}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="11.5" fill="#0f172a"
        fontFamily="ui-monospace,'Cascadia Code',monospace" fontWeight="600"
      >
        {fmt(size.y)}
      </text>

      {/* ── Depth (Z) — bottom ──────────────────────────────────────── */}
      <line x1={x0} y1={y1} x2={x0} y2={botY + EL} stroke="#94a3b8" strokeWidth="0.75" />
      <line x1={x1} y1={y1} x2={x1} y2={botY + EL} stroke="#94a3b8" strokeWidth="0.75" />
      <line
        x1={x0 + 1} y1={botY} x2={x1 - 1} y2={botY}
        stroke="#475569" strokeWidth="1.5" strokeDasharray="4,2"
        markerStart="url(#dimAr)" markerEnd="url(#dimA)"
      />
      <rect x={midX - LW / 2} y={botY + 5} width={LW} height={LH} rx={LR}
        fill="white" stroke="#e2e8f0" strokeWidth="0.75" filter="drop-shadow(0 1px 2px rgba(0,0,0,.06))" />
      <text
        x={midX} y={botY + 5 + LH / 2}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="11.5" fill="#475569"
        fontFamily="ui-monospace,'Cascadia Code',monospace" fontWeight="500"
      >
        {fmt(size.z)}
      </text>

      {/* Axis labels (tiny) */}
      <text x={x0 - 4} y={topY - 2} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="sans-serif">W</text>
      <text x={rgtX - 4} y={y0 - 2} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="sans-serif">H</text>
      <text x={x0 - 4} y={botY + 2} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="sans-serif">D</text>
    </svg>
  )
}
