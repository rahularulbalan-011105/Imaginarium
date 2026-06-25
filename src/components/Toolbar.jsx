import { useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { patchManager } from '../managers/PatchManager.js'

// ── Readable text system — theme-aware (flips with light/dark) ───────────────
// These resolve to the neutral text channels in globals.css, so labels stay
// readable on the panel surface in BOTH themes.
const T_PRIMARY   = 'rgb(var(--g-200))'   // component names — high contrast
const T_SECONDARY = 'rgb(var(--g-400))'   // headers / labels
const T_MUTED     = 'rgb(var(--g-500))'   // counts / least important

const SHAPES = [
  { type: 'cylinder',    label: 'Cylinder',     icon: '⬤', key: '1' },
  { type: 'cone',        label: 'Cone',         icon: '🔺', key: '2' },
  { type: 'box',         label: 'Cube',         icon: '⬛', key: '3' },
  { type: 'sphere',      label: 'Sphere',       icon: '🔵', key: '4' },
  { type: 'tetrahedron', label: 'Tetrahedron',  icon: '△',  key: '5' },
  { type: 'pyramid',     label: 'Sq Pyramid',   icon: '▲',  key: '6' },
  { type: 'pentpyramid', label: 'Pent Pyramid', icon: '⛛', key: '7' },
  { type: 'octahedron',  label: 'Octahedron',   icon: '◈',  key: '8' },
  { type: 'dodecahedron',label: 'Dodecahedron', icon: '⬡',  key: '9' },
  { type: 'rectprism',   label: 'Rect Prism',   icon: '▭',  key: '0' },
]

const TRANSFORM_MODES = [
  { mode: 'translate', label: 'Move',   icon: '✛', key: 'W', desc: 'Move the selected object along the arrows' },
  { mode: 'rotate',    label: 'Rotate', icon: '↻', key: 'E', desc: 'Rotate the selected object around the rings' },
  { mode: 'scale',     label: 'Scale',  icon: '⤡', key: 'R', desc: 'Resize the selected object with the handles' },
]

// Electronics grouped by role. Only components the app actually supports are
// listed. Tooltip = name + purpose + example usage.
const ELEC_CATEGORIES = [
  {
    key: 'mcu', label: 'MCUs', icon: '🧠', hue: 'green',
    items: [
      { type: 'arduino', label: 'Arduino', icon: '🟢', tip: 'Arduino — programmable controller board that runs your code.\nUsed for: robot brains, automation, reading sensors.' },
      { type: 'subo',    label: 'SUBO',    icon: '🟣', tip: 'SUBO — controller board with built-in I/O ports.\nUsed for: fast prototyping, plug-and-play wiring.' },
    ],
  },
  {
    key: 'actuators', label: 'Actuators', icon: '⚙', hue: 'green',
    items: [
      { type: 'servo',    label: 'Servo',    icon: '🔩', tip: 'Servo — rotates to a precise angle (0–180°).\nUsed for: robot arms, steering, camera gimbals.' },
      { type: 'motor_dc', label: 'DC Motor', icon: '🔧', tip: 'DC Motor — spins continuously at a set speed.\nUsed for: wheels, fans, propellers.' },
      { type: 'motor_bo', label: 'BO Motor', icon: '⚙',  tip: 'BO Motor — geared DC motor with high torque.\nUsed for: driving robot wheels.' },
      { type: 'led',      label: 'LED',      icon: '💡', tip: 'LED — a light you switch on/off or dim from code.\nUsed for: status indicators, signals.' },
    ],
  },
]

const MECH = [
  { type: 'gear',  label: 'Gear',  icon: '⚙', tip: 'Spur Gear — mesh two gears to transfer motion.' },
  { type: 'bolt',  label: 'Bolt',  icon: '⬡', tip: 'Bolt — decorative fastener part.' },
  { type: 'screw', label: 'Screw', icon: '⊛', tip: 'Screw — decorative fastener part.' },
]

// ── Reusable section header ──────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div className="text-[10px] text-center uppercase tracking-[0.12em] font-semibold mb-1.5"
      style={{ color: T_SECONDARY }}>
      {children}
    </div>
  )
}

