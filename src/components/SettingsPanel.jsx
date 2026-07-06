import { useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { getTheme, toggleTheme } from '../theme/theme.js'
import Icon from './ui/Icon.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// SettingsPanel — a consolidated home for workspace settings that were spread
// across the header (theme) and the toolbar (grid / axes / snap / print bed).
// PRESENTATION ONLY: every control calls the SAME existing store action the old
// UI used, so behavior is identical — this only groups them in one place.
// ─────────────────────────────────────────────────────────────────────────────

const TRANSLATE_STEPS = [0, 0.5, 1, 2]
const ROTATE_STEPS    = [0, 15, 45, 90]
const BED_SIZES       = [180, 220, 256, 300]
const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length] ?? arr[0]

function SectionTitle({ children }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgb(var(--g-500))' }}>
      {children}
    </div>
  )
}

// A labeled row with a right-aligned toggle/cycle button.
function Row({ icon, label, hint, active, valueLabel, onClick }) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors"
      style={{ background: 'rgb(var(--g-800) / 0.5)', color: 'rgb(var(--g-200))' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--a-600) / 0.12)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgb(var(--g-800) / 0.5)')}
    >
      <Icon name={icon} size={16} style={{ color: active ? 'rgb(var(--a-500))' : 'rgb(var(--g-400))' }} />
      <span className="text-xs font-medium flex-1 text-left">{label}</span>
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
        style={active
          ? { background: 'rgb(var(--a-600) / 0.2)', color: 'rgb(var(--a-400))' }
          : { background: 'rgb(var(--g-700) / 0.6)', color: 'rgb(var(--g-400))' }}>
        {valueLabel}
      </span>
    </button>
  )
}

export default function SettingsPanel() {
  const gridVisible = useSceneStore((s) => s.gridVisible)
  const axesVisible = useSceneStore((s) => s.axesVisible)
  const toggleGrid  = useSceneStore((s) => s.toggleGrid)
  const toggleAxes  = useSceneStore((s) => s.toggleAxes)

  const snapTranslate     = useUiStore((s) => s.snapTranslate)
  const setSnapTranslate  = useUiStore((s) => s.setSnapTranslate)
  const snapRotateDeg     = useUiStore((s) => s.snapRotateDeg)
  const setSnapRotateDeg  = useUiStore((s) => s.setSnapRotateDeg)
  const printBedVisible   = useUiStore((s) => s.printBedVisible)
  const setPrintBedVisible= useUiStore((s) => s.setPrintBedVisible)
  const printBedSizeMm    = useUiStore((s) => s.printBedSizeMm)
  const setPrintBedSizeMm = useUiStore((s) => s.setPrintBedSizeMm)
  const smartGuides       = useUiStore((s) => s.smartGuides)
  const setSmartGuides    = useUiStore((s) => s.setSmartGuides)
  const snapObject        = useUiStore((s) => s.snapObject)
  const setSnapObject     = useUiStore((s) => s.setSnapObject)
  const snapSurface       = useUiStore((s) => s.snapSurface)
  const setSnapSurface    = useUiStore((s) => s.setSnapSurface)

  const [theme, setTheme] = useState(getTheme)
  const handleToggleTheme = () => setTheme(toggleTheme())

  return (
    <div className="p-3 flex flex-col gap-4">
      {/* ── Appearance ─────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Appearance</SectionTitle>
        <Row
          icon={theme === 'dark' ? 'moon' : 'sun'}
          label="Theme"
          hint={theme === 'dark' ? 'Switch to Light mode' : 'Switch to Dark mode'}
          active
          valueLabel={theme === 'dark' ? 'Dark' : 'Light'}
          onClick={handleToggleTheme}
        />
      </div>

      {/* ── Viewport ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <SectionTitle>Viewport</SectionTitle>
        <Row icon="grid" label="Grid" hint="Toggle Grid [G]" active={gridVisible} valueLabel={gridVisible ? 'On' : 'Off'} onClick={toggleGrid} />
        <Row icon="axes" label="Axes" hint="Toggle Axes [A]" active={axesVisible} valueLabel={axesVisible ? 'On' : 'Off'} onClick={toggleAxes} />
      </div>

      {/* ── Snapping ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <SectionTitle>Snapping</SectionTitle>
        <Row icon="magnet" label="Move snap" hint="Cycle: Off / 0.5 / 1 / 2 units" active={snapTranslate > 0}
          valueLabel={snapTranslate > 0 ? `${snapTranslate}u` : 'Off'} onClick={() => setSnapTranslate(cycle(TRANSLATE_STEPS, snapTranslate))} />
        <Row icon="rotate" label="Rotate snap" hint="Cycle: Off / 15° / 45° / 90°" active={snapRotateDeg > 0}
          valueLabel={snapRotateDeg > 0 ? `${snapRotateDeg}°` : 'Off'} onClick={() => setSnapRotateDeg(cycle(ROTATE_STEPS, snapRotateDeg))} />
      </div>

      {/* ── Smart Alignment (guides + magnetic object/surface snapping) ─────── */}
      <div className="flex flex-col gap-1.5">
        <SectionTitle>Smart Alignment</SectionTitle>
        <Row icon="guides" label="Smart guides" hint="Show alignment guide lines + magnetic snapping while dragging"
          active={smartGuides} valueLabel={smartGuides ? 'On' : 'Off'} onClick={() => setSmartGuides(!smartGuides)} />
        <Row icon="layers" label="Object snap" hint="Snap to other objects' centers and edges"
          active={snapObject} valueLabel={snapObject ? 'On' : 'Off'} onClick={() => setSnapObject(!snapObject)} />
        <Row icon="surface" label="Surface snap" hint="Snap one object's face onto another (stacking)"
          active={snapSurface} valueLabel={snapSurface ? 'On' : 'Off'} onClick={() => setSnapSurface(!snapSurface)} />
      </div>

      {/* ── 3D Printing ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <SectionTitle>3D Printing</SectionTitle>
        <Row icon="printer" label="Build plate" hint="Toggle the 3D-printer build plate" active={printBedVisible}
          valueLabel={printBedVisible ? 'On' : 'Off'} onClick={() => setPrintBedVisible(!printBedVisible)} />
        <Row icon="grid" label="Plate size" hint="Cycle: 180 / 220 / 256 / 300 mm" active={false}
          valueLabel={`${printBedSizeMm}mm`} onClick={() => setPrintBedSizeMm(cycle(BED_SIZES, printBedSizeMm))} />
      </div>
    </div>
  )
}
