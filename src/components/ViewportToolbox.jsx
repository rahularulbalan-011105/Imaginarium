import { memo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { patchManager } from '../managers/PatchManager.js'
import Icon from './ui/Icon.jsx'
import { GLASS, glassStyle } from './ui/surfaces.js'

// ─────────────────────────────────────────────────────────────────────────────
// ViewportToolbox — "Quick Tools": a floating, draggable, minimizable overlay on
// the 3D viewport (never a layout column — the canvas is not resized). It holds
// ONLY the tools used constantly while modeling:
//
//   Move · Rotate · Scale
//   Surface · Extrude · Slice
//   Snap-Move · Snap-Rotate · Guides · Grid · Axes
//
// The 3D-print build plate lives in Settings. Position + minimized state are in
// uiStore.quickTools (session-scoped). Dragging starts only from the header, and
// the box is clamped inside the viewport — re-clamped when the viewport resizes.
// PRESENTATION ONLY: every control calls the same store action it always did.
// ─────────────────────────────────────────────────────────────────────────────

const TRANSFORM_MODES = [
  { mode: 'translate', label: 'Move',   icon: 'move',   key: 'W', desc: 'Move the selected object along the arrows' },
  { mode: 'rotate',    label: 'Rotate', icon: 'rotate', key: 'E', desc: 'Rotate the selected object around the rings' },
  { mode: 'scale',     label: 'Scale',  icon: 'scale',  key: 'R', desc: 'Resize the selected object with the handles' },
]

const TRANSLATE_STEPS = [0, 0.5, 1, 2]
const ROTATE_STEPS    = [0, 15, 45, 90]
const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length] ?? arr[0]
const EDGE = 8   // min gap kept between the box and the viewport edge

// A single equal-size tool tile — consistent size / radius / spacing, with a
// clear hover tint and a solid accent active state.
function Tile({ icon, label, onClick, title, active, dataTour, badge, corner }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      data-tour={dataTour}
      className="relative flex flex-col items-center justify-center gap-0.5 h-12 rounded-xl transition-all duration-200 hover:-translate-y-px active:translate-y-0"
      style={active
        ? { background: 'rgb(var(--a-600))', color: '#fff', boxShadow: '0 2px 8px rgb(var(--a-600) / 0.35)' }
        : { background: 'rgb(var(--g-800) / 0.55)', color: 'rgb(var(--g-300))' }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgb(var(--a-600) / 0.16)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'rgb(var(--g-800) / 0.55)' }}
    >
      <Icon name={icon} size={18} />
      {label && <span className="text-[8.5px] font-medium leading-none">{label}</span>}
      {corner && <span className="absolute top-1 right-1.5 text-[7px] font-mono leading-none" style={{ color: active ? '#fff' : 'rgb(var(--g-500))' }}>{corner}</span>}
      {badge != null && <span className="absolute bottom-0.5 text-[7px] leading-none" style={{ color: active ? '#fff' : 'rgb(var(--g-400))' }}>{badge}</span>}
    </button>
  )
}

const Divider = () => <div className="border-t my-1.5" style={{ borderColor: 'rgb(var(--g-600) / 0.4)' }} />

