import { useEffect, useRef, useState } from 'react'
import { sceneManager } from '../managers/SceneManager.js'
import Icon from './ui/Icon.jsx'
import { GLASS, glassStyle } from './ui/surfaces.js'

// ─────────────────────────────────────────────────────────────────────────────
// ViewGizmo — an interactive View Cube pinned to the viewport's top-right corner.
// Clicking a visible face of the iso cube snaps the camera to that orientation;
// a pop-out grid exposes the remaining faces + Home (isometric). It reuses the
// existing sceneManager.setView() / getViewLabel() API only — no manager change,
// no camera-control change. Purely a redesigned presentation of the prior gizmo
// (relocated & restyled, NOT duplicated).
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = [
  { key: 'top',    label: 'Top' },
  { key: 'front',  label: 'Front' },
  { key: 'right',  label: 'Right' },
  { key: 'back',   label: 'Back' },
  { key: 'left',   label: 'Left' },
  { key: 'bottom', label: 'Bottom' },
]

// Iso-cube face polygons (viewBox 0 0 100 100). Top diamond + two side faces.
const FACES = {
  top:   { pts: '50,14 84,33 50,52 16,33', view: 'top',   label: 'Top' },
  left:  { pts: '16,33 50,52 50,90 16,71', view: 'front', label: 'Front' },
  right: { pts: '84,33 50,52 50,90 84,71', view: 'right', label: 'Right' },
}

export default function ViewGizmo() {
  const [label, setLabel] = useState('Perspective')
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(null)
  const rafRef = useRef(null)

  // Poll the camera orientation each frame so the label reflects orbiting.
  useEffect(() => {
    let mounted = true
    const tick = () => {
      if (!mounted) return
      const l = sceneManager.getViewLabel?.()
      if (l) setLabel((prev) => (prev === l ? prev : l))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { mounted = false; if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const go = (key) => { sceneManager.setView(key); setOpen(false) }

  const faceFill = (f) => {
    const active = label === FACES[f].label
    if (hover === f) return 'rgb(var(--a-500) / 0.9)'
    if (active)      return 'rgb(var(--a-600) / 0.85)'
    // gentle top-lighter / sides-darker shading so the cube reads as 3D
    return f === 'top' ? 'rgb(var(--g-700) / 0.95)'
      : f === 'left'  ? 'rgb(var(--g-800) / 0.95)'
      :                 'rgb(var(--g-900) / 0.95)'
  }

  return (
    <div className="absolute top-3 right-3 z-20 select-none flex flex-col items-end gap-1.5 pointer-events-none">
      {/* Interactive iso cube */}
      <div className={`p-1.5 pointer-events-auto ${GLASS}`} style={glassStyle}>
        <div className="flex items-center gap-1">
          <svg width="60" height="60" viewBox="0 0 100 100" role="group" aria-label="View cube">
            {Object.keys(FACES).map((f) => (
              <g key={f}>
                <polygon
                  points={FACES[f].pts}
                  style={{ fill: faceFill(f), stroke: 'rgb(var(--g-500) / 0.6)', strokeWidth: 1.2, cursor: 'pointer', transition: 'fill 150ms ease' }}
                  onMouseEnter={() => setHover(f)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => go(FACES[f].view)}
                >
                  <title>{FACES[f].label} view</title>
                </polygon>
                <text
                  x={f === 'top' ? 50 : f === 'left' ? 33 : 67}
                  y={f === 'top' ? 35 : 66}
                  textAnchor="middle"
                  style={{ fontSize: 8.5, fontWeight: 700, fill: hover === f || label === FACES[f].label ? '#fff' : 'rgb(var(--g-400))', pointerEvents: 'none' }}
                >
                  {FACES[f].label.slice(0, 1)}
                </text>
              </g>
            ))}
          </svg>

          {/* Expand to reach every face + Home */}
          <button
            onClick={() => setOpen((o) => !o)}
            title="All views"
            className="flex items-center justify-center w-6 h-6 rounded-lg transition-colors"
            style={{ color: 'rgb(var(--g-400))' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--a-600) / 0.16)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
          </button>
        </div>

        {/* Current-view label */}
        <div className="text-center text-[9px] font-semibold tracking-wide pt-0.5" style={{ color: 'rgb(var(--a-400))' }}>
          {label}
        </div>
      </div>

      {/* Full quick-view grid (all six faces + Home) */}
      {open && (
        <div className={`p-2 pointer-events-auto ${GLASS}`} style={glassStyle}>
          <div className="grid grid-cols-3 gap-1 mb-1">
            {VIEWS.map((v) => {
              const active = label === v.label
              return (
                <button
                  key={v.key}
                  onClick={() => go(v.key)}
                  title={`${v.label} view`}
                  className="px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-colors"
                  style={active
                    ? { background: 'rgb(var(--a-600))', color: '#fff' }
                    : { background: 'rgb(var(--g-800) / 0.6)', color: 'rgb(var(--g-300))' }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgb(var(--a-600) / 0.16)' }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'rgb(var(--g-800) / 0.6)' }}
                >
                  {v.label}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => go('home')}
            title="Home / isometric view"
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-colors"
            style={label === 'Perspective'
              ? { background: 'rgb(var(--a-600))', color: '#fff' }
              : { background: 'rgb(var(--g-800) / 0.6)', color: 'rgb(var(--g-300))' }}
          >
            <Icon name="home" size={12} /> Home (Iso)
          </button>
        </div>
      )}
    </div>
  )
}
