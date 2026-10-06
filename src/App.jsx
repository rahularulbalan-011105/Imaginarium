import { useEffect, useRef, useState, useCallback } from 'react'

import Header from './components/Header.jsx'
import Viewport from './components/Viewport.jsx'
import StatusBar from './components/StatusBar.jsx'
import { isBooleanCandidate } from './components/BooleanPanel.jsx'
import NavRail from './components/shell/NavRail.jsx'
import ContextPanel from './components/shell/ContextPanel.jsx'
import CenterWorkspace from './components/shell/CenterWorkspace.jsx'
import WelcomeOverlay from './components/WelcomeOverlay.jsx'
import ConstructaLogo from './components/ConstructaLogo.jsx'
import EmailCapture from './components/EmailCapture.jsx'
import ProductTour from './components/onboarding/ProductTour.jsx'
import GuidedCoach from './components/onboarding/GuidedCoach.jsx'
import CloudSaveBar from './components/CloudSaveBar.jsx'
import { initCloudSync } from './managers/CloudProjectManager.js'
import KeyboardShortcutsModal from './components/onboarding/KeyboardShortcutsModal.jsx'
import BeginnerGuideModal from './components/onboarding/BeginnerGuideModal.jsx'
import OverlayBridge from './components/OverlayBridge.jsx'
import { useSceneStore } from './stores/sceneStore.js'
import { useUiStore } from './stores/uiStore.js'
import { useElectronicsStore } from './stores/electronicsStore.js'
import { useRigidStore } from './stores/rigidStore.js'
import { useSurfaceStore } from './stores/surfaceStore.js'
import { useGearStore } from './stores/gearStore.js'
import { useJointStore } from './stores/jointStore.js'
import { usePhysicsStore } from './stores/physicsStore.js'
import { useRobotStore } from './stores/robotStore.js'
import { useHistory } from './hooks/useHistory.js'
import { resetBaseline } from './managers/history/editorDispatch.js'
import { jointManager } from './managers/JointManager.js'
import { useGameStore } from './stores/gameStore.js'
import { useCombatStore } from './stores/combatStore.js'
import { sceneManager } from './managers/SceneManager.js'
import { objectManager } from './managers/ObjectManager.js'
import { storageManager } from './managers/StorageManager.js'
import { simulationManager } from './managers/SimulationManager.js'
import { driveManager } from './managers/DriveManager.js'
import { wireManager } from './managers/WireManager.js'
import { buildProjectSnapshot, snapRotationToAxes } from './utils/helpers.js'
import { prefetchModels } from './utils/modelLoader.js'
import { bootProgress } from './utils/bootProgress.js'
import PerfOverlay from './components/PerfOverlay.jsx'
import { trackEvent } from './utils/utmTracking.js'
import { loadCSG } from './utils/csgLib.js'

const SHAPE_KEYS = { '1': 'cylinder', '2': 'cone', '3': 'box', '4': 'sphere', '5': 'tetrahedron', '6': 'pyramid', '7': 'pentpyramid', '8': 'octahedron', '9': 'dodecahedron', '0': 'rectprism' }
const ELEC_TYPES = ['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo']

// Startup overlay. It does NOT gate the editor: the editor mounts underneath at
// once and this fades out as soon as the viewport has drawn its first frame.
// Models, physics, Blockly etc. load later, on demand.
function BootOverlay({ onDone }) {
  const [st, setSt] = useState(() => bootProgress.get())
  const [leaving, setLeaving] = useState(false)
  useEffect(() => bootProgress.subscribe(setSt), [])
  useEffect(() => {
    if (!st.workspace) return
    setLeaving(true)
    const t = setTimeout(onDone, 260)
    return () => clearTimeout(t)
  }, [st.workspace, onDone])
  const row = (done, label) => (
    <div className="flex items-center gap-2" style={{ color: done ? '#fdba74' : 'rgba(229,231,235,0.55)', fontSize: 13 }}>
      <span style={{ width: 14, display: 'inline-block', textAlign: 'center' }}>{done ? '✓' : '•'}</span>{label}
    </div>
  )
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#0b0d12', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, opacity: leaving ? 0 : 1, transition: 'opacity 240ms ease', pointerEvents: leaving ? 'none' : 'auto' }}>
      <ConstructaLogo width={360} style={{ maxWidth: '72vw' }} />
      <div style={{ display: 'grid', gap: 6, minWidth: 200 }}>
        <div style={{ color: '#e5e7eb', fontSize: 13, marginBottom: 2 }}>Loading Constructa</div>
        {row(st.core, 'Core')}
        {row(st.renderer, 'Renderer')}
        {row(st.workspace, 'Workspace')}
      </div>
    </div>
  )
}

