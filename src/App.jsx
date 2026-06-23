import { useEffect, useRef, useState } from 'react'
import Header from './components/Header.jsx'
import Toolbar from './components/Toolbar.jsx'
import Viewport from './components/Viewport.jsx'
import PropertiesPanel from './components/PropertiesPanel.jsx'
import ObjectList from './components/ObjectList.jsx'
import StatusBar from './components/StatusBar.jsx'
import BooleanPanel, { isBooleanCandidate } from './components/BooleanPanel.jsx'
import CodeEditor from './components/CodeEditor.jsx'
import BlocksPanel from './components/BlocksPanel.jsx'
import BattlePanel from './components/BattlePanel.jsx'
import PanelErrorBoundary from './components/PanelErrorBoundary.jsx'
import AssetLibrary from './components/AssetLibrary.jsx'
import JointPanel from './components/JointPanel.jsx'
import RobotPanel from './components/RobotPanel.jsx'
import WiringPanel from './components/WiringPanel.jsx'
import { useSceneStore } from './stores/sceneStore.js'
import { useUiStore } from './stores/uiStore.js'
import { useElectronicsStore } from './stores/electronicsStore.js'
import { useRigidStore } from './stores/rigidStore.js'
import { useSurfaceStore } from './stores/surfaceStore.js'
import { useGearStore } from './stores/gearStore.js'
import { useJointStore } from './stores/jointStore.js'
import { useHistory } from './hooks/useHistory.js'
import { resetBaseline } from './managers/history/editorDispatch.js'
import { jointManager } from './managers/JointManager.js'
import { battleManager } from './managers/BattleManager.js'
import { useGameStore } from './stores/gameStore.js'
import { sceneManager } from './managers/SceneManager.js'
import { objectManager } from './managers/ObjectManager.js'
import { storageManager } from './managers/StorageManager.js'
import { simulationManager } from './managers/SimulationManager.js'
import { driveManager } from './managers/DriveManager.js'
import { wireManager } from './managers/WireManager.js'
import { buildProjectSnapshot, snapRotationToAxes } from './utils/helpers.js'
import { preloadModels } from './utils/modelLoader.js'

const SHAPE_KEYS = { '1': 'cylinder', '2': 'cone', '3': 'box', '4': 'sphere', '5': 'tetrahedron', '6': 'pyramid', '7': 'pentpyramid', '8': 'octahedron', '9': 'dodecahedron', '0': 'rectprism' }
const ELEC_TYPES = ['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo']

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950 text-white flex-col gap-3">
      <div className="text-2xl animate-spin">⚙</div>
      <div className="text-sm text-gray-400">Loading 3D models…</div>
    </div>
  )
}