function ViewportToolbox() {
  const gridVisible       = useSceneStore((s) => s.gridVisible)
  const axesVisible       = useSceneStore((s) => s.axesVisible)
  const toggleGrid        = useSceneStore((s) => s.toggleGrid)
  const toggleAxes        = useSceneStore((s) => s.toggleAxes)
  const transformMode     = useUiStore((s) => s.transformMode)
  const setTransformMode  = useUiStore((s) => s.setTransformMode)
  const surfaceToolActive = useUiStore((s) => s.surfaceToolActive)
  const setSurfaceTool    = useUiStore((s) => s.setSurfaceTool)
  const extrudeToolActive = useUiStore((s) => s.extrudeToolActive)
  const setExtrudeTool    = useUiStore((s) => s.setExtrudeTool)
  const sliceToolActive   = useUiStore((s) => s.sliceToolActive)
  const setSliceTool      = useUiStore((s) => s.setSliceTool)
  const snapTranslate     = useUiStore((s) => s.snapTranslate)
  const setSnapTranslate  = useUiStore((s) => s.setSnapTranslate)
  const snapRotateDeg     = useUiStore((s) => s.snapRotateDeg)
  const setSnapRotateDeg  = useUiStore((s) => s.setSnapRotateDeg)
  const smartGuides       = useUiStore((s) => s.smartGuides)
  const setSmartGuides    = useUiStore((s) => s.setSmartGuides)
  const quick             = useUiStore((s) => s.quickTools)
  const setQuickTools     = useUiStore((s) => s.setQuickTools)
  const patchCount        = Object.keys(useSurfaceStore((s) => s.patches)).length

  const handleSurfaceTool = () => {
    if (!surfaceToolActive) { setExtrudeTool(false); setSliceTool(false); patchManager.clearExtrudeHover() }
    setSurfaceTool(!surfaceToolActive)
  }
  const handleExtrudeTool = () => {
    if (!extrudeToolActive) { setSurfaceTool(false); setSliceTool(false) }
    else patchManager.clearExtrudeHover()
    setExtrudeTool(!extrudeToolActive)
  }
  const handleSliceTool = () => {
    if (!sliceToolActive) { setSurfaceTool(false); setExtrudeTool(false); patchManager.clearExtrudeHover() }
    setSliceTool(!sliceToolActive)
  }

  // ── Drag (header only) + keep inside the viewport ─────────────────────────
  const boxRef = useRef(null)
  const drag = useRef(null)
  const clamp = useCallback((x, y) => {
    const box = boxRef.current, host = box?.parentElement
    if (!box || !host) return { x, y }
    const maxX = Math.max(EDGE, host.clientWidth - box.offsetWidth - EDGE)
    const maxY = Math.max(EDGE, host.clientHeight - box.offsetHeight - EDGE)
    return { x: Math.round(Math.min(Math.max(EDGE, x), maxX)), y: Math.round(Math.min(Math.max(EDGE, y), maxY)) }
  }, [])

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    // Controls inside the header (minimize) never start a drag.
    if (e.target.closest('button, input, select, textarea, [role="slider"]')) return
    e.preventDefault()   // no text selection while dragging
    drag.current = { dx: e.clientX - quick.x, dy: e.clientY - quick.y, id: e.pointerId, last: null }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const p = clamp(e.clientX - d.dx, e.clientY - d.dy)
    const box = boxRef.current
    if (box) { box.style.left = p.x + 'px'; box.style.top = p.y + 'px' }   // no React render per move
    d.last = p
  }
  const endDrag = (e) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    try { e.currentTarget.releasePointerCapture(d.id) } catch { /* already released */ }
    if (d.last) setQuickTools(d.last)
  }
  // Keyboard nudge on the focused header (accessibility): arrows; Shift = bigger step.
  const onHeaderKey = (e) => {
    const step = e.shiftKey ? 40 : 10
    const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!dir) return
    e.preventDefault(); e.stopPropagation()   // don't nudge the selected 3D object
    setQuickTools(clamp(quick.x + dir[0], quick.y + dir[1]))
  }

  // Re-clamp when the box grows (restored from minimized) or the viewport shrinks
  // (window resize, context panel opening), so it can never end up off-screen.
  useLayoutEffect(() => {
    const p = clamp(quick.x, quick.y)
    if (p.x !== quick.x || p.y !== quick.y) setQuickTools(p)
  }, [quick.minimized]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const host = boxRef.current?.parentElement
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const q = useUiStore.getState().quickTools
      const p = clamp(q.x, q.y)
      if (p.x !== q.x || p.y !== q.y) setQuickTools(p)
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [clamp, setQuickTools])

  const minimized = quick.minimized
  return (
    <div
      ref={boxRef}
      data-tour="toolbar"
      role="toolbar"
      aria-label="Quick Tools"
      className={`absolute z-20 flex flex-col pointer-events-auto ${GLASS}`}
      style={{ ...glassStyle, left: quick.x, top: quick.y, width: minimized ? 'auto' : 186, maxHeight: `calc(100% - ${EDGE * 2}px)` }}
    >
      <div
        className="flex items-center gap-1.5 pl-2 pr-1.5 py-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none touch-none rounded-2xl"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        tabIndex={0} onKeyDown={onHeaderKey}
        title="Drag to move · arrow keys nudge"
        aria-label="Quick Tools header — drag to move"
      >
        <Icon name="grip" size={12} style={{ color: 'rgb(var(--g-500))' }} />
        <Icon name="wrench" size={13} style={{ color: 'rgb(var(--a-600))' }} />
        <span className="text-[11px] font-bold tracking-wide whitespace-nowrap mr-auto" style={{ color: 'rgb(var(--g-200))' }}>Quick Tools</span>
        <button
          onClick={() => setQuickTools({ minimized: !minimized })}
          title={minimized ? 'Expand Quick Tools' : 'Minimize Quick Tools'}
          aria-label={minimized ? 'Expand Quick Tools' : 'Minimize Quick Tools'}
          aria-expanded={!minimized}
          className="ml-2 w-6 h-6 rounded-lg flex items-center justify-center ui-icon-btn"
        >
          <Icon name={minimized ? 'plus' : 'minus'} size={13} />
        </button>
      </div>

      {/* Hidden — not unmounted — when minimized: position and state are kept. */}
      <div className="px-2 pb-2.5 pt-0.5 flex-col" style={{ display: minimized ? 'none' : 'flex' }}>
        {/* ── Transform ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1">
          {TRANSFORM_MODES.map(({ mode, label, icon, key, desc }) => (
            <Tile
              key={mode}
              dataTour={`mode-${mode}`}
              icon={icon}
              label={label}
              corner={key}
              active={transformMode === mode}
              onClick={() => setTransformMode(mode)}
              title={`${label} (${key}) — ${desc}`}
            />
          ))}
        </div>

        <Divider />

        {/* ── Solid-edit tools ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1">
          <Tile icon="surface" label="Surface" active={surfaceToolActive} onClick={handleSurfaceTool} dataTour="tool-surface"
            badge={patchCount > 0 ? patchCount : null}
            title={surfaceToolActive ? 'Exit surface attach mode' : 'Surface Attach — click faces to snap objects together, or drag to draw a custom patch'} />
          <Tile icon="extrude" label="Extrude" active={extrudeToolActive} onClick={handleExtrudeTool}
            title={extrudeToolActive ? 'Exit extrude mode' : 'Extrude — click a face to pull it outward into a new solid'} />
          <Tile icon="slice" label="Slice" active={sliceToolActive} onClick={handleSliceTool}
            title={sliceToolActive ? 'Exit slice mode' : 'Slice — draw a line across a selected shape to cut it into two pieces'} />
        </div>

        <Divider />

        {/* ── Snap + View + Smart Guides ────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1">
          <Tile icon="magnet" label={snapTranslate > 0 ? `${snapTranslate}u` : 'Snap'} active={snapTranslate > 0}
            onClick={() => setSnapTranslate(cycle(TRANSLATE_STEPS, snapTranslate))}
            title="Move snap step (click to cycle: Off / 0.5 / 1 / 2 units)" />
          <Tile icon="rotate" label={snapRotateDeg > 0 ? `${snapRotateDeg}°` : 'Rot snap'} active={snapRotateDeg > 0}
            onClick={() => setSnapRotateDeg(cycle(ROTATE_STEPS, snapRotateDeg))}
            title="Rotation snap (click to cycle: Off / 15° / 45° / 90°)" />
          <Tile icon="guides" label="Guides" active={smartGuides} onClick={() => setSmartGuides(!smartGuides)}
            title={smartGuides ? 'Smart alignment guides: ON — click to turn off' : 'Smart alignment guides: OFF — click to turn on'} />
          <Tile icon="grid" label="Grid" active={gridVisible} onClick={toggleGrid} title="Toggle Grid [G]" />
          <Tile icon="axes" label="Axes" active={axesVisible} onClick={toggleAxes} title="Toggle Axes [A]" />
        </div>
      </div>
    </div>
  )
}

// Memoized: rendered with no props inside Viewport, which re-renders on every
// object change (mesh sync). Without this, each drag frame re-rendered it.
export default memo(ViewportToolbox)
