<<<<<<< HEAD
import { useState } from 'react'
=======
import { useRef } from 'react'
>>>>>>> master
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { patchManager } from '../managers/PatchManager.js'
<<<<<<< HEAD

// ── Readable text system (per design spec) ───────────────────────────────────
const T_PRIMARY   = '#1E293B'   // component names — bright, high contrast
const T_SECONDARY = '#475569'   // headers / labels
const T_MUTED     = '#64748B'   // counts / least important

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
=======
import { svgTextToGeometry } from '../utils/svgImport.js'

const SHAPES = [
  { type: 'cylinder',    label: 'Cylinder',   icon: '⬤', key: '1' },
  { type: 'cone',        label: 'Cone',        icon: '🔺', key: '2' },
  { type: 'box',         label: 'Cube',        icon: '⬛', key: '3' },
  { type: 'sphere',      label: 'Sphere',      icon: '🔵', key: '4' },
  { type: 'tetrahedron', label: 'Tetrahedron', icon: '△',  key: '5' },
  { type: 'pyramid',     label: 'Sq Pyramid',  icon: '▲',  key: '6' },
  { type: 'pentpyramid', label: 'Pent Pyramid',icon: '⛛', key: '7' },
  { type: 'octahedron',  label: 'Octahedron',  icon: '◈',  key: '8' },
  { type: 'dodecahedron',label: 'Dodecahedron',icon: '⬡',  key: '9' },
  { type: 'rectprism',   label: 'Rect Prism',  icon: '▭',  key: '0' },
  { type: 'text',        label: 'Text',        icon: '🅣' },
]

const TRANSFORM_MODES = [
  { mode: 'translate', label: 'Move',   icon: '✛', key: 'W' },
  { mode: 'rotate',    label: 'Rotate', icon: '↻', key: 'E' },
  { mode: 'scale',     label: 'Scale',  icon: '⤡', key: 'R' },
>>>>>>> master
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
          ? 'bg-indigo-600 shadow-[0_0_12px_rgba(79,70,229,0.18)]'
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
<<<<<<< HEAD

  // Electronics categories default expanded so quick-add (and the tutorial
  // anchors) are always available.
  const [openElec, setOpenElec] = useState({ mcu: true, actuators: true })
  const toggleElec = (k) => setOpenElec((o) => ({ ...o, [k]: !o[k] }))
=======
  const snapTranslate     = useUiStore((s) => s.snapTranslate)
  const setSnapTranslate  = useUiStore((s) => s.setSnapTranslate)
  const snapRotateDeg     = useUiStore((s) => s.snapRotateDeg)
  const setSnapRotateDeg  = useUiStore((s) => s.setSnapRotateDeg)

  const TRANSLATE_STEPS = [0, 0.5, 1, 2]
  const ROTATE_STEPS    = [0, 15, 45, 90]
  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length] ?? arr[0]
>>>>>>> master

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

  const addCSGObject = useSceneStore((s) => s.addCSGObject)
  const svgInputRef  = useRef(null)

  const handleAddShape = (type) => {
    addObject(type)
    snapshot()
  }

