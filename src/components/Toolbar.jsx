import { useRef } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { patchManager } from '../managers/PatchManager.js'
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
]

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
  const snapTranslate     = useUiStore((s) => s.snapTranslate)
  const setSnapTranslate  = useUiStore((s) => s.setSnapTranslate)
  const snapRotateDeg     = useUiStore((s) => s.snapRotateDeg)
  const setSnapRotateDeg  = useUiStore((s) => s.setSnapRotateDeg)

  const TRANSLATE_STEPS = [0, 0.5, 1, 2]
  const ROTATE_STEPS    = [0, 15, 45, 90]
  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length] ?? arr[0]

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
      </div>

      <div className="w-8 border-t border-gray-700/50" />

      {/* Transform modes */}
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
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

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
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

      {/* Mechanical parts */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-orange-600 text-center uppercase tracking-wider mb-1">Mech</div>
        {[
          { type: 'gear',  label: 'Gear',  icon: '⚙' },
          { type: 'bolt',  label: 'Bolt',  icon: '⬡' },
          { type: 'screw', label: 'Screw', icon: '⊛' },
        ].map(({ type, label, icon }) => (
          <button
            key={type}
            onClick={() => handleAddShape(type)}
            title={`Add ${label}`}
            className="w-full flex flex-col items-center justify-center py-1.5 rounded text-lg text-gray-300 hover:bg-orange-700/30 hover:text-white transition-colors"
          >
            <span>{icon}</span>
            <span className="text-[8px] text-gray-500 leading-none mt-0.5">{label}</span>
          </button>
        ))}
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

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
          )}
        </button>
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

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
        <button
          onClick={() => setSimActive(!simActive)}
          title={simActive ? 'Exit simulation mode' : 'Enter simulation mode — drive the robot'}
          className={`w-full flex flex-col items-center justify-center py-2 rounded text-base transition-colors ${
            simActive
              ? 'bg-yellow-500 text-gray-900 ring-1 ring-yellow-300 animate-pulse'
              : 'text-yellow-400 hover:bg-yellow-900/30 hover:text-yellow-300'
          }`}
        >
          <span>{simActive ? '⏹' : '▶'}</span>
          <span className="text-[8px] leading-none mt-0.5 font-medium">
            {simActive ? 'Stop' : 'Simulate'}
          </span>
        </button>
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

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
      </div>
    </div>
  )
}
