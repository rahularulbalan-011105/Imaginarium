import { useEffect, useRef, useCallback, useState } from 'react'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { wireManager } from '../managers/WireManager.js'
import { historyManager } from '../managers/HistoryManager.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { vec3FromObject } from '../utils/helpers.js'

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

  const [attachPrompt, setAttachPrompt] = useState(null) // { objectId, motorId, motorName }

  // Initialize Three.js scene
  useEffect(() => {
    if (initialized.current || !canvasRef.current) return
    const container = containerRef.current
    const { width, height } = container.getBoundingClientRect()
    sceneManager.init(canvasRef.current, width, height)
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
    // Don't attach transform gizmo to objects that are riding a motor rotor
    if (selectedId && !attachments[selectedId]) {
      const mesh = objectManager.getMesh(selectedId)
      sceneManager.attachTransformTo(mesh || null)
    } else {
      sceneManager.detachTransform()
    }
    objectManager.setSelectionHighlights(selectedId, secondaryId)
  }, [selectedId, secondaryId, attachments])

  // Sync grid/axes visibility
  useEffect(() => {
    if (initialized.current) sceneManager.setGridVisible(gridVisible)
  }, [gridVisible])

  useEffect(() => {
    if (initialized.current) sceneManager.setAxesVisible(axesVisible)
  }, [axesVisible])

  // Sync transform mode
  useEffect(() => {
    if (initialized.current) sceneManager.setTransformMode(transformMode)
  }, [transformMode])

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
    const consumed = wireManager.onMouseDown(e, bounds)
    if (consumed) setWireDragging(true)
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    wireManager.onMouseMove(e, bounds)
  }, [])

  const handleMouseUp = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    wireManager.onMouseUp(e, bounds)
    // Always re-enable orbit on mouseup so it's never stuck disabled
    if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
    setWireDragging(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (wireManager.isDragging) {
      wireManager.cancelDrag()
      if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
      setWireDragging(false)
    }
  }, [])

  const handleClick = useCallback(
    (e) => {
      if (!initialized.current || dragging.current) return
      // If wire system just finished a drag, don't select objects
      if (wireManager.isDragging) return
      const bounds = canvasRef.current.getBoundingClientRect()
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
    [selectedId, selectObject, setSecondaryId, clearSelection]
  )

  const hasBothSelected = selectedId && secondaryId

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${wireDragging ? 'cursor-crosshair' : 'cursor-crosshair'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />

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

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-500 pointer-events-none select-none bg-white/60 px-2 py-0.5 rounded-full">
        Click to select · Shift+click 2nd object for booleans · Scroll to zoom · Middle-drag to orbit
      </div>
    </div>
  )
}
