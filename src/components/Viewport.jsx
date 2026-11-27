import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { alignmentManager } from '../managers/AlignmentManager.js'
import { wireManager } from '../managers/WireManager.js'
import { patchManager } from '../managers/PatchManager.js'
import { recordSnapshot } from '../managers/history/editorDispatch.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSurfaceStore } from '../stores/surfaceStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { vec3FromObject } from '../utils/helpers.js'
import { attachPointEvents } from './PropertiesPanel.jsx'
import { isBooleanCandidate } from './BooleanPanel.jsx'
import { jointPickEvents } from './JointPanel.jsx'
import { jointManager } from '../managers/JointManager.js'
import DimensionOverlay from './DimensionOverlay.jsx'
import SlicePolylineOverlay from './SlicePolylineOverlay.jsx'
import SurfaceAttachPrompt from './SurfaceAttachPrompt.jsx'
import ExtrudePanel from './ExtrudePanel.jsx'
import ViewGizmo from './ViewGizmo.jsx'
import SelectionInspector from './SelectionInspector.jsx'
import EditBar from './EditBar.jsx'
import { handlesManager, useHandleDrag } from '../managers/HandlesManager.js'
import * as edit from '../managers/editActions.js'
import { applyMouseMapping, beginSlide, updateSlide, endSlide, isSliding, boxSelect, DRAG_THRESHOLD_PX } from '../managers/directManipulation.js'
import ViewControls from './ViewControls.jsx'
import { usePlacement, placeAt, groundPointFromEvent, showMarkerAt, hideMarker, cancelPlacement, viewCenterPoint } from '../managers/placement.js'
import ViewportToolbox from './ViewportToolbox.jsx'
import { WORKSPACE_PANELS } from './shell/nav.js'
import DrivePanel from './DrivePanel.jsx'
import { useHistory } from '../hooks/useHistory.js'
import { driveManager } from '../managers/DriveManager.js'
import { loadGLTFFromFile, loadSTLFromFile, loadModel, isModelLoaded, modelKeysFor } from '../utils/modelLoader.js'
import { storeImportedGeometry } from '../managers/ObjectManager.js'
import { v4 as uuidv4 } from 'uuid'

// Surface tool: pointer travel (px) below which a press is a click on a face,
// not the start of drawing a custom patch.
const DRAW_MIN_PX = 8