// ── Resize handle component ───────────────────────────────────────────────────
function ResizeHandle({ onMouseDown }) {
  return (
    <div
      className="shrink-0 w-1 cursor-col-resize hover:bg-amber-500/40 active:bg-amber-500/60 transition-colors"
      style={{ background: 'rgba(50,48,43,0.8)' }}
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
  const objects = useSceneStore((s) => s.objects)
  const toggleGrid = useSceneStore((s) => s.toggleGrid)
  const toggleAxes = useSceneStore((s) => s.toggleAxes)
  const setTransformMode = useUiStore((s) => s.setTransformMode)
  const activePanel = useUiStore((s) => s.activePanel)
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const simActive = useUiStore((s) => s.simActive)
  const snapTranslate = useUiStore((s) => s.snapTranslate)
  const snapRotateDeg = useUiStore((s) => s.snapRotateDeg)
  const { snapshot, undo, redo } = useHistory()
  const clipboard = useRef(null)
  // Smart duplicate-and-repeat chain: { newId, prev:{position,rotation,scale} }
  const dupChain = useRef(null)

  // ── Resizable sidebars ────────────────────────────────────────────────────
  const [leftWidth,  setLeftWidth]  = useState(56)   // default 56px (old w-14)
  const [rightWidth, setRightWidth] = useState(256)  // default 256px (old w-64)
  const leftResizing  = useRef(false)
  const rightResizing = useRef(false)

  useEffect(() => {
    const onMove = (e) => {
      if (leftResizing.current)  setLeftWidth(Math.max(48, Math.min(220, e.clientX)))
      if (rightResizing.current) setRightWidth(Math.max(180, Math.min(520, window.innerWidth - e.clientX)))
    }
    const onUp = () => {
      leftResizing.current  = false
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

  const objA = objects.find(o => o.id === selectedId)
  const objB = objects.find(o => o.id === secondaryId)
  // Boolean panel now supports both geometry + electronics pairs
  const bothBoolean = secondaryId && isBooleanCandidate(objA) && isBooleanCandidate(objB)
  const bothGeometry = bothBoolean  // kept for any other checks

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
      // Robo-sumo battle — moves whole robot assemblies rigidly.
      const battleOn = useGameStore.getState().battleActive
      if (battleOn) battleManager.step()
      // Propagate rigid bonds every frame — bonds are live constraints.
      // Skipped during battle (BattleManager owns robot part positions).
      const bonds = battleOn ? [] : Object.values(useRigidStore.getState().bonds)
      if (bonds.length > 0) {
        // Skip propagating a bond whose child is currently being dragged by the
        // transform gizmo — otherwise the frame loop fights the user's drag.
        const tc = sceneManager.transformControls
        const draggingId = (tc?.dragging && tc.object?.userData?.id) ? tc.object.userData.id : null
        const activeBonds = draggingId ? bonds.filter(b => b.childId !== draggingId) : bonds
        objectManager.propagateAllBonds(activeBonds)
      }
      // Drive joint constraints every frame (hinge/revolute/slider animation)
      jointManager.step()
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

  useEffect(() => () => simulationManager.stop(), [])

  useEffect(() => {
    storageManager.enableAutoSave(
      () => buildProjectSnapshot(useSceneStore.getState(), useElectronicsStore.getState()),
      30000
    )
    return () => storageManager.disableAutoSave()
  }, [])

  useEffect(() => { resetBaseline() }, [])

  // Push snap-to-grid settings down to the transform gizmo whenever they change.
  useEffect(() => { sceneManager.setSnap(snapTranslate, snapRotateDeg) }, [snapTranslate, snapRotateDeg])

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

      // During a battle, BattleManager owns WASD / arrows — block editor shortcuts.
      if (useGameStore.getState().battleActive) return

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
        if (e.shiftKey) { if (st.ungroupSelected()) snapshot() }
        else            { if (st.groupSelected())   snapshot() }
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

  // ── Right sidebar logic ───────────────────────────────────────────────────
  const TABS = [
    { id: 'properties', label: 'Props' },
    { id: 'objects',    label: 'Objects' },
    { id: 'wiring',     label: '⚡ Wiring' },
    { id: 'joints',     label: '⚙ Joints' },
    { id: 'robot',      label: '🤖 Robot' },
    { id: 'blocks',     label: '🧩 Blocks' },
    { id: 'code',       label: '{ } Code' },
    { id: 'battle',     label: '⚔ Battle' },
    { id: 'library',    label: '📦 Library' },
  ]

  const renderRightPanel = () => {
    // Boolean is a tab that only appears while two boolean-capable objects are
    // selected. It's auto-focused on selection but the rest stay clickable.
    const tabs = bothBoolean
      ? [{ id: 'boolean', label: '⊕ Boolean' }, ...TABS]
      : TABS
    // Guard against showing the Boolean panel after the pair is broken
    const panel = (activePanel === 'boolean' && !bothBoolean) ? 'properties' : activePanel

    return (
      <>
        <div className="flex border-b border-gray-700/50 shrink-0 overflow-x-auto">
          {tabs.map(({ id, label }) => {
            const isBool = id === 'boolean'
            const active = panel === id
            return (
              <button
                key={id}
                onClick={() => setActivePanel(id)}
                className={`shrink-0 px-2 py-2 text-[10px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? isBool
                      ? 'text-purple-200 border-b-2 border-purple-500 bg-purple-900/30'
                      : 'text-white border-b-2 border-amber-500 bg-gray-800/50'
                    : isBool
                      ? 'text-purple-400 hover:text-purple-200'
                      : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {panel === 'boolean'    ? <BooleanPanel selectedId={selectedId} secondaryId={secondaryId} />
            : panel === 'properties' ? <PropertiesPanel />
            : panel === 'objects'  ? <ObjectList />
            : panel === 'wiring'   ? <WiringPanel />
            : panel === 'joints'   ? <JointPanel />
            : panel === 'robot'    ? <RobotPanel />
            : panel === 'blocks'   ? <PanelErrorBoundary label="Blocks"><BlocksPanel /></PanelErrorBoundary>
            : panel === 'battle'   ? <PanelErrorBoundary label="Battle"><BattlePanel /></PanelErrorBoundary>
            : panel === 'library'  ? <AssetLibrary />
            : <CodeEditor />}
        </div>
      </>
    )
  }

  const startLeftResize = (e) => {
    e.preventDefault()
    leftResizing.current = true
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const startRightResize = (e) => {
    e.preventDefault()
    rightResizing.current = true
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar — resizable */}
        <div style={{ width: leftWidth, flexShrink: 0 }} className="overflow-hidden">
          <Toolbar />
        </div>
        <ResizeHandle onMouseDown={startLeftResize} />

        <Viewport />

        <ResizeHandle onMouseDown={startRightResize} />
        {/* Right panel — resizable */}
        <div className="flex flex-col shrink-0 bg-gray-900" style={{ width: rightWidth }}>
          {renderRightPanel()}
        </div>
      </div>
      <StatusBar />
    </div>
  )
}

// ── Loader shell — waits for GLB models before mounting the editor ────────────
export default function App() {
  const [modelsReady, setModelsReady] = useState(false)
  useEffect(() => { preloadModels().then(() => setModelsReady(true)) }, [])
  if (!modelsReady) return <LoadingScreen />
  return <AppEditor />
}
