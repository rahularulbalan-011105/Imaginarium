import { useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { runBoolean } from '../utils/csg.js'

const OPERATIONS = [
  {
    id: 'union',
    label: 'Union',
    icon: '⊕',
    description: 'Merge A and B into one combined shape',
    color: 'blue',
  },
  {
    id: 'subtract',
    label: 'A − B',
    icon: '⊖',
    description: 'Cut the B shape out of A (creates a hole)',
    color: 'orange',
  },
  {
    id: 'subtractB',
    label: 'B − A',
    icon: '⊖',
    description: 'Cut the A shape out of B (creates a hole)',
    color: 'orange',
  },
  {
    id: 'intersect',
    label: 'Intersect',
    icon: '⊗',
    description: 'Keep only the overlapping region',
    color: 'purple',
  },
]

const COLOR_CLASSES = {
  blue:   'bg-indigo-800/30 hover:bg-indigo-700/40 border-indigo-600/50 text-indigo-200',
  orange: 'bg-orange-800/40 hover:bg-orange-700/60 border-orange-600/50 text-orange-200',
  purple: 'bg-purple-800/40 hover:bg-purple-700/60 border-purple-600/50 text-purple-200',
}

const OP_NAMES = { union: 'Union', subtract: 'Subtract', subtractB: 'Subtract', intersect: 'Intersect' }

const ELEC_TYPES = new Set(['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo'])
const GEOMETRY_TYPES = new Set(['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
  'tetrahedron', 'pyramid', 'pentpyramid', 'octahedron', 'dodecahedron', 'rectprism',
  'csg', 'model', 'gear', 'bolt', 'screw'])

export function isBooleanCandidate(obj) {
  if (!obj) return false
  return GEOMETRY_TYPES.has(obj.type) || ELEC_TYPES.has(obj.type)
}

export default function BooleanPanel({ selectedId, secondaryId }) {
  const objects = useSceneStore((s) => s.objects)
  const addCSGObject = useSceneStore((s) => s.addCSGObject)
  const removeObject = useSceneStore((s) => s.removeObject)
  const clearSelection = useSceneStore((s) => s.clearSelection)
  const clearSecondaryId = useSceneStore((s) => s.clearSecondaryId)
  const { snapshot } = useHistory()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const objA = objects.find((o) => o.id === selectedId)
  const objB = objects.find((o) => o.id === secondaryId)

  if (!objA || !objB) return null

  const aIsElec = ELEC_TYPES.has(objA.type)
  const bIsElec = ELEC_TYPES.has(objB.type)

  const handleOp = async (opId) => {
    setBusy(true)
    setError(null)

    // Small delay so UI updates before heavy computation
    await new Promise((r) => setTimeout(r, 20))

    try {
      const result = runBoolean(selectedId, secondaryId, opId)
      if (!result) {
        setError('Operation failed — make sure the shapes overlap.')
        setBusy(false)
        return
      }

      const name = `${OP_NAMES[opId]}_${objA.name}_${objB.name}`
      addCSGObject(name, result.geometryJSON, result.color, result.position)

      // Remove the two source objects then snapshot the post-operation state
      removeObject(selectedId)
      removeObject(secondaryId)
      snapshot()
    } catch (e) {
      setError('Operation failed: ' + e.message)
    }

    setBusy(false)
  }

  const handleCancel = () => {
    clearSecondaryId()
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] text-purple-400 uppercase tracking-wider font-semibold">
        Boolean Operations
      </div>
      {(aIsElec || bIsElec) && (
        <div className="text-[10px] text-indigo-400 bg-indigo-900/20 border border-indigo-700/30 rounded p-2">
          ⚡ Electronics geometry mode — the physical shapes of the components will be used for the boolean operation.
        </div>
      )}

      {/* Object pair summary */}
      <div className="flex items-center gap-2 bg-gray-800/60 rounded p-2 text-xs">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: objA.color }} />
        <span className="text-gray-100 truncate flex-1">{objA.name}</span>
        <span className="text-gray-500 shrink-0">+</span>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: objB.color }} />
        <span className="text-orange-300 truncate flex-1">{objB.name}</span>
      </div>

      <div className="text-[10px] text-gray-500 leading-relaxed">
        Choose an operation. The two source shapes will be replaced by the result.
      </div>

      {/* Operation buttons */}
      <div className="flex flex-col gap-2">
        {OPERATIONS.map(({ id, label, icon, description, color }) => (
          <button
            key={id}
            disabled={busy}
            onClick={() => handleOp(id)}
            className={`flex items-start gap-3 p-2.5 rounded border text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${COLOR_CLASSES[color]}`}
          >
            <span className="text-xl leading-none mt-0.5">{icon}</span>
            <div>
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[10px] opacity-70 leading-snug mt-0.5">{description}</div>
            </div>
          </button>
        ))}
      </div>

      {busy && (
        <div className="text-xs text-center text-gray-400 animate-pulse">Computing…</div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded p-2">
          {error}
        </div>
      )}

      <button
        onClick={handleCancel}
        className="text-xs text-gray-500 hover:text-gray-300 text-center py-1 transition-colors"
      >
        Cancel (deselect second object)
      </button>
    </div>
  )
}
