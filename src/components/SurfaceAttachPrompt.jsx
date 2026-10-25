import { useCallback, memo } from 'react'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { useHistory } from '../hooks/useHistory.js'

// One bar, one position, whatever the tool has to say — so the prompt never
// just vanishes.
function Shell({ accent, children }) {
  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 pointer-events-auto select-none">
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl"
        style={{
          background: 'linear-gradient(135deg,#0c1a24 0%,#0f2230 100%)',
          border: `1.5px solid ${accent}`,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          maxWidth: 'min(92vw, 460px)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function SurfaceAttachPrompt() {
  const surfaceToolActive = useUiStore(s => s.surfaceToolActive)
  const patches          = useSurfaceStore(s => s.patches)
  const selectedPatchIds = useSurfaceStore(s => s.selectedIds)
  const removePatch         = useSurfaceStore(s => s.removePatch)
  const clearPatchSelection = useSurfaceStore(s => s.clearPatchSelection)

  const bonds      = useRigidStore(s => s.bonds)
  const addBond    = useRigidStore(s => s.addBond)
  const updateBond = useRigidStore(s => s.updateBond)

  const objects      = useSceneStore(s => s.objects)
  const updateObject = useSceneStore(s => s.updateObject)

  const { snapshot } = useHistory()

  const selectedPatches = selectedPatchIds.map(id => patches[id]).filter(Boolean)
  const canAttach = selectedPatches.length === 2 &&
    selectedPatches[0]?.objectId !== selectedPatches[1]?.objectId

  const cascadeBonds = useCallback((parentId, currentBonds) => {
    Object.values(currentBonds).forEach(bond => {
      if (bond.parentId !== parentId) return
      const r = objectManager.propagateBond(parentId, bond.relativeMatrix, true, bond.childId)
      if (r) { updateObject(bond.childId, r); cascadeBonds(bond.childId, currentBonds) }
    })
  }, [updateObject]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAttach = useCallback(() => {
    let [pA, pB] = selectedPatches
    const pBIsParent = Object.values(bonds).some(b => b.parentId === pB.objectId)
    const pAIsParent = Object.values(bonds).some(b => b.parentId === pA.objectId)
    if (pBIsParent && !pAIsParent) [pA, pB] = [pB, pA]

    const result = objectManager.attachBySurface(pA, pB)
    if (result) {
      updateObject(pB.objectId, { position: result.position, rotation: result.rotation })
      cascadeBonds(pB.objectId, bonds)
      addBond(pA.objectId, pB.objectId, result.relativeMatrix, pA.localNormal, pA.localCenter)
      // Remove the patches entirely so their 3D meshes are destroyed and
      // don't intercept future raycasts / object selection clicks.
      removePatch(pA.id)
      removePatch(pB.id)
      clearPatchSelection()
      snapshot()
    }
  }, [selectedPatches, bonds, updateObject, cascadeBonds, addBond, removePatch, clearPatchSelection, snapshot])

  // The tool is off: nothing to say.
  if (!surfaceToolActive) return null

  // Every state below used to render NOTHING, which is why the prompt looked
  // like it "sometimes doesn't appear": picking two faces on one part, or
  // ending up with one selection, is indistinguishable from the feature being
  // broken unless the UI says so.
  if (!canAttach) {
    const sameObject = selectedPatches.length === 2
    const text = sameObject
      ? 'Both surfaces are on the same part — pick a face on a different part to join them.'
      : selectedPatches.length === 1
        ? 'Now click a face on a different part.'
        : 'Click a face to pick the first surface.'
    return (
      <Shell accent={sameObject ? '#f59e0b' : 'rgba(148,163,184,0.45)'}>
        <div className="text-base shrink-0" style={{ color: sameObject ? '#f59e0b' : '#64748b' }}>
          {sameObject ? '!' : '⬡'}
        </div>
        <div className="text-xs leading-tight text-gray-300">
          {sameObject && <div className="font-semibold text-amber-300 mb-0.5">Can’t connect these</div>}
          {text}
        </div>
        {selectedPatches.length > 0 && (
          <button
            onClick={clearPatchSelection}
            className="text-gray-600 hover:text-gray-300 text-base leading-none transition-colors px-1"
            title="Clear selection"
          >
            ✕
          </button>
        )}
      </Shell>
    )
  }

  const [pA, pB] = selectedPatches
  const objA = objects.find(o => o.id === pA.objectId)
  const objB = objects.find(o => o.id === pB.objectId)

  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 pointer-events-auto select-none">
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl"
        style={{
          background: 'linear-gradient(135deg,#0c1a24 0%,#0f2230 100%)',
          border: '1.5px solid rgba(6,182,212,0.55)',
          boxShadow: '0 0 24px rgba(6,182,212,0.18), 0 4px 24px rgba(0,0,0,0.5)',
        }}
      >
        {/* Icon */}
        <div className="text-cyan-400 text-lg shrink-0">⬡</div>

        {/* Info */}
        <div className="text-xs">
          <div className="text-cyan-300 font-semibold leading-tight mb-0.5">2 surfaces selected</div>
          <div className="text-gray-400 leading-tight">
            <span className="text-white font-medium">{objA?.name ?? '?'}</span>
            <span className="text-cyan-600 mx-1.5">↔</span>
            <span className="text-cyan-200 font-medium">{objB?.name ?? '?'}</span>
          </div>
        </div>

        {/* Connect button */}
        <button
          onClick={handleAttach}
          data-tour="surface-bond"
          className="px-4 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap"
          style={{
            background: 'linear-gradient(90deg,#0e7490,#0891b2)',
            color: 'white',
            boxShadow: '0 0 12px rgba(6,182,212,0.3)',
          }}
          onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.15)'}
          onMouseLeave={e => e.currentTarget.style.filter = ''}
        >
          ⊕ Connect Surfaces
        </button>

        {/* Cancel */}
        <button
          onClick={clearPatchSelection}
          className="text-gray-600 hover:text-gray-300 text-base leading-none transition-colors px-1"
          title="Cancel"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// Memoized: rendered with no props inside Viewport, which re-renders on every
// object change (mesh sync). Without this, each drag frame re-rendered it.
export default memo(SurfaceAttachPrompt)