<<<<<<< HEAD
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
=======
  const handleSvgFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const geo  = svgTextToGeometry(text)
      if (!geo) { window.alert('No filled shapes found in that SVG.'); return }
      const name = file.name.replace(/\.svg$/i, '') || 'SVG'
      addCSGObject(name, geo.toJSON(), '#22c55e', { x: 0, y: 1, z: 0 })
      snapshot()
    } catch (err) {
      console.error('[SVG import] failed:', err)
      window.alert('SVG import failed: ' + (err?.message ?? err))
    }
    e.target.value = ''
  }

  return (
    <div className="flex flex-col items-center gap-1 w-full h-full bg-gray-900 py-3 overflow-y-auto overflow-x-hidden">
      {/* Shapes */}
      <div className="w-full px-1 mb-1">
        <div className="text-[9px] text-gray-500 text-center uppercase tracking-wider mb-1">Add</div>
        {SHAPES.map(({ type, label, icon, key }) => (
          <button
            key={type}
            onClick={() => handleAddShape(type)}
            title={key ? `${label} [${key}]` : label}
            className="w-full flex flex-col items-center justify-center py-1.5 rounded text-lg text-gray-300 hover:bg-amber-600/20 hover:text-amber-100 transition-colors"
          >
            <span>{icon}</span>
            <span className="text-[8px] text-gray-500 leading-none mt-0.5">{label}</span>
          </button>
        ))}
        {/* SVG import */}
        <button
          onClick={() => svgInputRef.current?.click()}
          title="Import an SVG drawing as an extruded 3D solid"
          className="w-full flex flex-col items-center justify-center py-1.5 rounded text-lg text-gray-300 hover:bg-amber-600/20 hover:text-amber-100 transition-colors"
        >
          <span>✎</span>
          <span className="text-[8px] text-gray-500 leading-none mt-0.5">SVG</span>
        </button>
        <input ref={svgInputRef} type="file" accept=".svg,image/svg+xml" onChange={handleSvgFile} className="hidden" />
>>>>>>> master
      </div>

      {divider}

      {/* Transform modes */}
<<<<<<< HEAD
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
=======
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-gray-500 text-center uppercase tracking-wider mb-1">Mode</div>
        {TRANSFORM_MODES.map(({ mode, label, icon, key }) => (
          <button
            key={mode}
            onClick={() => setTransformMode(mode)}
            title={`${label}  (${key})`}
            className={`relative w-full flex flex-col items-center justify-center py-1.5 rounded text-base transition-colors ${
              transformMode === mode
                ? 'bg-amber-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <span>{icon}</span>
            <span className="text-[8px] leading-none mt-0.5">{label}</span>
            <span className="absolute top-0.5 right-0.5 text-[7px] font-mono opacity-50 leading-none">{key}</span>
          </button>
        ))}
>>>>>>> master
      </div>

      {divider}

<<<<<<< HEAD
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
=======
      {/* Electronics */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-green-600 text-center uppercase tracking-wider mb-1">Elec</div>
        {[
          { type: 'arduino',  label: 'Arduino',  icon: '🟢' },
          { type: 'subo',     label: 'SUBO',     icon: '🟣' },
          { type: 'motor_bo', label: 'Motor BO', icon: '⚙'  },
          { type: 'motor_dc', label: 'Motor DC', icon: '🔧' },
          { type: 'led',      label: 'LED',      icon: '💡' },
          { type: 'servo',    label: 'Servo',    icon: '🔩' },
        ].map(({ type, label, icon }) => (
          <button
            key={type}
            onClick={() => handleAddShape(type)}
            title={`Add ${label}`}
            className="w-full flex flex-col items-center justify-center py-1.5 rounded text-lg text-gray-300 hover:bg-green-700/30 hover:text-white transition-colors"
          >
            <span>{icon}</span>
            <span className="text-[8px] text-gray-500 leading-none mt-0.5">{label}</span>
          </button>
        ))}
>>>>>>> master
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

<<<<<<< HEAD
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
=======
      {/* Surface patch tool + Extrude */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-cyan-600 text-center uppercase tracking-wider mb-1">Join</div>
        <button
          onClick={handleSurfaceTool}
          title={surfaceToolActive ? 'Exit surface attach mode' : 'Surface Attach — click faces to snap objects together, or drag to draw a custom patch'}
          className={`w-full flex flex-col items-center justify-center py-2 rounded text-base transition-colors ${
            surfaceToolActive
              ? 'bg-cyan-500 text-white ring-2 ring-cyan-300 shadow-lg shadow-cyan-500/30'
              : 'text-cyan-500 hover:bg-cyan-800/40 hover:text-cyan-300 border border-cyan-800/40'
          }`}
        >
          <span>⊞</span>
          <span className="text-[8px] leading-none mt-0.5 font-medium">
            {surfaceToolActive ? 'Attaching' : 'Surface'}
          </span>
          {patchCount > 0 && (
            <span className="text-[8px] text-cyan-400 leading-none">{patchCount}pts</span>
>>>>>>> master
          )}
        </button>
      </div>

      {divider}

<<<<<<< HEAD
      {/* Edit / Extrude */}
      <div className="w-full">
        <SectionLabel>Edit</SectionLabel>
=======
      {/* Extrude tool */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-purple-600 text-center uppercase tracking-wider mb-1">Edit</div>
        <button
          onClick={handleExtrudeTool}
          title={extrudeToolActive ? 'Exit extrude mode' : 'Extrude — click a face to pull it outward into a new solid'}
          className={`w-full flex flex-col items-center justify-center py-2 rounded text-base transition-colors ${
            extrudeToolActive
              ? 'bg-purple-500 text-white ring-2 ring-purple-300 shadow-lg shadow-purple-500/30'
              : 'text-purple-400 hover:bg-purple-800/40 hover:text-purple-300 border border-purple-800/40'
          }`}
        >
          <span>⬆</span>
          <span className="text-[8px] leading-none mt-0.5 font-medium">
            {extrudeToolActive ? 'Extruding' : 'Extrude'}
          </span>
        </button>
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

      {/* Simulate */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-yellow-600 text-center uppercase tracking-wider mb-1">Run</div>
>>>>>>> master
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
          <span className="text-[10px] font-semibold leading-tight" style={{ color: simActive ? '#1a1a1a' : '#92400E' }}>
            {simActive ? 'Stop' : 'Simulate'}
          </span>
        </button>
      </div>

      {divider}

      {/* Snap-to-grid */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-blue-500 text-center uppercase tracking-wider mb-1">Snap</div>
        <button
          onClick={() => setSnapTranslate(cycle(TRANSLATE_STEPS, snapTranslate))}
          title="Move snap step (click to cycle: Off / 0.5 / 1 / 2 units)"
          className={`w-full flex flex-col items-center justify-center py-1.5 rounded text-sm transition-colors ${
            snapTranslate > 0 ? 'text-blue-300 bg-blue-900/30' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <span className="text-base">⊹</span>
          <span className="text-[8px] leading-none mt-0.5">{snapTranslate > 0 ? `${snapTranslate}u` : 'Move'}</span>
        </button>
        <button
          onClick={() => setSnapRotateDeg(cycle(ROTATE_STEPS, snapRotateDeg))}
          title="Rotation snap (click to cycle: Off / 15° / 45° / 90°)"
          className={`w-full flex flex-col items-center justify-center py-1.5 rounded text-sm transition-colors ${
            snapRotateDeg > 0 ? 'text-blue-300 bg-blue-900/30' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <span className="text-base">↻</span>
          <span className="text-[8px] leading-none mt-0.5">{snapRotateDeg > 0 ? `${snapRotateDeg}°` : 'Rot'}</span>
        </button>
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

      {/* View toggles */}
<<<<<<< HEAD
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
            <span className="text-[10px] font-medium leading-tight" style={{ color: gridVisible ? '#4F46E5' : T_SECONDARY }}>Grid</span>
          </button>
          <button
            onClick={toggleAxes}
            title="Toggle Axes [A]"
            className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg transition-all duration-150 ${
              axesVisible ? 'bg-indigo-500/15' : 'hover:bg-gray-700/40'
            }`}
          >
            <span className="text-base leading-none">⊕</span>
            <span className="text-[10px] font-medium leading-tight" style={{ color: axesVisible ? '#4F46E5' : T_SECONDARY }}>Axes</span>
          </button>
        </div>
=======
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-gray-500 text-center uppercase tracking-wider mb-1">View</div>
        <button
          onClick={toggleGrid}
          title="Toggle Grid [G]"
          className={`w-full flex flex-col items-center justify-center py-1.5 rounded text-sm transition-colors ${
            gridVisible ? 'text-amber-400 bg-amber-900/20' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <span className="text-base">#</span>
          <span className="text-[8px] leading-none mt-0.5">Grid</span>
        </button>
        <button
          onClick={toggleAxes}
          title="Toggle Axes [A]"
          className={`w-full flex flex-col items-center justify-center py-1.5 rounded text-sm transition-colors ${
            axesVisible ? 'text-amber-400 bg-amber-900/20' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <span className="text-base">⊕</span>
          <span className="text-[8px] leading-none mt-0.5">Axes</span>
        </button>
>>>>>>> master
      </div>
    </div>
  )
}