// Vertical button: icon over a bright, readable label.
function ToolButton({ icon, label, onClick, title, active, hueHover = 'indigo', dataTour, badge, shortcut }) {
  const hoverBg = {
    indigo: 'hover:bg-indigo-500/15',
    green:  'hover:bg-green-500/15',
    orange: 'hover:bg-orange-500/15',
  }[hueHover]
  return (
    <button
      onClick={onClick}
      title={title}
      data-tour={dataTour}
      className={`relative w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-all duration-150 ${
        active
          ? 'bg-indigo-600 shadow-[0_0_12px_rgb(var(--a-600)/0.18)]'
          : hoverBg
      }`}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-[10px] leading-tight text-center font-medium"
        style={{ color: active ? '#FFFFFF' : T_PRIMARY }}>
        {label}
      </span>
      {shortcut && (
        <span className="absolute top-1 right-1 text-[8px] font-mono leading-none" style={{ color: T_MUTED }}>{shortcut}</span>
      )}
      {badge != null && (
        <span className="text-[8px] leading-none" style={{ color: T_SECONDARY }}>{badge}</span>
      )}
    </button>
  )
}

export default function Toolbar() {
  const addObject = useSceneStore((s) => s.addObject)
  const gridVisible = useSceneStore((s) => s.gridVisible)
  const axesVisible = useSceneStore((s) => s.axesVisible)
  const toggleGrid = useSceneStore((s) => s.toggleGrid)
  const toggleAxes = useSceneStore((s) => s.toggleAxes)
  const transformMode     = useUiStore((s) => s.transformMode)
  const setTransformMode  = useUiStore((s) => s.setTransformMode)
  const surfaceToolActive = useUiStore((s) => s.surfaceToolActive)
  const setSurfaceTool    = useUiStore((s) => s.setSurfaceTool)
  const extrudeToolActive = useUiStore((s) => s.extrudeToolActive)
  const setExtrudeTool    = useUiStore((s) => s.setExtrudeTool)
  const simActive         = useUiStore((s) => s.simActive)
  const setSimActive      = useUiStore((s) => s.setSimActive)

  // Electronics categories default expanded so quick-add (and the tutorial
  // anchors) are always available.
  const [openElec, setOpenElec] = useState({ mcu: true, actuators: true })
  const toggleElec = (k) => setOpenElec((o) => ({ ...o, [k]: !o[k] }))

  const handleSurfaceTool = () => {
    if (!surfaceToolActive) { setExtrudeTool(false); patchManager.clearExtrudeHover() }
    setSurfaceTool(!surfaceToolActive)
  }
  const handleExtrudeTool = () => {
    if (!extrudeToolActive) setSurfaceTool(false)
    else patchManager.clearExtrudeHover()
    setExtrudeTool(!extrudeToolActive)
  }
  const patchCount        = Object.keys(useSurfaceStore((s) => s.patches)).length
  const { snapshot } = useHistory()

  const handleAddShape = (type) => {
    addObject(type)
    snapshot()
  }

  const divider = <div className="w-10 border-t border-gray-700/40 my-2.5 self-center" />

  return (
    <div className="flex flex-col w-full h-full bg-gray-900 py-3 px-1.5 overflow-y-auto overflow-x-hidden">
      {/* Shapes */}
      <div className="w-full">
        <SectionLabel>Add</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {SHAPES.map(({ type, label, icon, key }) => (
            <ToolButton
              key={type}
              dataTour={`shape-${type}`}
              icon={icon}
              label={label}
              shortcut={key}
              onClick={() => handleAddShape(type)}
              title={`${label}  ·  shortcut [${key}]`}
            />
          ))}
        </div>
      </div>

      {divider}

      {/* Transform modes */}
      <div className="w-full">
        <SectionLabel>Transform</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {TRANSFORM_MODES.map(({ mode, label, icon, key, desc }) => (
            <ToolButton
              key={mode}
              dataTour={`mode-${mode}`}
              icon={icon}
              label={label}
              shortcut={key}
              active={transformMode === mode}
              onClick={() => setTransformMode(mode)}
              title={`${label} (${key}) — ${desc}`}
            />
          ))}
        </div>
      </div>

      {divider}

      {/* Electronics — categorized */}
      <div className="w-full">
        <SectionLabel>Electronics</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {ELEC_CATEGORIES.map((cat) => {
            const open = !!openElec[cat.key]
            return (
              <div key={cat.key} className="rounded-lg border border-gray-700/40 overflow-hidden bg-gray-800/30">
                <button
                  onClick={() => toggleElec(cat.key)}
                  title={`${cat.label} (${cat.items.length})`}
                  className="w-full flex items-center gap-1 px-1.5 py-1 hover:bg-gray-700/40 transition-colors"
                >
                  <span className="text-xs leading-none">{cat.icon}</span>
                  <span className="text-[10px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis" style={{ color: T_SECONDARY }}>{cat.label}</span>
                  <span className="text-[9px]" style={{ color: T_MUTED }}>({cat.items.length})</span>
                  <span className="ml-auto text-[9px]" style={{ color: T_MUTED }}>{open ? '▾' : '▸'}</span>
                </button>
                {open && (
                  <div className="flex flex-col gap-0.5 p-1 pt-0.5">
                    {cat.items.map(({ type, label, icon, tip }) => (
                      <ToolButton
                        key={type}
                        dataTour={`elec-${type}`}
                        icon={icon}
                        label={label}
                        hueHover="green"
                        onClick={() => handleAddShape(type)}
                        title={tip}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {divider}

      {/* Mechanical parts */}
      <div className="w-full">
        <SectionLabel>Mechanical</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {MECH.map(({ type, label, icon, tip }) => (
            <ToolButton
              key={type}
              icon={icon}
              label={label}
              hueHover="orange"
              onClick={() => handleAddShape(type)}
              title={tip}
            />
          ))}
        </div>
      </div>

      {divider}

      {/* Join / Surface tool */}
      <div className="w-full">
        <SectionLabel>Join</SectionLabel>
        <button
          onClick={handleSurfaceTool}
          title={surfaceToolActive ? 'Exit surface attach mode' : 'Surface Attach — click faces to snap objects together, or drag to draw a custom patch'}
          className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-all duration-150 ${
            surfaceToolActive
              ? 'bg-cyan-500 ring-2 ring-cyan-300 shadow-lg shadow-cyan-500/30'
              : 'hover:bg-cyan-500/15 border border-cyan-800/40'
          }`}
        >
          <span className="text-base leading-none">⊞</span>
          <span className="text-[10px] font-medium leading-tight" style={{ color: surfaceToolActive ? '#FFFFFF' : T_PRIMARY }}>
            {surfaceToolActive ? 'Attaching' : 'Surface'}
          </span>
          {patchCount > 0 && (
            <span className="text-[8px] leading-none" style={{ color: T_SECONDARY }}>{patchCount} pts</span>
          )}
        </button>
      </div>

      {divider}

      {/* Edit / Extrude */}
      <div className="w-full">
        <SectionLabel>Edit</SectionLabel>
        <button
          onClick={handleExtrudeTool}
          title={extrudeToolActive ? 'Exit extrude mode' : 'Extrude — click a face to pull it outward into a new solid'}
          className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-all duration-150 ${
            extrudeToolActive
              ? 'bg-purple-500 ring-2 ring-purple-300 shadow-lg shadow-purple-500/30'
              : 'hover:bg-purple-500/15 border border-purple-800/40'
          }`}
        >
          <span className="text-base leading-none">⬆</span>
          <span className="text-[10px] font-medium leading-tight" style={{ color: extrudeToolActive ? '#FFFFFF' : T_PRIMARY }}>
            {extrudeToolActive ? 'Extruding' : 'Extrude'}
          </span>
        </button>
      </div>

      {divider}

      {/* Run / Simulate */}
      <div className="w-full">
        <SectionLabel>Run</SectionLabel>
        <button
          data-tour="simulate"
          onClick={() => setSimActive(!simActive)}
          title={simActive ? 'Exit simulation mode' : 'Enter simulation mode — drive the robot with physics'}
          className={`w-full flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-lg transition-all duration-150 ${
            simActive
              ? 'bg-yellow-500 ring-1 ring-yellow-300 animate-pulse'
              : 'hover:bg-yellow-500/15 border border-yellow-700/40'
          }`}
        >
          <span className="text-base leading-none">{simActive ? '⏹' : '▶'}</span>
          <span className="text-[10px] font-semibold leading-tight" style={{ color: simActive ? '#1a1a1a' : '#D97706' }}>
            {simActive ? 'Stop' : 'Simulate'}
          </span>
        </button>
      </div>

      {divider}

      {/* View toggles */}
      <div className="w-full">
        <SectionLabel>View</SectionLabel>
        <div className="flex flex-col gap-0.5">
          <button
            onClick={toggleGrid}
            title="Toggle Grid [G]"
            className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-all duration-150 ${
              gridVisible ? 'bg-indigo-500/15' : 'hover:bg-gray-700/40'
            }`}
          >
            <span className="text-base leading-none">#</span>
            <span className="text-[10px] font-medium leading-tight" style={{ color: gridVisible ? 'rgb(var(--a-600))' : T_SECONDARY }}>Grid</span>
          </button>
          <button
            onClick={toggleAxes}
            title="Toggle Axes [A]"
            className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-all duration-150 ${
              axesVisible ? 'bg-indigo-500/15' : 'hover:bg-gray-700/40'
            }`}
          >
            <span className="text-base leading-none">⊕</span>
            <span className="text-[10px] font-medium leading-tight" style={{ color: axesVisible ? 'rgb(var(--a-600))' : T_SECONDARY }}>Axes</span>
          </button>
        </div>
      </div>
    </div>
  )
}
