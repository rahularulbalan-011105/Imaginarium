import { useEffect, useRef, useCallback, useState } from 'react'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { wireManager } from '../managers/WireManager.js'
import { patchManager } from '../managers/PatchManager.js'
import { historyManager } from '../managers/HistoryManager.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { vec3FromObject } from '../utils/helpers.js'
import { attachPointEvents } from './PropertiesPanel.jsx'
import DimensionOverlay from './DimensionOverlay.jsx'
import DrivePanel from './DrivePanel.jsx'
import { driveManager } from '../managers/DriveManager.js'

export default function Viewport() {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const initialized = useRef(false)
  const dragging = useRef(false)
  const prevObjects = useRef([])

  const objects = useSceneStore((s) => s.objects)
  const selectedId = useSceneStore((s) => s.selectedId)
  const secondaryId = useSceneStore((s) => s.secondaryId)
  const gridVisible = useSceneStore((s) => s.gridVisible)
  const axesVisible = useSceneStore((s) => s.axesVisible)
  const updateObject = useSceneStore((s) => s.updateObject)
  const selectObject = useSceneStore((s) => s.selectObject)
  const setSecondaryId = useSceneStore((s) => s.setSecondaryId)
  const clearSelection = useSceneStore((s) => s.clearSelection)
  const transformMode = useUiStore((s) => s.transformMode)

  const attachments   = useElectronicsStore((s) => s.attachments)
  const attachToMotor = useElectronicsStore((s) => s.attachToMotor)
  const detachFromMotor = useElectronicsStore((s) => s.detachFromMotor)
  const bonds = useRigidStore((s) => s.bonds)

  const surfaceToolActive = useUiStore((s) => s.surfaceToolActive)
  const simActive         = useUiStore((s) => s.simActive)
  const patches           = useSurfaceStore((s) => s.patches)
  const selectedPatchIds  = useSurfaceStore((s) => s.selectedIds)
  const addPatch          = useSurfaceStore((s) => s.addPatch)
  const updatePatch       = useSurfaceStore((s) => s.updatePatch)
  const toggleSelectPatch = useSurfaceStore((s) => s.toggleSelectPatch)

  // Refs so callbacks always see latest values without re-creating handlers
  const surfaceToolRef    = useRef(false)
  const patchesRef        = useRef({})
  surfaceToolRef.current  = surfaceToolActive
  patchesRef.current      = patches

  const [attachPrompt, setAttachPrompt] = useState(null) // { objectId, motorId, motorName }
  const [pickMode, setPickMode] = useState(null)         // objectId being picked, or null
  const patchDrawingRef = useRef(false)                   // true while drawing a new patch

  // Listen for "start attachment-point pick" events from PropertiesPanel
  useEffect(() => {
    const handler = (e) => setPickMode(e.detail.id)
    attachPointEvents.addEventListener('startPick', handler)
    return () => attachPointEvents.removeEventListener('startPick', handler)
  }, [])

  // Sync patch store → Three.js objects every time patches or selection changes
  useEffect(() => {
    if (!initialized.current) return
    patchManager.sync(patches, selectedPatchIds)
  }, [patches, selectedPatchIds])

  // When an object is deleted, remove its patches and any rigid bonds it was part of
  useEffect(() => {
    const ids = new Set(objects.map(o => o.id))
    for (const patch of Object.values(patches)) {
      if (!ids.has(patch.objectId)) {
        useSurfaceStore.getState().removePatchesForObject(patch.objectId)
      }
    }
    for (const bond of useRigidStore.getState().getBonds()) {
      if (!ids.has(bond.parentId) || !ids.has(bond.childId)) {
        useRigidStore.getState().removeBond(bond.id)
      }
    }
  }, [objects]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize Three.js scene
  useEffect(() => {
    if (initialized.current || !canvasRef.current) return
    const container = containerRef.current
    const { width, height } = container.getBoundingClientRect()
    sceneManager.init(canvasRef.current, width, height)
    patchManager.init(sceneManager.scene, sceneManager.camera, objectManager)
    driveManager.init(sceneManager.scene, objectManager)
    initialized.current = true

    sceneManager.onTransformChange = () => {
      const tc = sceneManager.transformControls
      const mesh = tc?.object
      if (!mesh) return
      const id = mesh.userData.id
      updateObject(id, {
        position: vec3FromObject(mesh.position),
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
        scale: vec3FromObject(mesh.scale),
      })

      // Propagate rigid bonds — move the bonded partner whenever this object moves
      const allBonds = useRigidStore.getState().getBonds()
      for (const bond of allBonds) {
        if (bond.parentId !== id && bond.childId !== id) continue
        const isPar = bond.parentId === id
        const depId = isPar ? bond.childId : bond.parentId
        const result = objectManager.propagateBond(id, bond.relativeMatrix, isPar, depId)
        if (result) updateObject(depId, result)
      }
    }

    sceneManager.onDraggingChanged = (isDragging) => {
      dragging.current = isDragging
      if (!isDragging) {
        // Snapshot after drag ends so Ctrl+Z restores the pre-drag position
        historyManager.push(JSON.parse(JSON.stringify(useSceneStore.getState().objects)))
        // After a drag ends, check if the moved object is near a motor shaft
        const tc = sceneManager.transformControls
        const mesh = tc?.object
        if (!mesh) return
        const objectId = objectManager.resolveId(mesh)
        if (!objectId) return
        const movedObj = useSceneStore.getState().objects.find(o => o.id === objectId)
        if (!movedObj) return
        const isElectronics = movedObj.type === 'motor' || movedObj.type === 'motor_bo' || movedObj.type === 'motor_dc' || movedObj.type === 'arduino' || movedObj.type === 'led'
        const alreadyAttached = objectManager.attachedObjects.has(objectId)
        if (isElectronics || alreadyAttached) return

        const nearMotorId = objectManager.findNearbyMotorShaft(objectId)
        if (nearMotorId) {
          const motor = useSceneStore.getState().objects.find(o => o.id === nearMotorId)
          setAttachPrompt({ objectId, motorId: nearMotorId, motorName: motor?.name ?? 'Motor' })
        }
      }
    }

    const ro = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect()
      sceneManager.resize(width, height)
    })
    ro.observe(container)

    // ── Native capture-phase mousedown ─────────────────────────────────────
    // OrbitControls registers its listener in the bubble phase.
    // By firing first (capture=true) and disabling orbit before OrbitControls
    // sees the event, we prevent the camera from spinning during wire drags.
    const canvas = canvasRef.current
    const captureDown = (e) => {
      if (!initialized.current) return
      const bounds = canvas.getBoundingClientRect()
      if (wireManager.isInteractiveAt(e, bounds)) {
        if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = false
      }
    }
    // Keep orbit blocked during mouse-move so the camera doesn't drift
    const captureMove = (e) => {
      if (wireManager.isDragging && sceneManager.orbitControls) {
        sceneManager.orbitControls.enabled = false
      }
    }
    canvas.addEventListener('mousedown', captureDown, { capture: true })
    canvas.addEventListener('mousemove', captureMove, { capture: true })

    return () => {
      ro.disconnect()
      canvas.removeEventListener('mousedown', captureDown, { capture: true })
      canvas.removeEventListener('mousemove', captureMove, { capture: true })
      sceneManager.dispose()
      initialized.current = false
      dragging.current = false
      prevObjects.current = []
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync objects → Three.js meshes
  useEffect(() => {
    if (!initialized.current) return
    const prev = new Map(prevObjects.current.map((o) => [o.id, o]))
    const curr = new Map(objects.map((o) => [o.id, o]))

    for (const [id, prevObj] of prev) {
      if (!curr.has(id)) {
        if (id === selectedId) sceneManager.detachTransform()
        // When a motor is deleted, clean up all its rotor attachments in the store
        if (prevObj.type === 'motor' || prevObj.type === 'motor_bo' || prevObj.type === 'motor_dc') {
          const elStore = useElectronicsStore.getState()
          for (const [attachedId, motorId] of Object.entries(elStore.attachments)) {
            if (motorId === id) elStore.detachFromMotor(attachedId)
          }
        } else {
          // Clean up if this object itself was attached
          useElectronicsStore.getState().detachFromMotor(id)
        }
        objectManager.removeMesh(id)
      }
    }

    for (const [id, obj] of curr) {
      if (!prev.has(id)) {
        objectManager.createMesh(obj)
      } else if (!dragging.current || prev.get(id) !== obj) {
        objectManager.updateMesh(id, obj)
      }
    }

    prevObjects.current = objects
  }, [objects, selectedId])

  // Sync selection → TransformControls + highlights
  useEffect(() => {
    if (!initialized.current) return
    // Disable transform gizmo during simulation — objects are grouped under rootGroup
    if (simActive) {
      sceneManager.detachTransform()
      return
    }
    // Don't attach transform gizmo to objects riding a motor rotor or bond-children
    // (bond-children are positioned relative to their parent via the properties panel)
    const isBondChild = selectedId && Object.values(bonds).some(b => b.childId === selectedId)
    if (selectedId && !attachments[selectedId] && !isBondChild) {
      const mesh = objectManager.getMesh(selectedId)
      sceneManager.attachTransformTo(mesh || null)
    } else {
      sceneManager.detachTransform()
    }
    objectManager.setSelectionHighlights(selectedId, secondaryId)
  }, [selectedId, secondaryId, attachments, bonds, simActive])

  // Sync grid/axes visibility
  useEffect(() => {
    if (initialized.current) sceneManager.setGridVisible(gridVisible)
  }, [gridVisible])

  useEffect(() => {
    if (initialized.current) sceneManager.setAxesVisible(axesVisible)
  }, [axesVisible])

  // Sync transform mode — block scale for electronics
  useEffect(() => {
    if (!initialized.current) return
    const selObj = objects.find(o => o.id === selectedId)
    const ELEC = ['arduino', 'motor', 'motor_bo', 'motor_dc', 'led']
    const mode = (selObj && ELEC.includes(selObj.type) && transformMode === 'scale')
      ? 'translate'
      : transformMode
    sceneManager.setTransformMode(mode)
  }, [transformMode, selectedId, objects])

  const handleAttachConfirm = useCallback(() => {
    if (!attachPrompt) return
    const { objectId, motorId } = attachPrompt
    // Snap to shaft tip (x=3.0) so the object always lands at the shaft end,
    // regardless of where in the scene it was positioned before dragging.
    const success = objectManager.attachMeshToRotor(objectId, motorId, null)
    if (success) attachToMotor(objectId, motorId)
    setAttachPrompt(null)
  }, [attachPrompt, attachToMotor])

  const handleAttachCancel = useCallback(() => setAttachPrompt(null), [])

  const [wireDragging, setWireDragging] = useState(false)

  const handleMouseDown = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()

    if (surfaceToolRef.current) {
      // Surface mode: pick existing patch/handle to move/resize, or start drawing a new one
      const hit = patchManager.pick(e, bounds)
      if (hit) {
        const patch = patchesRef.current[hit.patchId]
        if (patch) {
          const type = hit.type === 'handle' ? 'resize' : 'move'
          patchManager.startInteract(e, bounds, hit.patchId, type, hit.handleIdx, patch)
        }
      } else {
        const started = patchManager.startDraw(e, bounds)
        if (started) {
          patchDrawingRef.current = true
          if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = false
        }
      }
      return
    }

    const consumed = wireManager.onMouseDown(e, bounds)
    if (consumed) setWireDragging(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseMove = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()

    if (surfaceToolRef.current) {
      if (patchManager.isDrawing) patchManager.updateDraw(e, bounds)
      if (patchManager.isDragging) {
        const result = patchManager.updateInteract(e, bounds)
        if (result) useSurfaceStore.getState().updatePatch(result.id, result.updates)
      }
      return
    }

    wireManager.onMouseMove(e, bounds)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseUp = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()

    if (surfaceToolRef.current) {
      if (patchManager.isDrawing) {
        const patch = patchManager.endDraw(e, bounds)
        if (patch) useSurfaceStore.getState().addPatch(patch)
        patchDrawingRef.current = false
      }
      if (patchManager.isDragging) patchManager.endInteract()
      if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
      return
    }

    wireManager.onMouseUp(e, bounds)
    if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
    setWireDragging(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseLeave = useCallback(() => {
    if (wireManager.isDragging) {
      wireManager.cancelDrag()
      if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
      setWireDragging(false)
    }
  }, [])

  const handleContextMenu = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    wireManager.onContextMenu(e, bounds)
  }, [])

  const handleClick = useCallback(
    (e) => {
      if (!initialized.current || dragging.current) return
      if (wireManager.isDragging) return
      const bounds = canvasRef.current.getBoundingClientRect()

      // ── Surface tool: select patches ───────────────────────────────────────
      if (surfaceToolRef.current) {
        if (patchDrawingRef.current) return   // was a draw stroke, not a click
        const hit = patchManager.pick(e, bounds)
        if (hit) useSurfaceStore.getState().toggleSelectPatch(hit.patchId)
        return
      }

      // ── Attachment-point pick mode ──────────────────────────────────────────
      if (pickMode) {
        const targetMesh = objectManager.getMesh(pickMode)
        if (targetMesh) {
          const result = sceneManager.pickSurfacePoint(e, bounds, targetMesh)
          if (result) {
            const { point, normal } = result
            const ap = {
              x: point.x, y: point.y, z: point.z,
              normal: normal ? { x: normal.x, y: normal.y, z: normal.z } : null,
            }
            // Persist in Zustand (so PropertiesPanel can show "point set")
            useSceneStore.getState().updateObject(pickMode, { attachmentOffset: ap })
            // Also set directly on the Three.js object for immediate use
            if (targetMesh) targetMesh.userData.attachmentOffset = ap
            objectManager.setAttachmentMarker(pickMode, point)
          }
        }
        setPickMode(null)
        return
      }

      const hit = sceneManager.pickObject(e, bounds)

      if (e.shiftKey) {
        if (hit) {
          const id = hit.userData.id
          if (id !== selectedId) setSecondaryId(id)
        }
        return
      }

      if (hit) {
        selectObject(hit.userData.id)
      } else {
        clearSelection()
      }
    },
    [pickMode, selectedId, selectObject, setSecondaryId, clearSelection]
  )

  const hasBothSelected = selectedId && secondaryId

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${
          surfaceToolActive ? 'cursor-crosshair' : pickMode ? 'cursor-cell' : 'cursor-crosshair'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
      />

      {/* Surface draw mode overlay */}
      {surfaceToolActive && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="flex items-center gap-2 bg-cyan-900/90 border border-cyan-500/70 text-cyan-200 text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            <span className="text-base">⬡</span>
            Hold + drag on any face to draw a surface patch · Click a patch to select it
            <button
              className="pointer-events-auto ml-2 text-cyan-400 hover:text-white transition-colors"
              onClick={() => useUiStore.getState().setSurfaceTool(false)}
            >
              ✕ Exit
            </button>
          </div>
        </div>
      )}

      {/* Attachment-point pick mode overlay */}
      {pickMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="flex items-center gap-2 bg-orange-900/90 border border-orange-500/70 text-orange-200 text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            <span className="text-base">◎</span>
            Click the exact spot on the prop where the shaft should connect
            <button
              className="pointer-events-auto ml-2 text-orange-400 hover:text-white transition-colors"
              onClick={() => setPickMode(null)}
            >
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      {/* Shaft attach prompt */}
      {attachPrompt && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
          <div className="bg-gray-900 border border-green-500/70 rounded-xl shadow-2xl p-5 w-72 pointer-events-auto">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-green-400 text-xl">⚙</span>
              <span className="text-white font-semibold text-sm">Attach to Motor Shaft?</span>
            </div>
            <p className="text-gray-300 text-xs mb-4 leading-relaxed">
              This object is near <span className="text-green-300 font-medium">{attachPrompt.motorName}</span>'s
              shaft. Attach it so it spins with the motor when the simulation runs?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleAttachConfirm}
                className="flex-1 py-2 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded transition-colors"
              >
                ✓ Attach
              </button>
              <button
                onClick={handleAttachCancel}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
              >
                ✗ Keep Separate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wire dragging hint */}
      {wireDragging && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-cyan-700/90 border border-cyan-500 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none select-none shadow-md">
          Drag to a pin to connect · Esc to cancel
        </div>
      )}

      {/* Shift+click hint when one object is selected */}
      {selectedId && !secondaryId && !wireDragging && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-blue-600/90 border border-blue-400 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none select-none shadow-md">
          Shift+click another object to enable Boolean operations
        </div>
      )}

      {/* Boolean ops active indicator */}
      {hasBothSelected && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-purple-700/90 border border-purple-400 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none select-none shadow-md">
          2 objects selected — use the Boolean panel on the right
        </div>
      )}

      <DimensionOverlay />

      {simActive && <DrivePanel />}

      {!simActive && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-500 pointer-events-none select-none bg-white/60 px-2 py-0.5 rounded-full">
          Click to select · Shift+click 2nd object for booleans · Scroll to zoom · Middle-drag to orbit
        </div>
      )}
    </div>
  )
}
