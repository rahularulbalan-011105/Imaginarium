import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { patchManager } from '../managers/PatchManager.js'
import Icon from './ui/Icon.jsx'
import { GLASS, glassStyle } from './ui/surfaces.js'

// ─────────────────────────────────────────────────────────────────────────────
// ViewportToolbox — the compact, floating glass toolbox pinned to the viewport's
// top-left corner. Like Blender's transform toolbar / Fusion's viewport controls,
// it now holds ONLY the tools used constantly while modeling:
//
//   Move · Rotate · Scale
//   Surface · Extrude · Slice
//   Snap-Move · Snap-Rotate · Grid · Axes
//   Bed · Grid Size
//
// Object / electronics / mechanical CREATION lives in the right workspace
// (Library, Electronics, Mechanical sections) — this toolbox never creates
// objects. PRESENTATION ONLY: every control calls the same existing store
// action it always did. `mode-*` tutorial anchors stay here (transform tools).
// ─────────────────────────────────────────────────────────────────────────────

const TRANSFORM_MODES = [
  { mode: 'translate', label: 'Move',   icon: 'move',   key: 'W', desc: 'Move the selected object along the arrows' },
  { mode: 'rotate',    label: 'Rotate', icon: 'rotate', key: 'E', desc: 'Rotate the selected object around the rings' },
  { mode: 'scale',     label: 'Scale',  icon: 'scale',  key: 'R', desc: 'Resize the selected object with the handles' },
]

const TRANSLATE_STEPS = [0, 0.5, 1, 2]
const ROTATE_STEPS    = [0, 15, 45, 90]
const BED_SIZES       = [180, 220, 256, 300]
const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length] ?? arr[0]

// A single equal-size tool tile — consistent size / radius / spacing, with a
// clear hover tint and a solid accent active state.
function Tile({ icon, label, onClick, title, active, dataTour, badge, corner }) {
  return (
    <button
      onClick={onClick}
      title={title}
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

export default function ViewportToolbox() {
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
  const printBedVisible   = useUiStore((s) => s.printBedVisible)
  const setPrintBedVisible= useUiStore((s) => s.setPrintBedVisible)
  const printBedSizeMm    = useUiStore((s) => s.printBedSizeMm)
  const setPrintBedSizeMm = useUiStore((s) => s.setPrintBedSizeMm)
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

  return (
    <div
      data-tour="toolbar"
      className={`absolute top-3 left-3 z-20 w-[176px] flex flex-col pointer-events-auto ${GLASS}`}
      style={{ ...glassStyle, maxHeight: 'calc(100% - 24px)' }}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 shrink-0">
        <Icon name="move" size={13} style={{ color: 'rgb(var(--a-500))' }} />
        <span className="text-[11px] font-bold tracking-wide" style={{ color: 'rgb(var(--g-200))' }}>Tools</span>
      </div>

      <div className="px-2 pb-2.5 pt-1 flex flex-col">
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
          <Tile icon="surface" label="Surface" active={surfaceToolActive} onClick={handleSurfaceTool}
            badge={patchCount > 0 ? patchCount : null}
            title={surfaceToolActive ? 'Exit surface attach mode' : 'Surface Attach — click faces to snap objects together, or drag to draw a custom patch'} />
          <Tile icon="extrude" label="Extrude" active={extrudeToolActive} onClick={handleExtrudeTool}
            title={extrudeToolActive ? 'Exit extrude mode' : 'Extrude — click a face to pull it outward into a new solid'} />
          <Tile icon="slice" label="Slice" active={sliceToolActive} onClick={handleSliceTool}
            title={sliceToolActive ? 'Exit slice mode' : 'Slice — draw a line across a selected shape to cut it into two pieces'} />
        </div>

        <Divider />

        {/* ── Snap + View ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-1">
          <Tile icon="magnet" label={snapTranslate > 0 ? `${snapTranslate}u` : 'Move'} active={snapTranslate > 0}
            onClick={() => setSnapTranslate(cycle(TRANSLATE_STEPS, snapTranslate))}
            title="Move snap step (click to cycle: Off / 0.5 / 1 / 2 units)" />
          <Tile icon="rotate" label={snapRotateDeg > 0 ? `${snapRotateDeg}°` : 'Rot'} active={snapRotateDeg > 0}
            onClick={() => setSnapRotateDeg(cycle(ROTATE_STEPS, snapRotateDeg))}
            title="Rotation snap (click to cycle: Off / 15° / 45° / 90°)" />
          <Tile icon="grid" label="Grid" active={gridVisible} onClick={toggleGrid} title="Toggle Grid [G]" />
          <Tile icon="axes" label="Axes" active={axesVisible} onClick={toggleAxes} title="Toggle Axes [A]" />
        </div>

        <Divider />

        {/* ── 3D-print build plate ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1">
          <Tile icon="printer" label="Bed" active={printBedVisible} onClick={() => setPrintBedVisible(!printBedVisible)}
            title={`Toggle the 3D-printer build plate (${printBedSizeMm} mm)`} />
          <Tile icon="grid" label={`${printBedSizeMm}mm`} onClick={() => setPrintBedSizeMm(cycle(BED_SIZES, printBedSizeMm))}
            title="Build-plate size (click to cycle: 180 / 220 / 256 / 300 mm)" />
        </div>
      </div>
    </div>
  )
}
