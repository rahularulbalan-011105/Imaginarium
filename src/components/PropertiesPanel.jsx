import { useCallback, useEffect, useState } from 'react'
import * as THREE from 'three'
import { useSceneStore } from '../stores/sceneStore.js'
import { getMass } from '../managers/physics/MassCalculator.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useGearStore } from '../stores/gearStore.js'
import { useAssetStore } from '../stores/assetStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { objectManager } from '../managers/ObjectManager.js'
import { r3, radToDeg, degToRad, snapRotationToAxes } from '../utils/helpers.js'
import DimensionEditorPanel from './DimensionEditorPanel.jsx'
import ExtrudePanel from './ExtrudePanel.jsx'
import FilletPanel from './FilletPanel.jsx'

function Vec3Input({ label, value, onChange, onBlurSnapshot, step = 0.1 }) {
  const handleChange = (axis) => (e) => {
    const v = parseFloat(e.target.value)
    if (!isNaN(v)) onChange({ ...value, [axis]: v })
  }
  return (
    <div className="mb-3">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        {['x', 'y', 'z'].map((axis) => (
          <div key={axis} className="relative">
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-500 uppercase">
              {axis}
            </span>
            <input
              type="number"
              value={r3(value[axis])}
              step={step}
              onBlur={onBlurSnapshot}
              onChange={handleChange(axis)}
              className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white pl-4 pr-1 py-1.5 focus:outline-none focus:border-indigo-500"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const MATERIAL_TYPES = ['standard', 'metallic', 'transparent']

// Emits an event the Viewport listens to for entering pick mode
export const attachPointEvents = new EventTarget()

function PatchDimInput({ label, value, onChange }) {
  const [local, setLocal] = useState(String(value.toFixed(3)))

  // Keep local in sync when store value changes externally (e.g. drag resize)
  useEffect(() => { setLocal(String(value.toFixed(3))) }, [value])

  const commit = () => {
    const v = parseFloat(local)
    if (!isNaN(v) && v > 0.01) onChange(v)
    else setLocal(String(value.toFixed(3)))
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] font-bold text-cyan-500 uppercase w-3 shrink-0">{label}</span>
      <input
        type="number"
        value={local}
        min="0.01"
        step="0.1"
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        className="flex-1 bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1 focus:outline-none focus:border-cyan-500"
      />
    </div>
  )
}

function SurfacePatchPanel({ patches, canAttach, onAttach, onRemove, onUpdatePatch, objects }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-semibold mb-1">
        ⬡ Surface Patches
      </div>
      {patches.map((p, i) => {
        const obj = objects.find(o => o.id === p.objectId)
        return (
          <div key={p.id} className="bg-gray-800/60 border border-cyan-700/40 rounded p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-cyan-300 font-medium">
                Patch {i + 1} — <span className="text-white">{obj?.name ?? '?'}</span>
              </span>
              <button
                onClick={() => onRemove(p.id)}
                className="text-[9px] text-red-400 hover:text-red-300 px-1"
              >
                ✕
              </button>
            </div>

            {/* Editable W / H */}
            <div className="grid grid-cols-2 gap-1.5 mb-1.5">
              <PatchDimInput
                label="W"
                value={p.width}
                onChange={w => onUpdatePatch(p.id, { width: w })}
              />
              <PatchDimInput
                label="H"
                value={p.height}
                onChange={h => onUpdatePatch(p.id, { height: h })}
              />
            </div>

            <div className="text-[9px] text-gray-500">
              Normal ({p.localNormal.x.toFixed(2)}, {p.localNormal.y.toFixed(2)}, {p.localNormal.z.toFixed(2)})
            </div>
          </div>
        )
      })}

      {canAttach && (
        <button
          onClick={onAttach}
          className="w-full py-2.5 mt-1 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold rounded transition-colors"
        >
          ⊕ Surface Attach — Align &amp; Bond
        </button>
      )}
      {patches.length === 1 && (
        <div className="text-[9px] text-gray-500 text-center mt-1">
          Select a patch on a second object to enable Surface Attach
        </div>
      )}
      {patches.length === 2 && !canAttach && (
        <div className="text-[9px] text-yellow-600 text-center mt-1">
          Both patches are on the same object
        </div>
      )}
    </div>
  )
}

export default function PropertiesPanel() {
  const selectedId      = useSceneStore((s) => s.selectedId)
  const secondaryId     = useSceneStore((s) => s.secondaryId)
  const objects         = useSceneStore((s) => s.objects)
  const updateObject    = useSceneStore((s) => s.updateObject)
  const removeObject    = useSceneStore((s) => s.removeObject)
  const duplicateObject = useSceneStore((s) => s.duplicateObject)
  const insertObject    = useSceneStore((s) => s.insertObject)
  const markStandalone  = useSceneStore((s) => s.markStandalone)
  const toggleHole      = useSceneStore((s) => s.toggleHole)
  const groupSelected   = useSceneStore((s) => s.groupSelected)
  const ungroupSelected = useSceneStore((s) => s.ungroupSelected)
  const { snapshot } = useHistory()

  const attachments     = useElectronicsStore((s) => s.attachments)
  const detachFromMotor = useElectronicsStore((s) => s.detachFromMotor)
  const attachToMotor   = useElectronicsStore((s) => s.attachToMotor)

  // Surface patch state
  const patches             = useSurfaceStore((s) => s.patches)
  const selectedPatchIds    = useSurfaceStore((s) => s.selectedIds)
  const removePatch         = useSurfaceStore((s) => s.removePatch)
  const updatePatch         = useSurfaceStore((s) => s.updatePatch)
  const clearPatchSelection = useSurfaceStore((s) => s.clearPatchSelection)

  // Rigid bond state
  const bonds      = useRigidStore((s) => s.bonds)
  const addBond    = useRigidStore((s) => s.addBond)
  const removeBond = useRigidStore((s) => s.removeBond)
  const updateBond = useRigidStore((s) => s.updateBond)

  // Gear mesh pair state
  const meshPairs    = useGearStore(s => s.meshPairs)
  const addMeshPair  = useGearStore(s => s.addMeshPair)
  const removeMeshPair = useGearStore(s => s.removeMeshPair)

  const selectedPatches = selectedPatchIds.map(id => patches[id]).filter(Boolean)
  const canRigidAttach  = selectedPatches.length === 2 &&
    selectedPatches[0].objectId !== selectedPatches[1].objectId

  // Recursively propagate a parent-move to all bonded children (and their children).
  const cascadeBonds = (parentId, currentBonds) => {
    Object.values(currentBonds).forEach(bond => {
      if (bond.parentId !== parentId) return
      const r = objectManager.propagateBond(parentId, bond.relativeMatrix, true, bond.childId)
      if (r) { updateObject(bond.childId, r); cascadeBonds(bond.childId, currentBonds) }
    })
  }

  const handleRigidAttach = () => {
    let [pA, pB] = selectedPatches

    // Auto-swap: the object that is already a parent (has bonded children) should
    // stay fixed as pA. If pB is the host and pA is the new piece being placed,
    // moving pB would drag all its existing children along with it — making them
    // appear to detach. Swap so the host is always pA (fixed) and the new piece pB.
    const pBIsParent = Object.values(bonds).some(b => b.parentId === pB.objectId)
    const pAIsParent = Object.values(bonds).some(b => b.parentId === pA.objectId)
    if (pBIsParent && !pAIsParent) [pA, pB] = [pB, pA]

    const result = objectManager.attachBySurface(pA, pB)
    if (result) {
      updateObject(pB.objectId, { position: result.position, rotation: result.rotation })
      cascadeBonds(pB.objectId, bonds)
      addBond(pA.objectId, pB.objectId, result.relativeMatrix, pA.localNormal, pA.localCenter)
      // Remove both patches so their 3D meshes are destroyed and don't block future selection.
      removePatch(pA.id)
      removePatch(pB.id)
      clearPatchSelection()
      snapshot()
    }
  }

  const obj = objects.find((o) => o.id === selectedId) ?? null

  // Attachment info for the selected object
  const attachedMotorId = obj ? (attachments[obj.id] ?? null) : null
  const attachedMotor   = attachedMotorId ? objects.find(o => o.id === attachedMotorId) : null

  const MOTOR_TYPES  = ['motor', 'motor_bo', 'motor_dc']
  const SHAFT_TYPES  = ['motor', 'motor_bo', 'motor_dc', 'servo']
  const isMotor      = obj && MOTOR_TYPES.includes(obj.type)
  const isElectronics = obj && (SHAFT_TYPES.includes(obj.type) || obj.type === 'arduino' || obj.type === 'subo' || obj.type === 'led')

  // Secondary selection: shift-click on a motor or servo → direct Attach button
  const secondaryObj    = objects.find(o => o.id === secondaryId) ?? null
  const secondaryShaft  = secondaryObj && SHAFT_TYPES.includes(secondaryObj.type) ? secondaryObj : null

  // Whether this object can be attached to a motor/servo shaft
  const isAttachable = obj && !attachedMotor && !isElectronics

  // Scene-wide shaft targets (motors + servos that have a valid rotorGroup)
  const shaftTargets = objects.filter(o =>
    SHAFT_TYPES.includes(o.type) && objectManager.getMesh(o.id)?.userData.rotorGroup
  )
  const canAttach = isAttachable && !secondaryShaft && shaftTargets.length > 0

  // Helper: human-readable label for a shaft target
  const shaftLabel = (target) => target?.type === 'servo' ? 'Servo Horn' : 'Motor Shaft'

  // Rigid bonds involving the currently selected object
  const myBonds = obj
    ? Object.values(bonds).filter(b => b.parentId === obj.id || b.childId === obj.id)
    : []

  // Shaft picker state
  const [currentShaftName, setCurrentShaftName] = useState(null)
  useEffect(() => {
    if (!isMotor || !selectedId) { setCurrentShaftName(null); return }
    setCurrentShaftName(objectManager.getMesh(selectedId)?.userData.currentRotorName ?? null)
  }, [selectedId, isMotor])

  const handleSetShaft = (meshName) => {
    if (!selectedId) return
    objectManager.setMotorShaft(selectedId, meshName)
    setCurrentShaftName(meshName)
  }

  // Pre-attach: which shaft preset to snap to
  const [attachPreset, setAttachPreset] = useState('tip')
  const SHAFT_PRESETS = { tip: 3.0, mid: 2.2, base: 1.5 }

  // Pre-attach: which part of the object lands at the snap point
  // 'center' = object origin · 'front' = +X extremity · 'back' = -X extremity
  const [alignX, setAlignX] = useState('center')

  // Post-attach: local position within rotorGroup (X = along shaft, Y/Z = radial)
  const [shaftPos, setShaftPos] = useState({ x: 2.95, y: 0, z: 0 })

  // Sync shaftPos from Three.js whenever the selected attached object changes
  useEffect(() => {
    if (attachedMotor && selectedId) {
      const pos = objectManager.getAttachedLocalPosition(selectedId)
      if (pos) setShaftPos({ x: r3(pos.x), y: r3(pos.y), z: r3(pos.z) })
    }
  }, [selectedId, attachedMotor])

  const handleShaftPosChange = (axis, val) => {
    if (isNaN(val)) return
    const next = { ...shaftPos, [axis]: val }
    setShaftPos(next)
    objectManager.updateAttachedLocalPosition(selectedId, next.x, next.y, next.z)
  }

  const handleShaftSnap = (x) => {
    const next = { x, y: 0, z: 0 }
    setShaftPos(next)
    objectManager.updateAttachedLocalPosition(selectedId, x, 0, 0)
  }

  const update = useCallback(
    (updates) => {
      if (!selectedId) return
      updateObject(selectedId, updates)
      // Keep bond relativeMatrix in sync when the bonded child is repositioned
      if (updates.position || updates.rotation) {
        const childBond = Object.values(bonds).find(b => b.childId === selectedId)
        if (childBond) {
          const cur  = objects.find(o => o.id === selectedId)
          const pos  = updates.position ?? cur?.position
          const rot  = updates.rotation ?? cur?.rotation
          if (pos && rot) {
            const relMat = objectManager.computeChildRelativeMatrix(childBond.parentId, pos, rot)
            if (relMat) updateBond(childBond.id, { relativeMatrix: relMat })
          }
        }
      }
    },
    [selectedId, updateObject, bonds, objects, updateBond]
  )

  const handleRotate90OnSurface = (bond, deg = 90) => {
    if (!obj) return
    const result = objectManager.rotateBondedObjectOnSurface(obj.id, bond, deg)
    if (!result) return
    updateObject(obj.id, { position: result.position, rotation: result.rotation })
    updateBond(bond.id, { relativeMatrix: result.relativeMatrix })
    // Move any children bonded to obj so they follow it after rotation
    cascadeBonds(obj.id, bonds)
    snapshot()
  }

  const handleDelete = () => {
    removeObject(selectedId)
    snapshot()
  }

  const handleDuplicate = () => {
    duplicateObject(selectedId)
    snapshot()
  }

  const handleDetach = () => {
    if (!selectedId) return
    const worldPos = objectManager.detachMeshFromRotor(selectedId)
    detachFromMotor(selectedId)
    markStandalone(selectedId)   // prevent this object from re-joining the drive group
    if (worldPos) {
      updateObject(selectedId, {
        position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        rotation: { x: 0, y: 0, z: 0 },
      })
    }
  }

  const handleAttachToMotor = (motorId) => {
    if (!selectedId || !motorId) return
    const snapX = SHAFT_PRESETS[attachPreset]
    const success = objectManager.attachMeshToRotor(selectedId, motorId, snapX, alignX)
    if (success) {
      attachToMotor(selectedId, motorId)
      // Read back actual position (bbox alignment may have shifted it)
      const pos = objectManager.getAttachedLocalPosition(selectedId)
      setShaftPos(pos ? { x: r3(pos.x), y: r3(pos.y), z: r3(pos.z) } : { x: snapX, y: 0, z: 0 })
      snapshot()
    }
  }

  // ── Surface patch panel (shown whenever patches are selected, regardless of object) ──
  if (!obj && selectedPatches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="text-4xl mb-3 opacity-30">⚙</div>
        <div className="text-sm text-gray-500">Select an object to edit its properties</div>
      </div>
    )
  }

  const handleRemovePatch = (id) => { removePatch(id); snapshot() }

  if (!obj && selectedPatches.length > 0) {
    return <SurfacePatchPanel patches={selectedPatches} canAttach={canRigidAttach} onAttach={handleRigidAttach} onRemove={handleRemovePatch} onUpdatePatch={updatePatch} objects={objects} />
  }

  const rotDeg = {
    x: radToDeg(obj.rotation.x),
    y: radToDeg(obj.rotation.y),
    z: radToDeg(obj.rotation.z),
  }

  return (
    <div className="flex flex-col gap-1 p-3 overflow-y-auto">
      {/* Surface patch panel — shown when patches are selected */}
      {selectedPatches.length > 0 && (
        <div className="mb-2 border border-cyan-700/40 rounded overflow-hidden">
          <SurfacePatchPanel
            patches={selectedPatches}
            canAttach={canRigidAttach}
            onAttach={handleRigidAttach}
            onRemove={handleRemovePatch}
            onUpdatePatch={updatePatch}
            objects={objects}
          />
        </div>
      )}

      {/* Name */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Name</div>
        <input
          type="text"
          value={obj.name}
          onChange={(e) => update({ name: e.target.value })}
          className="w-full bg-gray-800 border border-gray-600/50 rounded text-sm text-white px-2 py-1.5 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Attachment badge — shown when this object is riding a motor's rotor */}
      {attachedMotor && (
        <div className="mb-3 p-2.5 rounded bg-green-900/30 border border-green-700/40">
          <div className="text-[10px] text-green-400 uppercase tracking-wider font-semibold mb-1">
            Attached to {shaftLabel(attachedMotor)}
          </div>
          <div className="text-xs text-green-300 truncate mb-2">{attachedMotor.name}</div>

          {/* Shaft position — quick snap presets */}
          <div className="mb-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Snap to shaft</div>
            <div className="flex gap-1">
              {[['Tip', 3.0], ['Mid', 2.2], ['Base', 1.5]].map(([label, x]) => (
                <button
                  key={label}
                  onClick={() => handleShaftSnap(x)}
                  className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                    Math.abs(shaftPos.x - x) < 0.01 && shaftPos.y === 0 && shaftPos.z === 0
                      ? 'bg-green-700/50 border-green-500/60 text-green-200'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Fine-tune position along shaft and radial axes */}
          <div className="mb-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Fine position</div>
            <div className="grid grid-cols-3 gap-1">
              {[['X', 'x'], ['Y', 'y'], ['Z', 'z']].map(([label, axis]) => (
                <div key={axis} className="relative">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-500 uppercase">
                    {label}
                  </span>
                  <input
                    type="number"
                    value={shaftPos[axis]}
                    step={0.1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v)) handleShaftPosChange(axis, v)
                    }}
                    className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white pl-4 pr-1 py-1.5 focus:outline-none focus:border-green-500"
                  />
                </div>
              ))}
            </div>
            <div className="text-[9px] text-gray-600 mt-1">X = along shaft · Y/Z = radial</div>
          </div>

          <button
            onClick={handleDetach}
            className="w-full py-1.5 bg-red-900/40 hover:bg-red-700/60 border border-red-700/50 text-red-300 hover:text-slate-900 text-xs rounded transition-colors"
          >
            Detach from {shaftLabel(attachedMotor)}
          </button>
        </div>
      )}

      {/* Rigid bond badges */}
      {myBonds.map(bond => {
        const otherId  = bond.parentId === obj.id ? bond.childId : bond.parentId
        const otherObj = objects.find(o => o.id === otherId)
        const role     = bond.parentId === obj.id ? 'parent' : 'child'
        const canRotate = !!(bond.contactLocalNormal && bond.contactLocalCenter)
        return (
          <div key={bond.id} className="mb-3 p-2.5 rounded bg-cyan-900/30 border border-cyan-700/40">
            <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
              <span>🔗</span> Surface Bond
              <span className="text-[8px] text-gray-500 normal-case ml-auto">{role}</span>
            </div>
            <div className="text-xs text-cyan-200 truncate mb-2">
              {otherObj?.name ?? '(deleted)'}
            </div>

            {/* Fine position — X/Y/Z world-space inputs for the bond child */}
            {role === 'child' && (
              <div className="mb-2">
                <div className="text-[9px] text-gray-400 mb-1">Position (world)</div>
                <div className="grid grid-cols-3 gap-1">
                  {['x','y','z'].map(axis => {
                    const childObj = objects.find(o => o.id === bond.childId)
                    return (
                      <div key={axis} className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-500 uppercase">{axis}</span>
                        <input
                          type="number"
                          step={0.1}
                          value={r3(childObj?.position?.[axis] ?? 0)}
                          onBlur={snapshot}
                          onChange={e => {
                            const v = parseFloat(e.target.value)
                            if (!isNaN(v)) update({ position: { ...childObj?.position, [axis]: v } })
                          }}
                          className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white pl-4 pr-1 py-1.5 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Rotate on surface */}
            {canRotate && (
              <div className="mb-2">
                <div className="text-[9px] text-gray-400 mb-1">Rotate on attached surface</div>
                <div className="flex gap-1">
                  {[
                    { label: '↻ +90°', deg:  90 },
                    { label: '↺ −90°', deg: -90 },
                    { label: '180°',   deg: 180 },
                  ].map(({ label, deg }) => (
                    <button
                      key={deg}
                      onClick={() => handleRotate90OnSurface(bond, deg)}
                      className="flex-1 py-1.5 bg-indigo-900/50 hover:bg-indigo-700/60 border border-indigo-700/50 text-indigo-200 hover:text-slate-900 text-[10px] font-medium rounded transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => { removeBond(bond.id); snapshot() }}
              className="w-full py-1.5 bg-red-900/40 hover:bg-red-700/60 border border-red-700/50 text-red-300 hover:text-slate-900 text-xs rounded transition-colors"
            >
              Detach Bond
            </button>
          </div>
        )
      })}

      {/* Transform — hidden while attached (position is managed by Three.js parenting) */}
      {!attachedMotor && (
        <>
          <Vec3Input
            label="Position"
            value={obj.position}
            onBlurSnapshot={snapshot}
            onChange={(v) => update({ position: v })}
          />
          <Vec3Input
            label="Rotation (°)"
            value={rotDeg}
            step={1}
            onBlurSnapshot={snapshot}
            onChange={(v) =>
              update({
                rotation: { x: degToRad(v.x), y: degToRad(v.y), z: degToRad(v.z) },
              })
            }
          />
          <div className="-mt-1 mb-3">
            <button
              onClick={() => {
                const snapped = snapRotationToAxes(obj.rotation)
                update({ rotation: snapped })
                const mesh = objectManager.getMesh(obj.id)
                if (mesh) mesh.rotation.set(snapped.x, snapped.y, snapped.z)
                snapshot()
              }}
              title="Round each rotation axis to the nearest 0°/90°/180°/270° so the shape is perfectly grid-aligned"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs bg-indigo-900/40 hover:bg-indigo-700/50 border border-indigo-700/40 text-indigo-300 hover:text-slate-900 transition-colors"
            >
              <span>⊹</span>
              <span>Snap to Axes</span>
            </button>
          </div>
          {!isElectronics && (
            <Vec3Input
              label="Scale"
              value={obj.scale}
              onBlurSnapshot={snapshot}
              onChange={(v) => update({ scale: v })}
              step={0.1}
            />
          )}
        </>
      )}

      {/* Attachment Point — pick a specific spot on the prop surface */}
      {isAttachable && !attachedMotor && (
        <div className="mb-3 border border-orange-700/40 rounded p-2">
          <div className="text-[10px] text-orange-400 uppercase tracking-wider font-semibold mb-1">
            ◎ Attachment Point
          </div>
          {obj.attachmentOffset ? (
            <>
              <div className="text-[9px] text-gray-400 mb-1.5">
                Point set — orange dot shows where the shaft connects.
              </div>
              <button
                onClick={() => {
                  updateObject(selectedId, { attachmentOffset: null })
                  objectManager.clearAttachmentMarker(selectedId)
                }}
                className="w-full py-1.5 text-[10px] text-orange-300 bg-orange-900/30 hover:bg-orange-700/40 border border-orange-700/40 rounded transition-colors"
              >
                ✕ Clear Attachment Point
              </button>
            </>
          ) : (
            <>
              <div className="text-[9px] text-gray-500 mb-1.5">
                Click "Pick" then click the exact spot on the prop that should touch the motor shaft.
              </div>
              <button
                onClick={() => attachPointEvents.dispatchEvent(new CustomEvent('startPick', { detail: { id: selectedId } }))}
                className="w-full py-1.5 text-[10px] text-white bg-orange-700 hover:bg-orange-600 rounded font-medium transition-colors"
              >
                ◎ Pick Attachment Point
              </button>
            </>
          )}
        </div>
      )}

      {/* Direct attach: prop selected + shift-click on a motor/servo → one-click attach */}
      {isAttachable && secondaryShaft && (
        <div className="mb-3 p-2.5 rounded bg-indigo-900/20 border border-indigo-700/50">
          <div className="text-[10px] text-indigo-400 uppercase tracking-wider font-semibold mb-1">
            ⚙ Attach to {shaftLabel(secondaryShaft)}
          </div>
          <div className="text-[9px] text-gray-400 mb-2">
            Attach <span className="text-white font-medium">{obj.name}</span> to{' '}
            <span className="text-indigo-300 font-medium">{secondaryShaft.name}</span>'s rotating {secondaryShaft.type === 'servo' ? 'horn' : 'shaft'}.
          </div>
          <button
            onClick={() => handleAttachToMotor(secondaryShaft.id)}
            className="w-full py-2 bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-medium rounded transition-colors"
          >
            ✓ Attach to {secondaryShaft.name}
          </button>
          <div className="text-[9px] text-gray-600 mt-1">Shift-click a different motor or servo to change target</div>
        </div>
      )}

      {/* Attach to Motor/Servo — shown for any non-electronics object that isn't already attached */}
      {canAttach && (
        <div className="mb-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Shaft Attachment</div>
          {/* Snap position picker */}
          <div className="mb-2">
            <div className="text-[9px] text-gray-500 mb-1">Snap to shaft/horn position:</div>
            <div className="flex gap-1">
              {[['Tip', 'tip'], ['Mid', 'mid'], ['Base', 'base']].map(([label, key]) => (
                <button
                  key={key}
                  onClick={() => setAttachPreset(key)}
                  className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                    attachPreset === key
                      ? 'bg-indigo-700/60 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Alignment: which part of the object lands at the snap point */}
          <div className="mb-2">
            <div className="text-[9px] text-gray-500 mb-1">Align at snap point:</div>
            <div className="flex gap-1">
              {[
                { key: 'center', label: 'Center',   hint: 'Object center at snap' },
                { key: 'front',  label: '→ Tip',    hint: 'Pointed/front end at snap (e.g. cone tip)' },
                { key: 'back',   label: 'Base ←',   hint: 'Flat/back end at snap' },
              ].map(({ key, label, hint }) => (
                <button
                  key={key}
                  title={hint}
                  onClick={() => setAlignX(key)}
                  className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                    alignX === key
                      ? 'bg-orange-700/60 border-orange-500 text-white'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-gray-600 mt-0.5">
              {alignX === 'front' ? 'Pointed/+X end at snap · body hangs back'
               : alignX === 'back' ? 'Flat/-X end at snap · body extends forward'
               : 'Object center placed at snap position'}
            </div>
          </div>
          {shaftTargets.length === 1 ? (
            <button
              onClick={() => handleAttachToMotor(shaftTargets[0].id)}
              className="w-full py-1.5 bg-indigo-900/20 hover:bg-indigo-700/40 border border-indigo-700/40 text-indigo-300 hover:text-slate-900 text-xs rounded transition-colors"
            >
              ⚙ Attach to {shaftTargets[0].name} ({shaftLabel(shaftTargets[0])})
            </button>
          ) : (
            <div className="flex flex-col gap-1">
              {shaftTargets.map(m => (
                <button
                  key={m.id}
                  onClick={() => handleAttachToMotor(m.id)}
                  className="w-full py-1.5 bg-indigo-900/20 hover:bg-indigo-700/40 border border-indigo-700/40 text-indigo-300 hover:text-slate-900 text-xs rounded transition-colors"
                >
                  ⚙ Attach to {m.name} ({shaftLabel(m)})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rotating Part picker — only for motor objects */}
      {isMotor && (
        <div className="mb-3 border border-gray-700/40 rounded p-2">
          <div className="text-[10px] text-green-500 uppercase tracking-wider font-semibold mb-1">
            ↻ Rotating Part
          </div>
          <div className="text-[9px] text-gray-500 mb-2">
            Click a part to set it as the spinning shaft when the simulation runs.
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {objectManager.getMotorMeshNames(selectedId).map(name => (
              <button
                key={name}
                onClick={() => handleSetShaft(name)}
                className={`w-full text-left px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                  currentShaftName === name
                    ? 'bg-green-700/60 text-green-200 border border-green-600/50'
                    : 'text-gray-400 hover:bg-gray-700/60 hover:text-slate-900'
                }`}
              >
                {currentShaftName === name ? '▶ ' : '   '}{name}
              </button>
            ))}
          </div>
          {currentShaftName && (
            <div className="text-[9px] text-green-500 mt-1.5">
              Shaft: <span className="font-mono">{currentShaftName}</span>
            </div>
          )}
        </div>
      )}

      {/* Color */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Color</div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={obj.color}
            onChange={(e) => update({ color: e.target.value })}
            className="w-9 h-9 rounded cursor-pointer border border-gray-600/50 bg-transparent"
          />
          <input
            type="text"
            value={obj.color}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) update({ color: e.target.value })
            }}
            className="flex-1 bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1.5 focus:outline-none focus:border-indigo-500 font-mono"
          />
        </div>
      </div>

      {/* Material */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Material</div>
        <div className="grid grid-cols-3 gap-1">
          {MATERIAL_TYPES.map((m) => (
            <button
              key={m}
              onClick={() => update({ material: m })}
              className={`py-1.5 rounded text-xs capitalize transition-colors ${
                obj.material === m
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-slate-900 border border-gray-600/50'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Gear parameters — only for gear objects */}
      {obj.type === 'gear' && (() => {
        const teeth     = obj.teeth     ?? 12
        const gearMod   = obj.module    ?? 0.25
        const faceWidth = obj.faceWidth ?? 0.5
        const bore      = obj.bore      ?? 0
        const pitchR    = (teeth * gearMod) / 2
        const myPairs   = meshPairs.filter(p => p.gearAId === selectedId || p.gearBId === selectedId)
        const meshedIds = new Set(myPairs.map(p => p.gearAId === selectedId ? p.gearBId : p.gearAId))
        const otherGears = objects.filter(o => o.type === 'gear' && o.id !== selectedId && !meshedIds.has(o.id))

        const rebuild = (t, m, fw, b) => {
          objectManager.rebuildGear(selectedId, { teeth: t, module: m, faceWidth: fw, bore: b })
        }

        return (
          <div className="mb-3 p-2 bg-gray-800/40 rounded border border-orange-700/30">
            <div className="text-[10px] text-orange-400 uppercase tracking-wider mb-2 font-semibold">Gear</div>

            {/* Teeth */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] text-gray-400 w-14 shrink-0">Teeth</span>
              <input type="range" min={6} max={48} step={1}
                value={teeth}
                onChange={e => { const v = +e.target.value; updateObject(selectedId, { teeth: v }); rebuild(v, gearMod, faceWidth, bore) }}
                className="flex-1 accent-orange-500"
              />
              <span className="text-[10px] text-white w-6 text-right">{teeth}</span>
            </div>

            {/* Module */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] text-gray-400 w-14 shrink-0">Module</span>
              <input type="range" min={0.1} max={0.6} step={0.05}
                value={gearMod}
                onChange={e => { const v = +e.target.value; updateObject(selectedId, { module: v }); rebuild(teeth, v, faceWidth, bore) }}
                className="flex-1 accent-orange-500"
              />
              <span className="text-[10px] text-white w-8 text-right">{gearMod.toFixed(2)}</span>
            </div>

            {/* Face width */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] text-gray-400 w-14 shrink-0">Width</span>
              <input type="range" min={0.1} max={2.0} step={0.1}
                value={faceWidth}
                onChange={e => { const v = +e.target.value; updateObject(selectedId, { faceWidth: v }); rebuild(teeth, gearMod, v, bore) }}
                className="flex-1 accent-orange-500"
              />
              <span className="text-[10px] text-white w-8 text-right">{faceWidth.toFixed(1)}</span>
            </div>

            {/* Bore hole — 0 = solid (no hole), >0 = shaft hole as fraction of root radius */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] text-gray-400 w-14 shrink-0">Bore</span>
              <input type="range" min={0} max={0.8} step={0.05}
                value={bore}
                onChange={e => { const v = +e.target.value; updateObject(selectedId, { bore: v }); rebuild(teeth, gearMod, faceWidth, v) }}
                className="flex-1 accent-orange-500"
              />
              <span className="text-[10px] text-white w-8 text-right">{bore === 0 ? 'none' : bore.toFixed(2)}</span>
            </div>

            <div className="text-[9px] text-gray-600 mb-2">
              Pitch ⌀ {(pitchR * 2).toFixed(2)} u · {teeth} teeth
            </div>

            {/* Gear mesh pairs */}
            <div className="text-[9px] text-gray-400 mb-1">Meshed with</div>
            {myPairs.length === 0 && (
              <div className="text-[9px] text-gray-600 mb-1 italic">No connections</div>
            )}
            {myPairs.map(pair => {
              const otherId  = pair.gearAId === selectedId ? pair.gearBId : pair.gearAId
              const otherObj = objects.find(o => o.id === otherId)
              const ratio    = ((otherObj?.teeth ?? 12) / teeth).toFixed(2)
              return (
                <div key={pair.id}
                  className="flex items-center gap-1 mb-1 bg-gray-900/60 rounded px-2 py-1 text-[9px]"
                >
                  <span className="text-orange-300 flex-1 truncate">{otherObj?.name ?? 'Deleted'}</span>
                  <span className="text-gray-500">×{ratio}</span>
                  <button onClick={() => removeMeshPair(pair.id)}
                    className="text-red-500 hover:text-red-400 ml-1 text-[11px] leading-none"
                  >×</button>
                </div>
              )
            })}

            {otherGears.length > 0 && (
              <select
                onChange={e => { if (e.target.value) { addMeshPair(selectedId, e.target.value); e.target.value = '' } }}
                defaultValue=""
                className="w-full mt-1 bg-gray-900 border border-orange-700/40 rounded text-[9px] text-gray-300 px-2 py-1 focus:outline-none cursor-pointer"
              >
                <option value="">+ Mesh with…</option>
                {otherGears.map(g => (
                  <option key={g.id} value={g.id}>{g.name} ({g.teeth ?? 12}t)</option>
                ))}
              </select>
            )}
          </div>
        )
      })()}

      {/* ── Fillet / Chamfer — only for box and rectprism ───────────────────── */}
      {!isElectronics && (obj.type === 'box' || obj.type === 'rectprism') && (() => {
        const maxR = obj.type === 'rectprism' ? 0.70 : 0.95
        const curR = obj.fillet ?? 0
        const isChamfer = (obj.filletSegments ?? 3) === 1
        const isPartial = obj.filletMode === 'partial'
        const axis      = obj.filletAxis ?? 'z'
        const corners   = obj.filletCorners ?? [true, true, true, true]

        // Toggle one corner of the cross-section (an edge running along `axis`)
        const toggleCorner = (i) => {
          const next = corners.slice()
          next[i] = !next[i]
          update({ fillet: curR > 0 ? curR : 0.3, filletCorners: next })
          snapshot()
        }
        // 2×2 grid → corner index. mask order is [BL, BR, TR, TL].
        const gridOrder = [3, 2, 0, 1] // TL, TR, BL, BR (visual top-down)

        return (
          <div className="mb-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Edge Style</div>

            {/* Fillet vs Chamfer type selector */}
            <div className="flex gap-1 mb-2">
              {[
                { label: 'Fillet', segs: 3, active: !isChamfer },
                { label: 'Chamfer', segs: 1, active: isChamfer },
              ].map(({ label, segs, active }) => (
                <button
                  key={label}
                  onClick={() => { update({ filletSegments: segs }); snapshot() }}
                  className={`flex-1 py-1 rounded text-[10px] uppercase font-semibold border transition-colors ${
                    active
                      ? segs === 1
                        ? 'bg-orange-700/60 border-orange-500 text-white'
                        : 'bg-indigo-700/60 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900 hover:bg-gray-700'
                  }`}
                >{label}</button>
              ))}
            </div>

            {/* All edges vs Selected edges */}
            <div className="flex gap-1 mb-2">
              {[
                { label: 'All Edges', partial: false },
                { label: 'Pick Edges', partial: true },
              ].map(({ label, partial }) => (
                <button
                  key={label}
                  onClick={() => { update({ filletMode: partial ? 'partial' : 'all' }); snapshot() }}
                  className={`flex-1 py-1 rounded text-[10px] font-semibold border transition-colors ${
                    isPartial === partial
                      ? 'bg-teal-700/60 border-teal-500 text-white'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900 hover:bg-gray-700'
                  }`}
                >{label}</button>
              ))}
            </div>

            {/* Per-edge picker (partial mode) */}
            {isPartial && (
              <div className="mb-2 p-2 rounded bg-gray-800/50 border border-teal-700/30">
                <div className="text-[9px] text-gray-400 mb-1">Edges run along</div>
                <div className="flex gap-1 mb-2">
                  {['x', 'y', 'z'].map(a => (
                    <button
                      key={a}
                      onClick={() => { update({ filletAxis: a }); snapshot() }}
                      className={`flex-1 py-1 rounded text-[10px] uppercase font-semibold border transition-colors ${
                        axis === a
                          ? 'bg-teal-700/60 border-teal-500 text-white'
                          : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900 hover:bg-gray-700'
                      }`}
                    >{a}</button>
                  ))}
                </div>
                <div className="text-[9px] text-gray-400 mb-1">Tap an edge to round it</div>
                {/* 2×2 corner grid — each cell is one of the 4 edges parallel to the axis */}
                <div className="grid grid-cols-2 gap-1 w-24 mx-auto mb-1">
                  {gridOrder.map(i => (
                    <button
                      key={i}
                      onClick={() => toggleCorner(i)}
                      className={`aspect-square rounded border-2 transition-colors flex items-center justify-center text-[14px] ${
                        corners[i]
                          ? 'bg-teal-600/50 border-teal-400 text-teal-100'
                          : 'bg-gray-900 border-gray-600 text-gray-600 hover:border-gray-400'
                      }`}
                      title={corners[i] ? 'Rounded — click to sharpen' : 'Sharp — click to round'}
                    >{corners[i] ? '◜' : '└'}</button>
                  ))}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { update({ filletCorners: [true, true, true, true] }); snapshot() }}
                    className="flex-1 py-0.5 text-[9px] rounded bg-gray-800 border border-gray-600/50 text-gray-400 hover:text-slate-900"
                  >All 4</button>
                  <button
                    onClick={() => { update({ filletCorners: [false, false, false, false] }); snapshot() }}
                    className="flex-1 py-0.5 text-[9px] rounded bg-gray-800 border border-gray-600/50 text-gray-400 hover:text-slate-900"
                  >None</button>
                </div>
                <div className="text-[9px] text-gray-600 mt-1">
                  One cell = one edge · two adjacent = one side
                </div>
              </div>
            )}

            {/* Radius slider */}
            <input
              type="range"
              min={0}
              max={maxR}
              step={0.01}
              value={curR}
              onChange={e => update({ fillet: parseFloat(e.target.value) })}
              onMouseUp={snapshot}
              className="w-full mb-1.5 cursor-pointer accent-indigo-500"
              style={{ height: '4px' }}
            />

            {/* Numeric input + reset */}
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={maxR}
                step={0.01}
                value={curR}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v)) update({ fillet: Math.max(0, Math.min(maxR, v)) })
                }}
                onBlur={snapshot}
                className="flex-1 bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1 focus:outline-none focus:border-indigo-500"
              />
              <span className="text-[9px] text-gray-500 shrink-0">r</span>
              {curR > 0 && (
                <button
                  onClick={() => { update({ fillet: 0 }); snapshot() }}
                  title="Remove fillet"
                  className="shrink-0 text-[9px] text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-900/30 transition-colors"
                >✕</button>
              )}
            </div>
            <div className="text-[9px] text-gray-600 mt-1">
              {isPartial
                ? (isChamfer ? 'Chamfer — only the picked edges are cut' : 'Fillet — only the picked edges are rounded')
                : (isChamfer ? 'Chamfer — flat angled cut on every edge' : 'Fillet — smooth round on every edge')}
            </div>
          </div>
        )
      })()}

      {/* Bend / Deform — only for primitive geometry */}
      {!isElectronics && obj.type !== 'csg' && (
        <div className="mb-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Bend</div>
          {/* Axis selector */}
          <div className="flex gap-1 mb-2">
            {['x', 'y', 'z'].map(axis => (
              <button
                key={axis}
                onClick={() => {
                  const angle = obj.deform?.bend ?? 0
                  update({ deform: { bend: angle, bendAxis: axis } })
                  objectManager.setBend(obj.id, angle, axis)
                }}
                className={`flex-1 py-1 rounded text-[10px] uppercase font-semibold border transition-colors ${
                  (obj.deform?.bendAxis ?? 'y') === axis
                    ? 'bg-purple-700/60 border-purple-500 text-white'
                    : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-slate-900 hover:bg-gray-700'
                }`}
              >
                {axis}
              </button>
            ))}
          </div>
          {/* Angle slider */}
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={obj.deform?.bend ?? 0}
            onChange={e => {
              const angle = parseFloat(e.target.value)
              const axis  = obj.deform?.bendAxis ?? 'y'
              update({ deform: { bend: angle, bendAxis: axis } })
              objectManager.setBend(obj.id, angle, axis)
            }}
            onMouseUp={snapshot}
            className="w-full mb-1.5 cursor-pointer accent-purple-500"
            style={{ height: '4px' }}
          />
          {/* Numeric input + reset */}
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={-180}
              max={180}
              step={1}
              value={obj.deform?.bend ?? 0}
              onChange={e => {
                const angle = parseFloat(e.target.value)
                if (!isNaN(angle)) {
                  const axis = obj.deform?.bendAxis ?? 'y'
                  update({ deform: { bend: angle, bendAxis: axis } })
                  objectManager.setBend(obj.id, angle, axis)
                }
              }}
              onBlur={snapshot}
              className="flex-1 bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1 focus:outline-none focus:border-purple-500"
            />
            <span className="text-[9px] text-gray-500 shrink-0">°</span>
            {(obj.deform?.bend ?? 0) !== 0 && (
              <button
                onClick={() => {
                  const axis = obj.deform?.bendAxis ?? 'y'
                  update({ deform: { bend: 0, bendAxis: axis } })
                  objectManager.setBend(obj.id, 0, axis)
                  snapshot()
                }}
                title="Reset bend to straight"
                className="shrink-0 text-[9px] text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-900/30 transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          <div className="text-[9px] text-gray-600 mt-1">
            Axis = which direction the object extends · angle = total arc
          </div>
        </div>
      )}

      {/* ── Dimensions (editable W/H/D with one-sided scaling) ──────────────── */}
      {!isElectronics && (
        <div className="mb-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Dimensions</div>
          <DimensionEditorPanel obj={obj} />
        </div>
      )}

      {/* ── Face Extrude ──────────────────────────────────────────────────────── */}
      {!isElectronics && (
        <details className="mb-3 group">
          <summary className="text-[10px] text-gray-400 uppercase tracking-wider cursor-pointer hover:text-indigo-400 flex items-center gap-1 select-none">
            <span className="text-gray-600 group-open:text-indigo-400">▶</span>
            Extrude Face
          </summary>
          <div className="mt-2">
            <ExtrudePanel obj={obj} />
          </div>
        </details>
      )}

      {/* ── Fillet / Bevel ────────────────────────────────────────────────────── */}
      {!isElectronics && (
        <details className="mb-3 group">
          <summary className="text-[10px] text-gray-400 uppercase tracking-wider cursor-pointer hover:text-indigo-400 flex items-center gap-1 select-none">
            <span className="text-gray-600 group-open:text-indigo-400">▶</span>
            Fillet / Bevel
          </summary>
          <div className="mt-2">
            <FilletPanel obj={obj} />
          </div>
        </details>
      )}

      {/* ── Inspect (measure / mass / size) ───────────────────────────────────── */}
      <InspectSection obj={obj} secondaryObj={objects.find(o => o.id === secondaryId) ?? null} />

      {/* ── Text shape content ────────────────────────────────────────────────── */}
      {obj.type === 'text' && <TextShapeEditor obj={obj} update={update} snapshot={snapshot} />}

      {/* ── Align (two-object) ────────────────────────────────────────────────── */}
      <AlignTools obj={obj} secondaryObj={secondaryObj} updateObject={updateObject} snapshot={snapshot} />

      {/* ── Pattern / Mirror ──────────────────────────────────────────────────── */}
      <PatternTools obj={obj} insertObject={insertObject} snapshot={snapshot} />

      {/* ── Hole / Solid + Group / Ungroup ────────────────────────────────────── */}
      {!isElectronics && (
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Type</div>
          <button
            onClick={() => { toggleHole(obj.id); snapshot() }}
            title="Holes carve out solids when grouped (Tinkercad-style)"
            className={`px-3 py-1 rounded text-xs transition-colors border ${
              obj.isHole
                ? 'bg-sky-800/40 text-sky-200 border-sky-700/50'
                : 'bg-gray-700 text-gray-300 border-gray-600/50'
            }`}
          >
            {obj.isHole ? '◌ Hole' : '◼ Solid'}
          </button>
        </div>
      )}
      {!isElectronics && secondaryObj && (
        <button
          onClick={() => { if (groupSelected()) snapshot() }}
          className="w-full mb-2 py-1.5 rounded text-xs font-semibold bg-purple-700 hover:bg-purple-600 text-white transition-colors"
        >
          ⊕ Group selected (Ctrl+G)
        </button>
      )}
      {Array.isArray(obj.groupMembers) && obj.groupMembers.length > 0 && (
        <button
          onClick={() => { if (ungroupSelected()) snapshot() }}
          className="w-full mb-2 py-1.5 rounded text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-gray-100 transition-colors"
        >
          ⊟ Ungroup ({obj.groupMembers.length}) (Ctrl+Shift+G)
        </button>
      )}

      {/* Visibility */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider">Visible</div>
        <button
          onClick={() => update({ visible: !obj.visible })}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            obj.visible
              ? 'bg-green-700/50 text-green-300 border border-green-700/50'
              : 'bg-gray-700 text-gray-400 border border-gray-600/50'
          }`}
        >
          {obj.visible ? 'Shown' : 'Hidden'}
        </button>
      </div>

      <div className="border-t border-gray-700/50 pt-3 flex gap-2">
        <button
          onClick={handleDuplicate}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs py-1.5 rounded transition-colors"
        >
          Duplicate
        </button>
        <button
          onClick={handleDelete}
          className="flex-1 bg-red-800/60 hover:bg-red-700 text-red-200 text-xs py-1.5 rounded transition-colors"
        >
          Delete
        </button>
      </div>
      {!isElectronics && <SaveAssetButton obj={obj} />}
    </div>
  )
}

// ── Text shape editor: live string + size + thickness ─────────────────────────
function TextShapeEditor({ obj, update, snapshot }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Text</div>
      <input
        type="text"
        value={obj.textContent ?? ''}
        placeholder="Type text…"
        onChange={(e) => update({ textContent: e.target.value })}
        onBlur={snapshot}
        className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1.5 mb-2 focus:outline-none focus:border-amber-500"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[9px] text-gray-500">
          Size
          <input
            type="number" step={0.1} min={0.1}
            value={r3(obj.textSize ?? 1)}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) update({ textSize: v }) }}
            onBlur={snapshot}
            className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1 focus:outline-none focus:border-amber-500"
          />
        </label>
        <label className="text-[9px] text-gray-500">
          Thickness
          <input
            type="number" step={0.1} min={0.05}
            value={r3(obj.textHeight ?? 0.4)}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) update({ textHeight: v }) }}
            onBlur={snapshot}
            className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1 focus:outline-none focus:border-amber-500"
          />
        </label>
      </div>
    </div>
  )
}

// ── Align: line up the primary + secondary selection along a world axis ────────
function AlignTools({ obj, secondaryObj, updateObject, snapshot }) {
  if (!secondaryObj) return null

  const apply = (axis, mode) => {
    const ma = objectManager.getMesh(obj.id)
    const mb = objectManager.getMesh(secondaryObj.id)
    if (!ma || !mb) return
    ma.updateMatrixWorld(true); mb.updateMatrixWorld(true)
    const ba = new THREE.Box3().setFromObject(ma)
    const bb = new THREE.Box3().setFromObject(mb)
    if (ba.isEmpty() || bb.isEmpty()) return

    // World-space target coordinate for the chosen reference edge/center.
    const lo = Math.min(ba.min[axis], bb.min[axis])
    const hi = Math.max(ba.max[axis], bb.max[axis])
    const target = mode === 'min' ? lo : mode === 'max' ? hi : (lo + hi) / 2

    ;[[obj, ba], [secondaryObj, bb]].forEach(([ob, box]) => {
      const cur = mode === 'min' ? box.min[axis] : mode === 'max' ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2
      const pos = { ...ob.position }
      pos[axis] += target - cur
      updateObject(ob.id, { position: pos })
    })
    snapshot()
  }

  const Btn = ({ axis, mode, label }) => (
    <button
      onClick={() => apply(axis, mode)}
      className="flex-1 py-1 rounded text-[10px] bg-gray-700 hover:bg-amber-700 text-gray-200 hover:text-white transition-colors"
    >
      {label}
    </button>
  )

  return (
    <details className="mb-3 group">
      <summary className="text-[10px] text-gray-400 uppercase tracking-wider cursor-pointer hover:text-amber-400 flex items-center gap-1 select-none">
        <span className="text-gray-600 group-open:text-amber-400">▶</span>
        Align (2 objects)
      </summary>
      <div className="mt-2 flex flex-col gap-1.5">
        {['x', 'y', 'z'].map((axis) => (
          <div key={axis} className="flex items-center gap-1">
            <span className="w-3 text-[10px] font-bold text-gray-500 uppercase">{axis}</span>
            <Btn axis={axis} mode="min" label="Min" />
            <Btn axis={axis} mode="center" label="Center" />
            <Btn axis={axis} mode="max" label="Max" />
          </div>
        ))}
        <div className="text-[9px] text-gray-600">Lines up the two selected objects along each axis.</div>
      </div>
    </details>
  )
}

// ── Inspect: read-only mass / size / center, plus distance to a 2nd selection ──
function InspectRow({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${accent ? 'text-amber-300' : 'text-gray-300'}`}>{value}</span>
    </div>
  )
}

function InspectSection({ obj, secondaryObj }) {
  let mass = 0
  try { mass = getMass(obj.type, obj.scale, obj.material) } catch (_) {}

  // World-space bounding box (size + center) from the live mesh.
  let dims = null, center = null
  const mesh = objectManager.getMesh(obj.id)
  if (mesh) {
    mesh.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(mesh)
    if (!box.isEmpty()) {
      const s = box.getSize(new THREE.Vector3())
      const c = box.getCenter(new THREE.Vector3())
      dims   = { x: r3(s.x), y: r3(s.y), z: r3(s.z) }
      center = { x: r3(c.x), y: r3(c.y), z: r3(c.z) }
    }
  }

  // Distance between the two selected objects' centers (basic measure tool).
  let dist = null
  if (secondaryObj) {
    const a = obj.position, b = secondaryObj.position
    dist = r3(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z))
  }

  return (
    <details className="mb-3 group">
      <summary className="text-[10px] text-gray-400 uppercase tracking-wider cursor-pointer hover:text-amber-400 flex items-center gap-1 select-none">
        <span className="text-gray-600 group-open:text-amber-400">▶</span>
        Inspect
      </summary>
      <div className="mt-2 text-[11px] space-y-1">
        <InspectRow label="Mass" value={`${mass.toFixed(3)} kg`} />
        {dims   && <InspectRow label="Size W×H×D" value={`${dims.x} × ${dims.y} × ${dims.z}`} />}
        {center && <InspectRow label="Center" value={`${center.x}, ${center.y}, ${center.z}`} />}
        {dist != null
          ? <InspectRow label="↔ Distance to 2nd" value={`${dist} u`} accent />
          : <div className="text-[9px] text-gray-600 pt-0.5">Shift-select a second object to measure the distance between them.</div>}
      </div>
    </details>
  )
}

// ── Pattern / Mirror: clone the selected object in a linear/circular array or
//    mirror it across a world axis. All clones land in ONE undo step (one snapshot).
const PAT_AXES = ['x', 'y', 'z']

function PatternTools({ obj, insertObject, snapshot }) {
  const [tab, setTab]         = useState('linear')   // 'linear' | 'circular' | 'mirror'
  const [axis, setAxis]       = useState('x')
  const [count, setCount]     = useState(3)
  const [spacing, setSpacing] = useState(3)
  const [angle, setAngle]     = useState(360)

  const cloneWith = (overrides) => ({
    ...JSON.parse(JSON.stringify(obj)),
    id: crypto.randomUUID(),
    name: `${obj.name}_copy`,
    ...overrides,
    metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  })

  const N = () => Math.max(2, Math.min(64, Math.round(count) || 2))

  const applyLinear = () => {
    const n = N()
    for (let i = 1; i < n; i++) {
      const p = { ...obj.position }; p[axis] += i * spacing
      insertObject(cloneWith({ position: p }))
    }
    snapshot()
  }

  const applyCircular = () => {
    const n = N()
    const axisVec = axis === 'x' ? new THREE.Vector3(1, 0, 0)
                  : axis === 'y' ? new THREE.Vector3(0, 1, 0)
                  : new THREE.Vector3(0, 0, 1)
    const full  = Math.abs(angle) >= 360
    const denom = full ? n : Math.max(1, n - 1)   // full circle leaves a gap; arc spans ends
    for (let i = 1; i < n; i++) {
      const rad = degToRad(angle) * (i / denom)
      const pos = new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z).applyAxisAngle(axisVec, rad)
      const rot = { ...obj.rotation }; rot[axis] += rad
      insertObject(cloneWith({ position: { x: pos.x, y: pos.y, z: pos.z }, rotation: rot }))
    }
    snapshot()
  }

  const applyMirror = (ax) => {
    const position = { ...obj.position }; position[ax] = -position[ax]
    const scale    = { ...obj.scale };    scale[ax]    = -scale[ax]   // true reflection
    insertObject(cloneWith({ position, scale }))
    snapshot()
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)}
      className={`flex-1 py-1 rounded text-[10px] border transition-colors ${
        tab === id ? 'bg-amber-600/70 border-amber-500 text-white' : 'bg-gray-800 border-gray-600/40 text-gray-400 hover:text-white'}`}>
      {label}
    </button>
  )
  const axisBtns = () => (
    <div className="flex gap-1">
      {PAT_AXES.map(a => (
        <button key={a} onClick={() => setAxis(a)}
          className={`flex-1 py-1 rounded text-[10px] uppercase border transition-colors ${
            axis === a ? 'bg-amber-600/70 border-amber-500 text-white' : 'bg-gray-800 border-gray-600/40 text-gray-400 hover:text-white'}`}>{a}</button>
      ))}
    </div>
  )
  const numField = (label, value, set, step = 1) => (
    <label className="flex-1 text-[9px] text-gray-500">
      {label}
      <input type="number" step={step} value={value}
        onChange={e => set(parseFloat(e.target.value))}
        className="w-full mt-0.5 bg-gray-800 border border-gray-600/50 rounded text-[11px] text-white px-1.5 py-1 focus:outline-none focus:border-amber-500" />
    </label>
  )

  return (
    <details className="mb-3 group">
      <summary className="text-[10px] text-gray-400 uppercase tracking-wider cursor-pointer hover:text-amber-400 flex items-center gap-1 select-none">
        <span className="text-gray-600 group-open:text-amber-400">▶</span>
        Pattern / Mirror
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex gap-1">{tabBtn('linear', 'Linear')}{tabBtn('circular', 'Circular')}{tabBtn('mirror', 'Mirror')}</div>

        {tab === 'mirror' ? (
          <>
            <div className="text-[9px] text-gray-500">Mirror a copy across a world axis</div>
            <div className="flex gap-1">
              {PAT_AXES.map(a => (
                <button key={a} onClick={() => applyMirror(a)}
                  className="flex-1 py-1.5 rounded text-[10px] uppercase bg-gray-700 hover:bg-amber-700 text-gray-200 hover:text-white transition-colors">↔ {a}</button>
              ))}
            </div>
          </>
        ) : tab === 'linear' ? (
          <>
            {axisBtns()}
            <div className="flex gap-2">{numField('Count', count, setCount)}{numField('Spacing', spacing, setSpacing, 0.5)}</div>
            <button onClick={applyLinear}
              className="w-full py-1.5 rounded text-xs font-semibold bg-amber-700 hover:bg-amber-600 text-white transition-colors">Apply Linear Pattern</button>
          </>
        ) : (
          <>
            {axisBtns()}
            <div className="flex gap-2">{numField('Count', count, setCount)}{numField('Total °', angle, setAngle, 15)}</div>
            <div className="text-[9px] text-gray-600">Rotates copies around the world {axis.toUpperCase()}-axis through the origin.</div>
            <button onClick={applyCircular}
              className="w-full py-1.5 rounded text-xs font-semibold bg-amber-700 hover:bg-amber-600 text-white transition-colors">Apply Circular Pattern</button>
          </>
        )}
      </div>
    </details>
  )
}

function SaveAssetButton({ obj }) {
  const saveAsset = useAssetStore((s) => s.saveAsset)
  const [flash, setFlash] = useState(false)

  const handleSave = () => {
    saveAsset(obj)
    setFlash(true)
    setTimeout(() => setFlash(false), 1200)
  }

  return (
    <button
      onClick={handleSave}
      className={`mt-2 w-full py-1.5 text-xs rounded transition-all ${
        flash
          ? 'bg-indigo-700 text-indigo-100'
          : 'bg-gray-800 hover:bg-indigo-900/40 border border-gray-600/50 hover:border-indigo-700/50 text-gray-400 hover:text-indigo-300'
      }`}
    >
      {flash ? '✓ Saved to Library' : '📦 Save as Asset'}
    </button>
  )
}
