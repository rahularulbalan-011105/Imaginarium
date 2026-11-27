import { memo } from 'react'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { patchManager } from '../managers/PatchManager.js'
import Icon from './ui/Icon.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// ViewportToolbox — the editing toolbar docked at the top-left of the 3D view
// (Tinkercad-style: one quiet row of icon buttons, grouped by hairlines, names
// in tooltips). It holds only the tools used constantly while modeling:
//
//   Select (Tinkercad handles) · Move · Rotate · Scale | Attach · Extrude · Slice | Snap · Turn snap · Guides | Grid · Axes
//
// PRESENTATION ONLY: every control calls the same store action it always did.
// ─────────────────────────────────────────────────────────────────────────────

const TRANSFORM_MODES = [
  { mode: 'handles',   label: 'Select', icon: 'pointer', key: 'Q', desc: 'drag a part to move it; white squares resize, the cone lifts, curved arrows turn' },
  { mode: 'translate', label: 'Move',   icon: 'move',   key: 'W', desc: 'drag the arrows to move the selected part' },
  { mode: 'rotate',    label: 'Rotate', icon: 'rotate', key: 'E', desc: 'drag the rings to turn the selected part' },
  { mode: 'scale',     label: 'Scale',  icon: 'scale',  key: 'R', desc: 'drag the handles to resize the selected part' },
]

const TRANSLATE_STEPS = [0, 0.5, 1, 2]
const ROTATE_STEPS    = [0, 15, 45, 90]
const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length] ?? arr[0]
function Tool({ icon, onClick, title, active, dataTour, badge, setting }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={!!active} data-tour={dataTour}
      className={setting ? 'ui-tool ui-tool-setting' : 'ui-tool'}>
      <Icon name={icon} size={18} />
      {badge != null && (
        <span className="absolute bottom-0.5 right-0.5 text-[8.5px] font-semibold leading-none px-0.5 rounded"
          style={{ background: 'rgb(var(--g-900))', color: 'rgb(var(--a-700))' }}>{badge}</span>
      )}
    </button>
  )
}

const Sep = () => <span className="ui-tool-sep" aria-hidden="true" />

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
      role="toolbar"
      aria-label="Edit tools"
      className="absolute z-20 top-3 left-3 flex items-center gap-0.5 p-1 rounded-lg pointer-events-auto"
      style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 1px 3px rgb(0 0 0 / 0.08)' }}
    >
      {TRANSFORM_MODES.map(({ mode, label, icon, key, desc }) => (
        <Tool key={mode} dataTour={`mode-${mode}`} icon={icon} active={transformMode === mode}
          onClick={() => setTransformMode(mode)} title={`${label} (${key}): ${desc}`} />
      ))}
      <Sep />
      <Tool icon="surface" active={surfaceToolActive} onClick={handleSurfaceTool} dataTour="tool-surface"
        badge={patchCount > 0 ? patchCount : null}
        title={surfaceToolActive ? 'Stop attaching' : 'Attach: click a face on each part to stick them together'} />
      <Tool icon="extrude" active={extrudeToolActive} onClick={handleExtrudeTool}
        title={extrudeToolActive ? 'Stop extruding' : 'Extrude: click a face and pull it out'} />
      <Tool icon="slice" active={sliceToolActive} onClick={handleSliceTool}
        title={sliceToolActive ? 'Stop slicing' : 'Slice: draw a line across a shape to cut it in two'} />
      <Sep />
      <Tool icon="magnet" setting active={snapTranslate > 0} badge={snapTranslate > 0 ? snapTranslate : null}
        onClick={() => setSnapTranslate(cycle(TRANSLATE_STEPS, snapTranslate))}
        title={`Move snap: ${snapTranslate > 0 ? snapTranslate + ' units' : 'off'} (click to change)`} />
      <Tool icon="rotate" setting active={snapRotateDeg > 0} badge={snapRotateDeg > 0 ? snapRotateDeg + '°' : null}
        onClick={() => setSnapRotateDeg(cycle(ROTATE_STEPS, snapRotateDeg))}
        title={`Turn snap: ${snapRotateDeg > 0 ? snapRotateDeg + '°' : 'off'} (click to change)`} />
      <Tool icon="guides" setting active={smartGuides} onClick={() => setSmartGuides(!smartGuides)}
        title={smartGuides ? 'Alignment guides: on' : 'Alignment guides: off'} />
      <Sep />
      <Tool icon="grid" setting active={gridVisible} onClick={toggleGrid} title="Show grid (G)" />
      <Tool icon="axes" setting active={axesVisible} onClick={toggleAxes} title="Show axes (A)" />
    </div>
  )
}

// Memoized: rendered with no props inside Viewport, which re-renders on every
// object change (mesh sync). Without this, each drag frame re-rendered it.
export default memo(ViewportToolbox)
