import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useHistory } from '../hooks/useHistory.js'

const SHAPES = [
  { type: 'box',      label: 'Cube',     icon: '⬛', key: '1' },
  { type: 'sphere',   label: 'Sphere',   icon: '🔵', key: '2' },
  { type: 'cylinder', label: 'Cylinder', icon: '🔷', key: '3' },
  { type: 'cone',     label: 'Cone',     icon: '🔺', key: '4' },
  { type: 'torus',    label: 'Torus',    icon: '⭕', key: '5' },
  { type: 'plane',    label: 'Plane',    icon: '▬',  key: '6' },
  { type: 'capsule',  label: 'Capsule',  icon: '💊', key: '7' },
  { type: 'pyramid',  label: 'Pyramid',  icon: '△',  key: '8' },
  { type: 'prism',    label: 'Prism',    icon: '▷',  key: '9' },
  { type: 'diamond',  label: 'Diamond',  icon: '◇',  key: '0' },
  { type: 'hexagon',  label: 'Hexagon',  icon: '⬡',  key: '' },
  { type: 'star',     label: 'Star',     icon: '✦',  key: '' },
]

const TRANSFORM_MODES = [
  { mode: 'translate', label: 'Move',   icon: '✛' },
  { mode: 'rotate',    label: 'Rotate', icon: '↻' },
  { mode: 'scale',     label: 'Scale',  icon: '⤡' },
]

export default function Toolbar() {
  const addObject = useSceneStore((s) => s.addObject)
  const gridVisible = useSceneStore((s) => s.gridVisible)
  const axesVisible = useSceneStore((s) => s.axesVisible)
  const toggleGrid = useSceneStore((s) => s.toggleGrid)
  const toggleAxes = useSceneStore((s) => s.toggleAxes)
  const transformMode = useUiStore((s) => s.transformMode)
  const setTransformMode = useUiStore((s) => s.setTransformMode)
  const { snapshot } = useHistory()

  const handleAddShape = (type) => {
    addObject(type)
    snapshot()
  }

  return (
    <div className="flex flex-col items-center gap-1 w-14 bg-gray-900 border-r border-gray-700/50 py-3 overflow-y-auto shrink-0">
      {/* Shapes */}
      <div className="w-full px-1 mb-1">
        <div className="text-[9px] text-gray-500 text-center uppercase tracking-wider mb-1">Add</div>
        {SHAPES.map(({ type, label, icon, key }) => (
          <button
            key={type}
            onClick={() => handleAddShape(type)}
            title={`${label} [${key}]`}
            className="w-full flex flex-col items-center justify-center py-1.5 rounded text-lg text-gray-300 hover:bg-blue-600/30 hover:text-white transition-colors"
          >
            <span>{icon}</span>
            <span className="text-[8px] text-gray-500 leading-none mt-0.5">{label}</span>
          </button>
        ))}
      </div>

      <div className="w-8 border-t border-gray-700/50" />

      {/* Transform modes */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-gray-500 text-center uppercase tracking-wider mb-1">Mode</div>
        {TRANSFORM_MODES.map(({ mode, label, icon }) => (
          <button
            key={mode}
            onClick={() => setTransformMode(mode)}
            title={label}
            className={`w-full flex flex-col items-center justify-center py-1.5 rounded text-base transition-colors ${
              transformMode === mode
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <span>{icon}</span>
            <span className="text-[8px] leading-none mt-0.5">{label}</span>
          </button>
        ))}
      </div>

      <div className="w-8 border-t border-gray-700/50 mt-1" />

      {/* Electronics */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-green-600 text-center uppercase tracking-wider mb-1">Elec</div>
        {[
          { type: 'arduino',  label: 'Arduino',  icon: '🟢' },
          { type: 'motor_bo', label: 'Motor BO', icon: '⚙'  },
          { type: 'motor_dc', label: 'Motor DC', icon: '🔧' },
          { type: 'led',      label: 'LED',      icon: '💡' },
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

      {/* View toggles */}
      <div className="w-full px-1 mt-1">
        <div className="text-[9px] text-gray-500 text-center uppercase tracking-wider mb-1">View</div>
        <button
          onClick={toggleGrid}
          title="Toggle Grid [G]"
          className={`w-full flex flex-col items-center justify-center py-1.5 rounded text-sm transition-colors ${
            gridVisible ? 'text-blue-400 bg-blue-900/30' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <span className="text-base">#</span>
          <span className="text-[8px] leading-none mt-0.5">Grid</span>
        </button>
        <button
          onClick={toggleAxes}
          title="Toggle Axes [A]"
          className={`w-full flex flex-col items-center justify-center py-1.5 rounded text-sm transition-colors ${
            axesVisible ? 'text-blue-400 bg-blue-900/30' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <span className="text-base">⊕</span>
          <span className="text-[8px] leading-none mt-0.5">Axes</span>
        </button>
      </div>
    </div>
  )
}
