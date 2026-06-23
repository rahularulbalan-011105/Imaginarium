import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { sceneManager } from '../managers/SceneManager.js'
import { objectManager } from '../managers/ObjectManager.js'
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
import { jointPickEvents } from './JointPanel.jsx'
import { jointManager } from '../managers/JointManager.js'
import DimensionOverlay from './DimensionOverlay.jsx'
import SurfaceAttachPrompt from './SurfaceAttachPrompt.jsx'
import ExtrudePanel from './ExtrudePanel.jsx'
import ViewGizmo from './ViewGizmo.jsx'
import DrivePanel from './DrivePanel.jsx'
import { useHistory } from '../hooks/useHistory.js'
import { driveManager } from '../managers/DriveManager.js'
import { loadGLTFFromFile, loadSTLFromFile } from '../utils/modelLoader.js'
import { storeImportedGeometry } from '../managers/ObjectManager.js'
import { v4 as uuidv4 } from 'uuid'

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

  const surfaceToolActive = useUiStore((s) => s.surfaceToolActive)
  const extrudeToolActive = useUiStore((s) => s.extrudeToolActive)
  const extrudeState      = useUiStore((s) => s.extrudeState)
  const simActive         = useUiStore((s) => s.simActive)
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

  const [attachPrompt, setAttachPrompt] = useState(null) // { objectId, motorId, motorName }
  const [pickMode, setPickMode] = useState(null)         // objectId being picked, or null
  const patchDrawingRef = useRef(false)                   // true while drawing a new patch

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
      if (isDragging) return    // drag just started — preview only, no history yet

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

      // Offer to attach to a nearby motor shaft (no state mutation here).
      if (objectId && movedObj) {
        const isElectronics = movedObj.type === 'motor' || movedObj.type === 'motor_bo' || movedObj.type === 'motor_dc' || movedObj.type === 'arduino' || movedObj.type === 'subo' || movedObj.type === 'led'
        const alreadyAttached = objectManager.attachedObjects.has(objectId)
        if (!isElectronics && !alreadyAttached) {
          const nearMotorId = objectManager.findNearbyMotorShaft(objectId)
          if (nearMotorId) {
            const motor = useSceneStore.getState().objects.find(o => o.id === nearMotorId)
            setAttachPrompt({ objectId, motorId: nearMotorId, motorName: motor?.name ?? 'Motor' })
          }
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
  }, [objects, attachments])

  // Sync selection → TransformControls + highlights
  useEffect(() => {
    if (!initialized.current) return
    // Disable transform gizmo during simulation — objects are grouped under rootGroup
    if (simActive) {
      sceneManager.detachTransform()
      return
    }
    // Don't attach transform gizmo to objects riding a motor rotor
    if (selectedId && !attachments[selectedId]) {
      const mesh = objectManager.getMesh(selectedId)
      sceneManager.attachTransformTo(mesh || null)
    } else {
      sceneManager.detachTransform()
    }
    objectManager.setSelectionHighlights(selectedId, secondaryId)
  }, [selectedId, secondaryId, attachments, simActive])

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
        const patch = patchManager.endDraw(e, bounds)
        if (patch) {
          useSurfaceStore.getState().addPatch(patch)
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

  const insertObject = useSceneStore((s) => s.insertObject)
  const [dropHighlight, setDropHighlight] = useState(false)

  const handleViewportDrop = useCallback(async (e) => {
    e.preventDefault()
    setDropHighlight(false)
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
      if (!initialized.current || dragging.current) return
      if (wireManager.isDragging) return
      const bounds = canvasRef.current.getBoundingClientRect()

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

        // Otherwise auto-detect the entire face and create a full-size patch
        const patch = patchManager.buildFacePatch(e, bounds)
        if (patch) {
          const store = useSurfaceStore.getState()
          store.addPatch(patch)
          store.toggleSelectPatch(patch.id)
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
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-white"
      onDragOver={(e) => { e.preventDefault(); setDropHighlight(true) }}
      onDragLeave={() => setDropHighlight(false)}
      onDrop={handleViewportDrop}
    >
      {dropHighlight && (
        <div className="absolute inset-0 z-30 pointer-events-none border-4 border-amber-400/80 rounded-sm">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-gray-900/90 text-amber-300 text-sm font-medium px-5 py-3 rounded-xl shadow-2xl">
              📥 Drop GLB / GLTF / STL to import
            </div>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${
          surfaceToolActive || extrudeToolActive || jointPick ? 'cursor-crosshair' : pickMode ? 'cursor-cell' : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
      />

      {/* Face attach mode overlay */}
      {surfaceToolActive && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="flex items-center gap-2 bg-cyan-900/90 border border-cyan-500/70 text-cyan-200 text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            <span className="text-base">⊞</span>
            Click a face on Object 1, then click a face on Object 2 — or hold &amp; drag to draw a custom patch
            <button
              className="pointer-events-auto ml-2 text-cyan-400 hover:text-white transition-colors"
              onClick={() => useUiStore.getState().setSurfaceTool(false)}
            >
              ✕ Exit
            </button>
          </div>
        </div>
      )}

      {/* Joint feature-pick mode overlay */}
      {jointPick && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="flex items-center gap-2 bg-teal-900/90 border border-teal-500/70 text-teal-100 text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            <span className="text-base">🎯</span>
            {jointPick.picks.length === 0
              ? 'Click a corner, edge, or face on the FIRST object'
              : 'Now click a corner, edge, or face on the SECOND object'}
            <button
              className="pointer-events-auto ml-2 text-teal-400 hover:text-white transition-colors"
              onClick={() => setJointPick(null)}
            >
              ✕ Cancel
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
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-600/90 border border-amber-400 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none select-none shadow-md">
          Shift+click another object to enable Boolean operations
        </div>
      )}

      {/* Boolean ops active indicator */}
      {hasBothSelected && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-purple-700/90 border border-purple-400 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none select-none shadow-md">
          2 objects selected — use the Boolean panel on the right
        </div>
      )}

      {/* Extrude mode hint */}
      {extrudeToolActive && !extrudeState && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="flex items-center gap-2 bg-purple-900/90 border border-purple-500/70 text-purple-200 text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            <span className="text-base">⬆</span>
            Click any face to extrude it outward
            <button
              className="pointer-events-auto ml-2 text-purple-400 hover:text-white transition-colors"
              onClick={() => useUiStore.getState().setExtrudeTool(false)}
            >
              ✕ Exit
            </button>
          </div>
        </div>
      )}

      {/* View indicator + quick-view switcher (top-right corner) */}
      {!simActive && <ViewGizmo />}

      <DimensionOverlay />
      <SurfaceAttachPrompt />
      <ExtrudePanel />

      {simActive && <DrivePanel />}

      {!simActive && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-500 pointer-events-none select-none bg-white/60 px-2 py-0.5 rounded-full">
          Click to select · Shift+click 2nd object for booleans · Scroll to zoom · Middle-drag to orbit
        </div>
      )}
    </div>
  )
}