// ── Resize handle component ───────────────────────────────────────────────────
function ResizeHandle({ onMouseDown }) {
  return (
    <div
      role="separator" aria-orientation="vertical" aria-label="Resize panel"
      className="shrink-0 w-1.5 my-6 rounded-full cursor-col-resize transition-colors hover:bg-indigo-500/40 active:bg-indigo-500/60"
      onMouseDown={onMouseDown}
    />
  )
}

// ── Main editor — all hooks live here, no early returns ───────────────────────
function AppEditor() {
  const addObject = useSceneStore((s) => s.addObject)
  const insertObject = useSceneStore((s) => s.insertObject)
  const deleteSelected = useSceneStore((s) => s.deleteSelected)
  const duplicateObject = useSceneStore((s) => s.duplicateObject)
  const selectedId = useSceneStore((s) => s.selectedId)
  const secondaryId = useSceneStore((s) => s.secondaryId)
  const toggleGrid = useSceneStore((s) => s.toggleGrid)
  const toggleAxes = useSceneStore((s) => s.toggleAxes)
  const setTransformMode = useUiStore((s) => s.setTransformMode)
  const activePanel = useUiStore((s) => s.activePanel)
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const simActive = useUiStore((s) => s.simActive)
  const snapTranslate = useUiStore((s) => s.snapTranslate)
  const snapRotateDeg = useUiStore((s) => s.snapRotateDeg)
  const printBedVisible = useUiStore((s) => s.printBedVisible)
  const printBedSizeMm  = useUiStore((s) => s.printBedSizeMm)
  const { snapshot, undo, redo } = useHistory()
  const clipboard = useRef(null)
  // Smart duplicate-and-repeat chain: { newId, prev:{position,rotation,scale} }
  const dupChain = useRef(null)

  // ── Resizable right workspace ─────────────────────────────────────────────
  // The left sidebar is gone (its tools moved into the floating viewport
  // toolbox); only the right workspace (icon rail + section) is resizable now.
  const [rightWidth, setRightWidth] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 1800 ? 360 : 312))
  const rightResizing = useRef(false)

  useEffect(() => {
    const onMove = (e) => {
      if (rightResizing.current) setRightWidth(Math.max(260, Math.min(560, window.innerWidth - e.clientX - 72)))
    }
    const onUp = () => {
      rightResizing.current = false
      document.body.style.cursor    = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  const addWireConnection    = useElectronicsStore((s) => s.addWireConnection)
  const removeWireConnection = useElectronicsStore((s) => s.removeWireConnection)

  // Boolean panel now supports both geometry + electronics pairs. Selected as a
  // primitive so the whole editor does NOT re-render on every transform tick
  // (subscribing to `objects` here re-rendered every panel on each drag move).
  const bothBoolean = useSceneStore((s) => {
    if (!s.secondaryId) return false
    const a = s.objects.find(o => o.id === s.selectedId), b = s.objects.find(o => o.id === s.secondaryId)
    return isBooleanCandidate(a) && isBooleanCandidate(b)
  })

  // When a second object is selected, jump to the Boolean tab automatically —
  // but keep all other tabs (Joints, Props, …) reachable so two-object actions
  // aren't limited to booleans. When the pair is broken, leave the Boolean tab.
  const prevBothBoolean = useRef(false)
  useEffect(() => {
    if (bothBoolean && !prevBothBoolean.current) {
      setActivePanel('boolean')
    } else if (!bothBoolean && prevBothBoolean.current && activePanel === 'boolean') {
      setActivePanel('properties')
    }
    prevBothBoolean.current = bothBoolean
  }, [bothBoolean, activePanel, setActivePanel])

  // ── Motor + LED animation, and differential drive physics ────────────────
  const simActiveRef = useRef(false)
  simActiveRef.current = simActive

  // Initialize JointManager once scene + objectManager are ready
  useEffect(() => {
    if (sceneManager.scene) {
      jointManager.init(sceneManager.scene, objectManager)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sceneManager.onAnimationTick = () => {
      if (simulationManager.isRunning()) {
        const speeds = simulationManager.motorSpeeds
        if (Object.keys(speeds).length > 0) {
          // Log once per second (every ~60 frames at 60fps)
          if (!sceneManager._simLogCount) sceneManager._simLogCount = 0
          if (++sceneManager._simLogCount % 60 === 1)
            console.log('[Tick] motorSpeeds:', JSON.stringify(speeds))
        }
        for (const [id, speed] of Object.entries(speeds)) {
          objectManager.animateMotor(id, speed)
        }
        for (const [id, brightness] of Object.entries(simulationManager.ledBrightness)) {
          objectManager.animateLed(id, brightness)
        }
        for (const [id, angle] of Object.entries(simulationManager.servoAngles)) {
          objectManager.animateServo(id, angle)
        }
      }
      // Drive physics runs every frame when simulation mode is active
      if (simActiveRef.current) driveManager.step()
      // Propagate rigid bonds every frame — bonds are live constraints. Skipped
      // while the articulated physics engine owns the robot (bonded parts are one
      // rigid body there, posed by physics — the kinematic pass would fight it).
      const physicsOwnsRobot = objectManager.physicsDriven
      // Stable array per bonds-object (the store replaces the object on change),
      // so the bond pass can cache its ordering instead of re-sorting each frame.
      const bondsObj = useRigidStore.getState().bonds
      if (bondsObj !== bondsCache.obj) { bondsCache.obj = bondsObj; bondsCache.arr = Object.values(bondsObj) }
      const bonds = bondsCache.arr
      if (bonds.length > 0 && !physicsOwnsRobot) {
        // Skip propagating a bond whose child is currently being dragged by the
        // transform gizmo — otherwise the frame loop fights the user's drag.
        const tc = sceneManager.transformControls
        const draggingId = (tc?.dragging && tc.object?.userData?.id) ? tc.object.userData.id : null
        const activeBonds = draggingId ? bonds.filter(b => b.childId !== draggingId) : bonds
        objectManager.propagateAllBonds(activeBonds)
      }
      // Drive joint constraints every frame (hinge/revolute/slider animation) —
      // unless physics is solving those joints for real.
      if (!physicsOwnsRobot) jointManager.step()
      // Gear chains run AFTER propagateAllBonds so bond-child gears (position-locked to
      // chassis) accumulate their cumulative spin on top of what propBonds set each frame.
      if (simulationManager.isRunning()) {
        const gearMeshPairs = useGearStore.getState().meshPairs
        if (gearMeshPairs.length > 0) {
          const gearAttachments = useElectronicsStore.getState().attachments
          objectManager.stepGearChains(simulationManager.motorSpeeds, gearMeshPairs, useSceneStore.getState().objects, gearAttachments)
          objectManager.applyGearRotations(bonds)
        }
      }
      // Paint at full frame-rate only while something is actually moving. When the
      // scene is idle the SceneManager throttles to a low rate — a big win on
      // low-end laptops (and battery). Bonds/joints moving are driven by drags,
      // which wake the renderer via their own change events.
      if (simulationManager.isRunning() || simActiveRef.current) sceneManager.requestRender()
    }
    return () => { sceneManager.onAnimationTick = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enter / exit drive mode when simActive toggles ───────────────────────
  useEffect(() => {
    if (simActive) {
      objectManager.resetGearAngles()
      driveManager.enter(useSceneStore.getState().objects)
    } else {
      objectManager.resetGearAngles()
      driveManager.exit((id, updates) => useSceneStore.getState().updateObject(id, updates))
    }
  }, [simActive])

  // ── Wire callbacks ────────────────────────────────────────────────────────
  useEffect(() => {
    wireManager.onWireCreated = (fromPinId, toPinId, connId) => {
      addWireConnection(fromPinId, toPinId, connId)
    }
    wireManager.onWireRemoved = (connId) => {
      removeWireConnection(connId)
    }
    return () => {
      wireManager.onWireCreated = null
      wireManager.onWireRemoved = null
    }
  }, [addWireConnection, removeWireConnection])

  // Reveal pin interaction points only when needed: every board's pins while the
  // Wiring panel is open, or just the selected board's pins otherwise. Keeps the GLB
  // boards clean (no floating helper spheres/labels) until the user is actually wiring.
  useEffect(() => {
    if (activePanel === 'wiring') wireManager.setReveal({ all: true })
    else if (selectedId)         wireManager.setReveal({ components: [selectedId] })
    else                         wireManager.setReveal({ components: [] })
  }, [activePanel, selectedId])

  useEffect(() => () => simulationManager.stop(), [])

  useEffect(() => {
    storageManager.enableAutoSave(
      () => buildProjectSnapshot(useSceneStore.getState(), useElectronicsStore.getState()),
      30000,
      // Persistent slices only — selection, simulation state etc. never dirty it.
      [
        [useSceneStore, s => s.objects], [useSceneStore, s => s.projectName],
        [useElectronicsStore, s => s.connections], [useElectronicsStore, s => s.code], [useElectronicsStore, s => s.attachments],
        [useRigidStore, s => s.bonds], [useJointStore, s => s.joints], [useSurfaceStore, s => s.patches],
        [useRobotStore, s => s.blueprints], [usePhysicsStore, s => s.worldPhysics], [usePhysicsStore, s => s.gravity],
      ],
    )
    return () => storageManager.disableAutoSave()
  }, [])

  useEffect(() => { resetBaseline() }, [])

  // Cloud sync: if opened from the dashboard (?project=) or a share link
  // (?share=), consume the session handoff, load the project, and start
  // auto-saving. No-op otherwise (standalone editor behaves exactly as before).
  useEffect(() => { initCloudSync() }, [])

  // First the "Start Session" banner is shown (StartSessionBanner). When the user
  // starts it, the banner is removed and it launches the puppy mission itself —
  // so there's no auto-launch here anymore.

  // Count every ▶ Run Code click (Code panel, Blocks panel, and the in-sim HUD all
  // dispatch constructa:code-run) → one code_run analytics event.
  useEffect(() => {
    const onRun = () => trackEvent('code_run', { parts: useSceneStore.getState().objects.length })
    window.addEventListener('constructa:code-run', onRun)
    return () => window.removeEventListener('constructa:code-run', onRun)
  }, [])

  // Push snap-to-grid settings down to the transform gizmo whenever they change.
  useEffect(() => { sceneManager.setSnap(snapTranslate, snapRotateDeg) }, [snapTranslate, snapRotateDeg])

  // Show/update the 3D-printer build plate.
  useEffect(() => { sceneManager.setPrintBed(printBedVisible, printBedSizeMm) }, [printBedVisible, printBedSizeMm])

  // Keyboard shortcuts
  useEffect(() => {
    // Tinkercad-style smart duplicate: the FIRST Ctrl+D offsets a copy; once you
    // move/rotate/scale that copy, each subsequent Ctrl+D repeats the same delta,
    // building a linear or radial array from a single demonstrated step.
    const smartDuplicate = () => {
      const st  = useSceneStore.getState()
      const src = st.objects.find(o => o.id === st.selectedId)
      if (!src) return
      const chain = dupChain.current
      if (chain && chain.newId === src.id) {
        const p = chain.prev
        const dPos = { x: src.position.x - p.position.x, y: src.position.y - p.position.y, z: src.position.z - p.position.z }
        const dRot = { x: src.rotation.x - p.rotation.x, y: src.rotation.y - p.rotation.y, z: src.rotation.z - p.rotation.z }
        const dScl = { x: src.scale.x / (p.scale.x || 1), y: src.scale.y / (p.scale.y || 1), z: src.scale.z / (p.scale.z || 1) }
        const moved = Math.abs(dPos.x) + Math.abs(dPos.y) + Math.abs(dPos.z) +
                      Math.abs(dRot.x) + Math.abs(dRot.y) + Math.abs(dRot.z) +
                      Math.abs(dScl.x - 1) + Math.abs(dScl.y - 1) + Math.abs(dScl.z - 1) > 1e-6
        if (moved) {
          const clone = {
            ...JSON.parse(JSON.stringify(src)),
            id: crypto.randomUUID(),
            name: src.name.replace(/_copy.*$/, '') + '_copy',
            position: { x: src.position.x + dPos.x, y: src.position.y + dPos.y, z: src.position.z + dPos.z },
            rotation: { x: src.rotation.x + dRot.x, y: src.rotation.y + dRot.y, z: src.rotation.z + dRot.z },
            scale:    { x: src.scale.x * dScl.x,    y: src.scale.y * dScl.y,    z: src.scale.z * dScl.z },
            metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          }
          insertObject(clone)
          dupChain.current = { newId: clone.id, prev: { position: { ...src.position }, rotation: { ...src.rotation }, scale: { ...src.scale } } }
          snapshot()
          return
        }
      }
      // First duplicate (or chain broken): plain offset copy, then start a new chain.
      const dupe = duplicateObject(src.id)
      if (dupe) {
        dupChain.current = { newId: dupe.id, prev: { position: { ...src.position }, rotation: { ...src.rotation }, scale: { ...src.scale } } }
        snapshot()
      }
    }

    const handleKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea'

      // During a battle/arena, the combat manager owns WASD / arrows — block editor shortcuts.
      if (useGameStore.getState().battleActive || useCombatStore.getState().arenaActive) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return }

      // Ctrl+C — copy selected (non-electronics only)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const obj = useSceneStore.getState().objects.find(o => o.id === selectedId)
        if (obj && !ELEC_TYPES.includes(obj.type)) {
          clipboard.current = JSON.parse(JSON.stringify(obj))
        }
        return
      }
      // Ctrl+V — paste clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard.current) {
          const src = clipboard.current
          const pasted = {
            ...JSON.parse(JSON.stringify(src)),
            id: crypto.randomUUID(),
            name: src.name + '_copy',
            position: { x: src.position.x + 2, y: src.position.y, z: src.position.z + 2 },
            metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          }
          insertObject(pasted)
          snapshot()
        }
        return
      }

      // Ctrl+G — group selected pair (CSG combine, holes subtract); Ctrl+Shift+G — ungroup
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        const st = useSceneStore.getState()
        // CSG engine loads on demand (normally already preloaded at idle).
        loadCSG().then(() => {
          if (e.shiftKey) { if (st.ungroupSelected()) snapshot() }
          else            { if (st.groupSelected())   snapshot() }
        })
        return
      }

      if (isTyping) return
      if (SHAPE_KEYS[e.key]) { addObject(SHAPE_KEYS[e.key]); snapshot(); return }

      switch (e.key) {
        case 'Delete': case 'Backspace': {
          const surfState = useSurfaceStore.getState()
          const uiState   = useUiStore.getState()
          if (uiState.surfaceToolActive && surfState.selectedIds.length > 0) {
            // Delete selected surface patches when surface tool is active
            surfState.selectedIds.forEach(id => surfState.removePatch(id))
            snapshot()
          } else {
            deleteSelected(); snapshot()
          }
          break
        }
        case 'd': case 'D':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); smartDuplicate(); }
          break
        case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
          // Nudge the selected object by the snap step (or 1 unit). Shift = vertical (Y).
          // Skipped during simulation so arrows still drive legged robots.
          if (useUiStore.getState().simActive || !selectedId) break
          const st = useSceneStore.getState()
          const sel = st.objects.find(o => o.id === selectedId)
          if (!sel) break
          e.preventDefault()
          const step = (useUiStore.getState().snapTranslate || 1)
          const p = { ...sel.position }
          if (e.shiftKey) { if (e.key === 'ArrowUp') p.y += step; if (e.key === 'ArrowDown') p.y -= step }
          else {
            if (e.key === 'ArrowLeft')  p.x -= step
            if (e.key === 'ArrowRight') p.x += step
            if (e.key === 'ArrowUp')    p.z -= step
            if (e.key === 'ArrowDown')  p.z += step
          }
          st.updateObject(selectedId, { position: p })
          const mesh = objectManager.getMesh(selectedId)
          if (mesh) mesh.position.set(p.x, p.y, p.z)
          snapshot()
          break
        }
        case 'g': case 'G': toggleGrid(); break
        case 'a': case 'A': toggleAxes(); break
        case 'f': case 'F':
          if (selectedId) sceneManager.fitToView(selectedId); else sceneManager.resetCamera(); break
        case 'Escape':
          if (wireManager.isDragging) { wireManager.onKeyDown(e) }
          else useSceneStore.getState().clearSelection()
          break
        case 's': case 'S':
          if (e.shiftKey && selectedId) {
            const obj = useSceneStore.getState().objects.find(o => o.id === selectedId)
            if (obj) {
              const snapped = snapRotationToAxes(obj.rotation)
              useSceneStore.getState().updateObject(selectedId, { rotation: snapped })
              const mesh = objectManager.getMesh(selectedId)
              if (mesh) mesh.rotation.set(snapped.x, snapped.y, snapped.z)
              snapshot()
            }
          }
          break
        case 'w': case 'W': setTransformMode('translate'); break
        case 'e': case 'E': setTransformMode('rotate'); break
        case 'r': case 'R': {
          // Block scale mode for electronics
          const selObj = useSceneStore.getState().objects.find(o => o.id === selectedId)
          if (!selObj || !ELEC_TYPES.includes(selObj.type)) setTransformMode('scale')
          break
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId, snapshot, undo, redo, addObject, insertObject, deleteSelected, duplicateObject, toggleGrid, toggleAxes, setTransformMode])

  const startRightResize = (e) => {
    e.preventDefault()
    rightResizing.current = true
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-slate-800 overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0" style={{ background: 'rgb(var(--g-950))' }}>
        {/* Centre: the 3D viewport (Quick Tools float inside it). Code / Workbench
            take over this area as an overlay — the viewport stays mounted. */}
        <div className="relative flex-1 min-w-0 flex">
          <Viewport />
          <CenterWorkspace />
        </div>

        {/* Right: context panel (level 2/3) beside the permanent nav rail (level 1). */}
        {panelOpen && <ResizeHandle onMouseDown={startRightResize} />}
        {panelOpen && <ContextPanel width={rightWidth} />}
        <NavRail />
      </div>
      <StatusBar />

      {/* ── Onboarding layer (UI-only; observes state, never mutates it) ── */}
      {/* Mirrors onboarding flags into the overlay coordinator so the View Cube
          yields to the welcome card / tour / coach / reference modals. */}
      <OverlayBridge />
      <CloudSaveBar />
      <EmailCapture />
      <WelcomeOverlay />
      <ProductTour />
      <GuidedCoach />
      <KeyboardShortcutsModal />
      <BeginnerGuideModal />
    </div>
  )
}