export default function Viewport() {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const initialized = useRef(false)
  const dragging = useRef(false)
  const prevObjects = useRef([])
  const prevSelected = useRef(null)
  const pendingMeshes = useRef(new Set())   // object ids waiting for their GLB
  const [modelTick, setModelTick] = useState(0)
  const [glError, setGlError] = useState(null)

  const objects = useSceneStore((s) => s.objects)
  const selectedId = useSceneStore((s) => s.selectedId)
  const secondaryId = useSceneStore((s) => s.secondaryId)
  const extraIds = useSceneStore((s) => s.extraIds)
  const extraFor = useSceneStore((s) => s.extraFor)
  const primaryLocked = useSceneStore((s) => !!s.objects.find((o) => o.id === s.selectedId)?.locked)
  const gridVisible = useSceneStore((s) => s.gridVisible)
  const axesVisible = useSceneStore((s) => s.axesVisible)
  const updateObject = useSceneStore((s) => s.updateObject)
  const selectObject = useSceneStore((s) => s.selectObject)
  const setSecondaryId = useSceneStore((s) => s.setSecondaryId)
  const clearSelection = useSceneStore((s) => s.clearSelection)
  const transformMode = useUiStore((s) => s.transformMode)

  const attachments   = useElectronicsStore((s) => s.attachments)
  const detachFromMotor = useElectronicsStore((s) => s.detachFromMotor)

  const surfaceToolActive = useUiStore((s) => s.surfaceToolActive)
  const extrudeToolActive = useUiStore((s) => s.extrudeToolActive)
  const sliceToolActive   = useUiStore((s) => s.sliceToolActive)
  const extrudeState      = useUiStore((s) => s.extrudeState)
  const simActive         = useUiStore((s) => s.simActive)
  const activePanel       = useUiStore((s) => s.activePanel)
  const patches           = useSurfaceStore((s) => s.patches)
  const selectedPatchIds  = useSurfaceStore((s) => s.selectedIds)
  const addPatch          = useSurfaceStore((s) => s.addPatch)
  const updatePatch       = useSurfaceStore((s) => s.updatePatch)
  const toggleSelectPatch = useSurfaceStore((s) => s.toggleSelectPatch)

  // Refs so callbacks always see latest values without re-creating handlers
  const surfaceToolRef    = useRef(false)
  const extrudeToolRef    = useRef(false)
  const extrudeStateRef   = useRef(null)
  const patchesRef        = useRef({})
  surfaceToolRef.current  = surfaceToolActive
  extrudeToolRef.current  = extrudeToolActive
  extrudeStateRef.current = extrudeState
  patchesRef.current      = patches

  const { snapshot } = useHistory()

  const [pickMode, setPickMode] = useState(null)         // objectId being picked, or null
  const pickModeRef = useRef(null)
  pickModeRef.current = pickMode
  // Left-button gesture on the canvas: { kind: 'part'|'empty', id?, x, y, shift, active }
  const gesture = useRef(null)
  const suppressClick = useRef(false)   // a drag/box just ended → the click that follows is not a selection
  const [marquee, setMarquee] = useState(null)   // { x0, y0, x1, y1 } in container px
  const patchDrawingRef = useRef(false)                   // true while drawing a new patch
  const patchDownRef    = useRef(null)                    // screen point where a surface press began

  // Feature-pick joint mode: { picks: [feat, ...] }  (null = inactive)
  const [jointPick, setJointPick] = useState(null)
  const jointPickRef = useRef(null)
  jointPickRef.current = jointPick

  // Enter joint-pick mode when the panel requests it
  useEffect(() => {
    const handler = () => setJointPick({ picks: [] })
    jointPickEvents.addEventListener('start', handler)
    return () => jointPickEvents.removeEventListener('start', handler)
  }, [])

  // Esc cancels joint-pick mode
  useEffect(() => {
    if (!jointPick) return
    const onKey = (e) => { if (e.key === 'Escape') setJointPick(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jointPick])

  // Listen for "start attachment-point pick" events from PropertiesPanel
  useEffect(() => {
    const handler = (e) => setPickMode(e.detail.id)
    attachPointEvents.addEventListener('startPick', handler)
    return () => attachPointEvents.removeEventListener('startPick', handler)
  }, [])

  // Sync patch store → Three.js objects; hide patches when surface tool is inactive
  useEffect(() => {
    if (!initialized.current) return
    patchManager.sync(patches, selectedPatchIds)
    patchManager.setVisible(surfaceToolActive)
  }, [patches, selectedPatchIds, surfaceToolActive])

  // Clear extrude hover preview when extrude mode is turned off
  useEffect(() => {
    if (!initialized.current) return
    if (!extrudeToolActive) patchManager.clearExtrudeHover()
  }, [extrudeToolActive])

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
    try {
      sceneManager.init(canvasRef.current, width, height)
    } catch (e) {
      // No WebGL (disabled/blocked/unsupported GPU): explain instead of a blank page.
      console.error('[Viewport] WebGL unavailable:', e)
      setGlError(e?.message || 'WebGL could not be started')
      return
    }
    patchManager.init(sceneManager.scene, sceneManager.camera, objectManager)
    driveManager.init(sceneManager.scene, objectManager)
    alignmentManager.init(sceneManager.scene, sceneManager.camera, sceneManager.renderer)
    handlesManager.init()
    handlesRef.current = (e, bounds) => handlesManager.pointerDown(e, bounds)
    initialized.current = true

    sceneManager.onTransformChange = () => {
      const tc = sceneManager.transformControls
      const mesh = tc?.object
      if (!mesh) return

      // ── Smart alignment snap (translate only) ─────────────────────────────
      // Magnetically nudge mesh.position into alignment with nearby objects
      // BEFORE we read it below, so the store / bonds / history see the snapped
      // value — exactly how the built-in grid snap already works. Rotate & scale
      // are untouched (guarded by transformMode).
      const ui = useUiStore.getState()
      if (ui.transformMode === 'translate' && ui.smartGuides && !ui.simActive) {
        alignmentManager.update(mesh, { object: ui.snapObject, surface: ui.snapSurface, axis: tc?.axis })
      }

      const id = mesh.userData.id
      updateObject(id, {
        position: vec3FromObject(mesh.position),
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
        scale: vec3FromObject(mesh.scale),
      })

      // Propagate rigid bonds — when moving the parent, drag the child with it.
      // Do NOT reverse-propagate when a bond-child is dragged directly; its
      // relativeMatrix is updated in onDraggingChanged after the drag ends.
      // Rigid bonds move as ONE welded unit — grabbing either part moves both.
      const allBonds = useRigidStore.getState().getBonds()

      // Forward: dragging a parent drags its children (and their children).
      for (const bond of allBonds) {
        if (bond.parentId !== id) continue
        const result = objectManager.propagateBond(id, bond.relativeMatrix, true, bond.childId)
        if (result) updateObject(bond.childId, result)
      }

      // Reverse: dragging a child drags its parent up the chain, so the whole
      // bonded group follows. parentWorld = childWorld · relativeMatrix⁻¹.
      mesh.updateMatrixWorld(true)
      let curId = id
      let curWorld = mesh.matrixWorld.clone()
      const seen = new Set([id])
      for (let i = 0; i < 32; i++) {
        const cb = allBonds.find(b => b.childId === curId && !seen.has(b.parentId))
        if (!cb) break
        const parentMesh = objectManager.getMesh(cb.parentId)
        if (!parentMesh) break
        const relInv = new THREE.Matrix4().fromArray(cb.relativeMatrix).invert()
        const parentWorld = curWorld.clone().multiply(relInv)
        const pPos = new THREE.Vector3(), pQuat = new THREE.Quaternion(), pScl = new THREE.Vector3()
        parentWorld.decompose(pPos, pQuat, pScl)
        const pe = new THREE.Euler().setFromQuaternion(pQuat)
        updateObject(cb.parentId, { position: { x: pPos.x, y: pPos.y, z: pPos.z }, rotation: { x: pe.x, y: pe.y, z: pe.z } })
        parentMesh.position.copy(pPos); parentMesh.quaternion.copy(pQuat); parentMesh.updateMatrixWorld(true)
        // Forward-propagate from this parent to ITS other children (the dragged
        // child's siblings) so they move too, this same frame.
        for (const sib of allBonds) {
          if (sib.parentId !== cb.parentId || sib.childId === curId) continue
          const r = objectManager.propagateBond(cb.parentId, sib.relativeMatrix, true, sib.childId)
          if (r) updateObject(sib.childId, r)
        }
        seen.add(cb.parentId)
        curId = cb.parentId
        curWorld = parentWorld
      }
    }

    sceneManager.onDraggingChanged = (isDragging) => {
      dragging.current = isDragging
      if (isDragging) {
        // ── Smart-guide drag start: cache other objects' AABBs for alignment ──
        const ui = useUiStore.getState()
        const startMesh = sceneManager.transformControls?.object
        if (startMesh && ui.transformMode === 'translate' && ui.smartGuides && !ui.simActive) {
          const others = objectManager.getAllMeshes().filter(m =>
            m !== startMesh && !m.userData.isWire && m.userData.type !== 'plane')
          alignmentManager.beginDrag(startMesh, others)
        }
        return    // drag just started — preview only, no history yet
      }

      // Drag released — fade the guides out.
      alignmentManager.endDrag()

      // ── Drag just ended → commit ONE undo step for the whole move/rotate/scale ──
      const tc = sceneManager.transformControls
      const mesh = tc?.object
      const objectId = mesh ? objectManager.resolveId(mesh) : null
      const movedObj = objectId ? useSceneStore.getState().objects.find(o => o.id === objectId) : null

      // If the dragged object is a bond-child, refresh its relativeMatrix BEFORE
      // recording so the snapshot captures the bond update too.
      if (objectId && movedObj) {
        const allBonds = useRigidStore.getState().getBonds()
        for (const bond of allBonds) {
          if (bond.childId === objectId) {
            const newRel = objectManager.computeChildRelativeMatrix(bond.parentId, movedObj.position, movedObj.rotation)
            if (newRel) useRigidStore.getState().updateBond(bond.id, { relativeMatrix: newRel })
            break
          }
        }
      }

      // One canonical history entry for the entire drag. Captures the full document
      // (objects + attachments + bonds + patches + joints) — fixes the old bug where
      // a bare objects-array was pushed and undoing a drag wiped the whole scene.
      recordSnapshot('transform')

      // Attaching to a motor shaft is an intentional action now (Design → Edit →
      // Attach); a drag no longer pops up an attach / keep-separate prompt.
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
    // Tinkercad mouse buttons. OrbitControls reads them on pointerdown (which
    // fires before mousedown), so map them in a capture-phase pointerdown.
    applyMouseMapping({ altKey: false, shiftKey: false })
    const mapButtons = (e) => applyMouseMapping(e)
    canvas.addEventListener('pointerdown', mapButtons, { capture: true })
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
      canvas.removeEventListener('pointerdown', mapButtons, { capture: true })
      canvas.removeEventListener('mousedown', captureDown, { capture: true })
      canvas.removeEventListener('mousemove', captureMove, { capture: true })
      alignmentManager.dispose()
      handlesManager.dispose()
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
        if (['motor', 'motor_bo', 'motor_dc', 'motor_enc', 'servo_cr', 'stepper'].includes(prevObj.type)) {
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

    // Only objects whose data changed need a mesh update — plus the previous and
    // new selection (outline). Updating every object on every change re-traversed
    // and re-flagged every material in the scene on each edit/selection.
    const selChanged = prevSelected.current !== selectedId
    for (const [id, obj] of curr) {
      if (!prev.has(id)) {
        // Built-in models load on demand. If one isn't ready yet (a path that
        // didn't pre-load it), create the mesh as soon as it arrives instead of
        // falling back to a placeholder.
        const missing = modelKeysFor([obj]).find(k => !isModelLoaded(k))
        if (missing) {
          pendingMeshes.current.add(id)
          loadModel(missing).then(() => setModelTick(t => t + 1))
          continue
        }
        objectManager.createMesh(obj)
      } else if (prev.get(id) !== obj || (selChanged && (id === selectedId || id === prevSelected.current))) {
        objectManager.updateMesh(id, obj)
      }
    }

    prevObjects.current = objects
    prevSelected.current = selectedId
  }, [objects, selectedId])

  // Create meshes that were waiting for their model to load.
  useEffect(() => {
    if (!initialized.current || pendingMeshes.current.size === 0) return
    const byId = new Map(useSceneStore.getState().objects.map(o => [o.id, o]))
    for (const id of [...pendingMeshes.current]) {
      const obj = byId.get(id)
      if (!obj) { pendingMeshes.current.delete(id); continue }
      if (modelKeysFor([obj]).some(k => !isModelLoaded(k))) continue
      pendingMeshes.current.delete(id)
      if (!objectManager.getMesh(id)) objectManager.createMesh(obj)
    }
    sceneManager.requestRender?.()
  }, [modelTick])

  // Keep objectManager mesh hierarchy in sync with the attachments store.
  // Runs AFTER the objects effect (declaration order) so all meshes exist first.
  //   • attach: store has entry, objectManager doesn't → re-parent into rotorGroup
  //   • detach: objectManager has entry, store doesn't → restore to scene (undo of attach)
  useEffect(() => {
    if (!initialized.current) return
    let cancelled = false

    // Restore attachments. Prefer the exact saved local transform (obj.attach);
    // fall back to preserving the current world transform. A motor whose mesh
    // isn't ready yet (GLB still loading) makes reattach fail → retry shortly so
    // the wheels never end up detached ("flying").
    const applyAttachments = (tries = 0) => {
      if (cancelled || !initialized.current) return
      let pending = false
      for (const [objectId, motorId] of Object.entries(attachments)) {
        if (objectManager.attachedObjects.has(objectId)) continue
        const def = objects.find(o => o.id === objectId)
        const ok = def?.attach
          ? objectManager.reattachLocal(objectId, motorId, def.attach)
          : objectManager.reattachAtWorld(objectId, motorId)
        if (!ok) pending = true
      }
      if (pending && tries < 20) setTimeout(() => applyAttachments(tries + 1), 150)
    }
    applyAttachments()

    for (const [objectId] of objectManager.attachedObjects) {
      if (!attachments[objectId]) {
        objectManager.detachMeshFromRotor(objectId)
      }
    }
    return () => { cancelled = true }
  }, [objects, attachments, modelTick])

  // Sync selection → TransformControls + highlights
  useEffect(() => {
    if (!initialized.current) return
    // Disable transform gizmo during simulation — objects are grouped under rootGroup
    if (simActive) {
      sceneManager.detachTransform()
      handlesManager.setTarget(null)
      objectManager.setSelectionHighlights(null, null)   // no selection outlines on a running robot
      return
    }
    // The arrows go on ONE part: not on parts riding a motor rotor, not on a
    // locked part, not while several parts are selected (drag those on the grid)
    // and not in Tinkercad-handles mode (the handles replace them).
    const extras = extraFor && extraFor === selectedId ? extraIds : []
    if (selectedId && !attachments[selectedId] && !primaryLocked && !secondaryId && transformMode !== 'handles') {
      const mesh = objectManager.getMesh(selectedId)
      sceneManager.attachTransformTo(mesh || null)
    } else {
      sceneManager.detachTransform()
    }
    objectManager.setSelectionHighlights(selectedId, secondaryId, extras)
    const showHandles = selectedId && !secondaryId && !attachments[selectedId] && !primaryLocked && transformMode === 'handles'
    handlesManager.setTarget(showHandles ? selectedId : null)
  }, [selectedId, secondaryId, extraIds, extraFor, attachments, simActive, transformMode, primaryLocked])

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
    const ELEC = ['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led']
    const mode = (selObj && ELEC.includes(selObj.type) && transformMode === 'scale')
      ? 'translate'
      : transformMode
    if (mode !== 'handles') sceneManager.setTransformMode(mode)   // handles mode has no gizmo
  }, [transformMode, selectedId, objects])


  const [wireDragging, setWireDragging] = useState(false)
  const rightDown = useRef(null)        // where a right-press started (orbit vs. right-click)
  const handlesRef = useRef(null)       // (e, bounds) → true when a Tinkercad handle took the press
  const placing = usePlacement((s) => s.pending)
  const handleLabel = useHandleDrag((s) => s.label)
  const downAt = useRef(null)   // mouse-down position: a click that moved is an orbit, not a placement

  const handleMouseDown = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    downAt.current = { x: e.clientX, y: e.clientY }
    if (e.button === 2) rightDown.current = { x: e.clientX, y: e.clientY }
    if (usePlacement.getState().pending) return   // placing: orbit still works, nothing else starts

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
          patchDownRef.current = { x: e.clientX, y: e.clientY }
          patchDrawingRef.current = true
          if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = false
        }
      }
      return
    }

    const consumed = wireManager.onMouseDown(e, bounds)
    if (consumed) { setWireDragging(true); return }

    // ── Tinkercad direct manipulation: left-drag a part slides it on the grid,
    //    left-drag on empty space draws a selection box. Not in tool modes, not
    //    while simulating, and not when the press lands on the gizmo / a handle.
    const ui = useUiStore.getState()
    if (e.button !== 0 || e.altKey || ui.simActive || extrudeToolRef.current || ui.sliceToolActive || jointPickRef.current || pickModeRef.current) return
    if (sceneManager.transformControls?.axis) return          // pressing the move/rotate/scale gizmo
    if (handlesRef.current?.(e, bounds)) return                // pressing a Tinkercad handle
    const hit = sceneManager.pickObject(e, bounds)
    gesture.current = { kind: hit ? 'part' : 'empty', id: hit?.userData.id, x: e.clientX, y: e.clientY, shift: e.shiftKey, active: false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseMove = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()

    // Placing a part: the marker follows the mouse over the workplane.
    if (usePlacement.getState().pending) { showMarkerAt(groundPointFromEvent(e, bounds)); return }

    // Tinkercad handles: an active handle drag owns the mouse; otherwise hover-highlight.
    if (handlesManager.active) { handlesManager.pointerMove(e, bounds); return }
    if (!gesture.current) handlesManager.pointerMove(e, bounds)

    const g = gesture.current
    if (g) {
      if (!g.active && Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD_PX) {
        g.active = g.kind === 'part' ? beginSlide({ clientX: g.x, clientY: g.y }, bounds, g.id) : true
        if (!g.active) { gesture.current = null; suppressClick.current = true }   // e.g. a locked part: no move, and no stray re-select on release
      }
      if (g.active && g.kind === 'part') { updateSlide(e, bounds); return }
      if (g.active && g.kind === 'empty') {
        const c = containerRef.current.getBoundingClientRect()
        setMarquee({ x0: Math.min(g.x, e.clientX) - c.left, y0: Math.min(g.y, e.clientY) - c.top, x1: Math.max(g.x, e.clientX) - c.left, y1: Math.max(g.y, e.clientY) - c.top })
        return
      }
    }

    if (surfaceToolRef.current) {
      if (patchManager.isDrawing) patchManager.updateDraw(e, bounds)
      if (patchManager.isDragging) {
        const result = patchManager.updateInteract(e, bounds)
        if (result) useSurfaceStore.getState().updatePatch(result.id, result.updates)
      }
      return
    }

    // Extrude mode: show teal face highlight under cursor (only before an extrusion is placed)
    if (extrudeToolRef.current) {
      if (!extrudeStateRef.current) patchManager.showExtrudeHover(e, bounds)
      return
    }

    wireManager.onMouseMove(e, bounds)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseUp = useCallback((e) => {
    if (!initialized.current) return
    const bounds = canvasRef.current.getBoundingClientRect()

    if (surfaceToolRef.current) {
      if (patchManager.isDrawing) {
        // A click always wobbles a few pixels — only a real drag draws a custom
        // patch. Anything shorter is a click: the click handler then selects
        // the whole face (before, a 2 px wobble made an unselected patch and the
        // Connect Surfaces prompt never appeared).
        const d = patchDownRef.current
        const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : Infinity
        const patch = moved >= DRAW_MIN_PX ? patchManager.endDraw(e, bounds) : (patchManager.cancelDraw(), null)
        if (patch) {
          const store = useSurfaceStore.getState()
          store.addPatch(patch)
          store.toggleSelectPatch(patch.id)   // a drawn patch is selected, like a clicked face
          snapshot()
          // Keep patchDrawingRef = true so the click event (which fires after mouseup)
          // sees it and skips creating an extra face patch. Click handler clears it.
          patchDrawingRef.current = true
        } else {
          // Very small movement — treat as a click, allow face patch creation
          patchDrawingRef.current = false
        }
      }
      if (patchManager.isDragging) patchManager.endInteract()
      if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
      return
    }

    if (handlesManager.pointerUp()) { suppressClick.current = true; gesture.current = null; return }

    const g = gesture.current
    gesture.current = null
    if (g?.active) {
      suppressClick.current = true
      if (g.kind === 'part') endSlide()
      else {
        const r = { x0: Math.min(g.x, e.clientX), y0: Math.min(g.y, e.clientY), x1: Math.max(g.x, e.clientX), y1: Math.max(g.y, e.clientY) }
        boxSelect(r, bounds, g.shift)
        setMarquee(null)
      }
      return
    }

    wireManager.onMouseUp(e, bounds)
    if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
    setWireDragging(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseLeave = useCallback(() => {
    hideMarker()
    if (gesture.current?.active) { if (isSliding()) endSlide(); setMarquee(null) }
    handlesManager.pointerUp()
    gesture.current = null
    if (wireManager.isDragging) {
      wireManager.cancelDrag()
      if (sceneManager.orbitControls) sceneManager.orbitControls.enabled = true
      setWireDragging(false)
    }
  }, [])

  const handleContextMenu = useCallback((e) => {
    if (!initialized.current) return
    if (rightDown.current && Math.hypot(e.clientX - rightDown.current.x, e.clientY - rightDown.current.y) > DRAG_THRESHOLD_PX) { e.preventDefault(); return }
    const bounds = canvasRef.current.getBoundingClientRect()
    wireManager.onContextMenu(e, bounds)
  }, [])

  const insertObject = useSceneStore((s) => s.insertObject)
  const [dropHighlight, setDropHighlight] = useState(false)

  const handleViewportDrop = useCallback(async (e) => {
    e.preventDefault()
    setDropHighlight(false)
    // A library card dragged onto the view: drop the part where it was released.
    if (usePlacement.getState().pending && !e.dataTransfer.files?.length) {
      placeAt(groundPointFromEvent(e, canvasRef.current.getBoundingClientRect()))
      return
    }
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      const ext  = file.name.split('.').pop().toLowerCase()
      const name = file.name.replace(/\.[^.]+$/, '')
      let geometry = null
      try {
        if (['glb', 'gltf'].includes(ext)) geometry = await loadGLTFFromFile(file)
        else if (ext === 'stl')            geometry = await loadSTLFromFile(file)
        else continue
      } catch (err) { console.error('Import failed:', err); continue }
      if (!geometry) continue
      const objId = uuidv4()
      storeImportedGeometry(objId, geometry)
      const geometryJSON = geometry.isBufferGeometry ? geometry.toJSON() : null
      insertObject({
        id: objId, name, type: 'model',
        geometryJSON,
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale:    { x: 1, y: 1, z: 1 },
        color: '#a8c8e8', material: 'standard', visible: true,
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      })
      snapshot()
    }
  }, [insertObject, snapshot])

  const handleClick = useCallback(
    (e) => {
      if (suppressClick.current) { suppressClick.current = false; return }
      if (!initialized.current || dragging.current) return
      if (wireManager.isDragging) return
      const bounds = canvasRef.current.getBoundingClientRect()

      // ── Placing a part: a click on the grid puts it there (Shift = keep placing) ──
      if (usePlacement.getState().pending) {
        const d = downAt.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return   // that was an orbit drag
        placeAt(groundPointFromEvent(e, bounds), e.shiftKey)
        hideMarker()
        return
      }

      // ── Joint feature-pick mode: pick a corner/edge/face on each object ───
      if (jointPickRef.current) {
        const feat = sceneManager.pickFeature(e, bounds)
        if (!feat) return
        const picks = jointPickRef.current.picks
        if (picks.length === 0) {
          setJointPick({ picks: [feat] })
        } else {
          // Second pick must be a different object
          if (feat.objectId === picks[0].objectId) return
          const id = jointManager.createFeatureJoint(picks[0], feat)
          if (id) { useUiStore.getState().setActivePanel('joints'); snapshot() }
          setJointPick(null)
        }
        return
      }

      // ── Extrude tool: click a face to spawn the extrusion box ────────────
      if (extrudeToolRef.current && !extrudeStateRef.current) {
        patchManager.clearExtrudeHover()
        const faceInfo = patchManager.getFaceInfo(e, bounds)
        if (faceInfo) {
          const { objectId, faceNormal, faceTangent, faceBitangent, faceCenterWorld, faceWidth, faceHeight } = faceInfo
          const depth = 1.0
          const center = faceCenterWorld.clone().addScaledVector(faceNormal, depth / 2)

          // Align box: local X → face tangent, local Y → face bitangent, local Z → face normal
          const rotM  = new THREE.Matrix4().makeBasis(faceTangent, faceBitangent, faceNormal)
          const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(rotM), 'XYZ')

          const sourceObj = useSceneStore.getState().objects.find(o => o.id === objectId)
          const extId     = uuidv4()
          const extCount  = useSceneStore.getState().objects.filter(o => o.name?.startsWith('Extrude_')).length

          useSceneStore.getState().insertObject({
            id:       extId,
            name:     `Extrude_${extCount + 1}`,
            type:     'box',
            position: { x: center.x, y: center.y, z: center.z },
            rotation: { x: euler.x,  y: euler.y,  z: euler.z  },
            // BoxGeometry is 2×2×2 at scale=1, so scale = size/2
            scale:    { x: faceWidth / 2, y: faceHeight / 2, z: depth / 2 },
            color:    sourceObj?.color ?? '#ff9800',
            material: 'standard',
            visible:  true,
            metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          })
          useUiStore.getState().setExtrudeState({
            sourceObjectId:  objectId,
            extrudeObjectId: extId,
            faceCenterWorld: { x: faceCenterWorld.x, y: faceCenterWorld.y, z: faceCenterWorld.z },
            faceNormalWorld:  { x: faceNormal.x,      y: faceNormal.y,      z: faceNormal.z      },
          })
          useSceneStore.getState().selectObject(extId)
          snapshot()
        }
        return
      }

      // ── Surface tool: click a face to create+select a patch instantly ────
      if (surfaceToolRef.current) {
        if (patchDrawingRef.current) { patchDrawingRef.current = false; return }

        // Did they click an existing patch? Toggle its selection.
        const existingHit = patchManager.pick(e, bounds)
        if (existingHit) {
          useSurfaceStore.getState().toggleSelectPatch(existingHit.patchId)
          return
        }

        // Otherwise auto-detect the entire face and select a full-size patch for
        // it. addOrSelectPatch (not addPatch) because pick() above can miss a
        // patch that already covers this face — creating a second one there left
        // both selections on one object, which can never be attached, so the
        // Connect prompt just never showed up.
        const patch = patchManager.buildFacePatch(e, bounds)
        if (patch) {
          useSurfaceStore.getState().addOrSelectPatch(patch)
          snapshot()
        }
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

      // Shift+click adds a part to the selection (or takes it out again).
      if (e.shiftKey) {
        if (hit) useSceneStore.getState().toggleSelect(hit.userData.id)
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
  // Both objects must be solid/electronics shapes for a Boolean — a wheel, sensor,
  // etc. can't be combined, so don't promise a panel that won't appear.
  const bothBooleanReady = !!(
    hasBothSelected &&
    isBooleanCandidate(objects.find((o) => o.id === selectedId)) &&
    isBooleanCandidate(objects.find((o) => o.id === secondaryId))
  )

  return (
    <div
      ref={containerRef}
      data-tour="viewport"
      className="relative flex-1 overflow-hidden bg-white"
      onDragOver={(e) => {
        e.preventDefault()
        if (usePlacement.getState().pending) { showMarkerAt(groundPointFromEvent(e, canvasRef.current.getBoundingClientRect())); return }
        setDropHighlight(true)
      }}
      onDragLeave={() => { setDropHighlight(false); hideMarker() }}
      onDrop={handleViewportDrop}
    >
      {glError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgb(var(--g-950))' }}>
          <div className="max-w-md text-sm leading-relaxed" style={{ color: 'rgb(var(--g-200))' }}>
            <div className="text-base font-semibold mb-2" style={{ color: 'rgb(var(--g-100))' }}>3D view unavailable</div>
            Constructa needs WebGL to draw the 3D workspace, and this browser couldn't start it.
            Try enabling hardware acceleration in your browser settings, updating your graphics
            driver, or using a current Chrome, Edge, Firefox or Safari. Code, wiring and your
            saved projects still work.
          </div>
        </div>
      )}
      {dropHighlight && (
        <div className="absolute inset-0 z-30 pointer-events-none border-4 border-indigo-400/80 rounded-sm">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-gray-900/90 text-indigo-300 text-sm font-medium px-5 py-3 rounded-xl shadow-2xl">
              📥 Drop GLB / GLTF / STL to import
            </div>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${
          placing || surfaceToolActive || extrudeToolActive || jointPick ? 'cursor-crosshair' : pickMode ? 'cursor-cell' : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
      />

      {/* Slice tool — editable cut-line overlay */}
      {sliceToolActive && <SlicePolylineOverlay containerRef={containerRef} />}

      {marquee && (
        <div className="absolute z-20 pointer-events-none rounded-sm"
          style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0,
            border: '1px solid rgb(var(--a-600))', background: 'rgb(var(--a-600) / 0.08)' }} />
      )}

      {/* Mode hints — one quiet toast at the bottom centre, so they never sit
          on top of the toolbar or the view cube. At most one shows at a time,
          in priority order; tool modes carry their own Done / Cancel. */}
      {(() => {
        const ui = useUiStore.getState()
        const hint =
            handleLabel ? { text: handleLabel }
          : placing ? { text: `Click the grid to place the ${placing.label}. Hold Shift to place more.`,
                        actions: [
                          { label: 'Put in the middle', onClick: () => placeAt(viewCenterPoint()) },
                          { label: 'Cancel', onClick: cancelPlacement },
                        ] }
          : surfaceToolActive ? { text: 'Attach: click a face on the first part, then a face on the second. Hold and drag to draw your own patch.', action: 'Done', onAction: () => ui.setSurfaceTool(false) }
          : jointPick         ? { text: jointPick.picks.length === 0 ? 'Click a corner, edge or face on the first part.' : 'Now click a corner, edge or face on the second part.', action: 'Cancel', onAction: () => setJointPick(null) }
          : pickMode          ? { text: 'Click the exact spot where the motor shaft should connect.', action: 'Cancel', onAction: () => setPickMode(null) }
          : extrudeToolActive && !extrudeState ? { text: 'Extrude: click a face to pull it outward.', action: 'Done', onAction: () => ui.setExtrudeTool(false) }
          : wireDragging      ? { text: 'Drop on a pin to connect. Esc cancels.' }
          : hasBothSelected && bothBooleanReady  ? { text: 'Group joins the selected shapes into one. Set a shape to Hole first to cut it out instead.', action: 'Group', onAction: () => edit.groupSelection() }
          : null
        if (!hint) return null
        return (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none max-w-[min(560px,90%)]">
            <div className="flex items-center gap-3 pl-4 pr-1.5 py-1.5 rounded-lg text-[12px] text-white"
              style={{ background: 'rgba(31,41,55,0.94)', boxShadow: '0 6px 20px rgba(0,0,0,0.18)', minHeight: 36 }}>
              <span className="leading-snug">{hint.text}</span>
              {(hint.actions ?? (hint.action ? [{ label: hint.action, onClick: hint.onAction }] : [])).map((a) => (
                <button key={a.label} className="pointer-events-auto shrink-0 h-7 px-3 rounded-md text-[12px] font-semibold bg-white/10 hover:bg-white/20" onClick={a.onClick}>{a.label}</button>
              ))}
              {!hint.actions && !hint.action && <span className="w-2" />}
            </div>
          </div>
        )
      })()}

      {/* Empty-scene guidance — purely visual, never blocks canvas input */}
      {objects.length === 0 && !simActive && !placing && !surfaceToolActive && !extrudeToolActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          {/* Drawn on the always-white 3D canvas → fixed colours (not the
              theme ramp) so they stay readable in both light and dark mode. */}
          <div className="text-center text-[13px] leading-relaxed text-[#6B7280] max-w-xs px-6">
            Add a shape or a part from the panel on the right to start building.
          </div>
        </div>
      )}

      {/* Floating glass toolbox (top-left) — replaces the old docked left sidebar.
          Always mounted so the Simulate/Stop control (and its tutorial anchor)
          stays reachable during simulation. */}
      <ViewportToolbox />
      {!WORKSPACE_PANELS.has(activePanel) && <EditBar />}
      {!WORKSPACE_PANELS.has(activePanel) && <ViewControls />}

      {/* Interactive view cube + quick-view switcher (top-right corner) */}
      {!simActive && !WORKSPACE_PANELS.has(activePanel) && <ViewGizmo />}

      {/* Selection inspector (Tinkercad-style shape card) under the view cube */}
      {!WORKSPACE_PANELS.has(activePanel) && <SelectionInspector />}

      <DimensionOverlay />
      <SurfaceAttachPrompt />
      <ExtrudePanel />

      {simActive && <DrivePanel />}

      {!simActive && (
        <div className="absolute bottom-2 left-3 text-[11px] text-[#9CA3AF] pointer-events-none select-none">
          Drag a part to move it · Drag empty space to select · Right-drag to orbit · Middle-drag to pan · Scroll to zoom
        </div>
      )}
    </div>
  )
}