// ── App shell ────────────────────────────────────────────────────────────────
// P0 path only: the editor mounts immediately (no model preloading). Built-in
// GLBs load on demand (library click / project load / idle prefetch); Rapier,
// Blockly and cloud sync load when first needed.
const bondsCache = { obj: null, arr: [] }

// Built-in models to warm at idle after boot. On Data-Saver / slow links only
// the small, most-used parts are prefetched; everything else loads on use.
const PREFETCH_SMALL = ['servo', 'motor_bo', 'motor_dc', 'led', 'buzzer', 'ultrasonic']
const PREFETCH_REST  = ['arduino', 'subo', 'ir_sensor', 'ldr_sensor', 'oled', 'gas_sensor', 'dht11', 'free_wheels']
function prefetchAfterBoot() {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null
  const constrained = !!(c && (c.saveData || /2g|3g/.test(c.effectiveType || '')))
  prefetchModels(constrained ? PREFETCH_SMALL : [...PREFETCH_SMALL, ...PREFETCH_REST])
}

function ProjectLoadingBanner() {
  const p = useUiStore((s) => s.projectLoading)
  if (!p) return null
  return (
    <div style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 200 }}
      className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
      data-testid="project-loading">
      <span style={{ color: 'rgb(var(--g-200))' }}>Loading project models… {p.done}/{p.total}</span>
    </div>
  )
}

export default function App() {
  const [booting, setBooting] = useState(true)
  useEffect(() => {
    bootProgress.mark('core')
    return bootProgress.subscribe((st) => {
      if (st.workspace && !App._tracked) {
        App._tracked = true
        prefetchAfterBoot()
        ;(typeof requestIdleCallback === 'function' ? requestIdleCallback : (f) => setTimeout(f, 2000))(() => loadCSG(), { timeout: 10000 })
        trackEvent('app_loaded', { device: navigator.userAgentData?.mobile ? 'mobile' : 'desktop', boot_ms: st.times.workspace })
      }
    })
  }, [])
  const done = useCallback(() => setBooting(false), [])
  return (
    <>
      <AppEditor />
      <ProjectLoadingBanner />
      <PerfOverlay />
      {booting && <BootOverlay onDone={done} />}
    </>
  )
}
