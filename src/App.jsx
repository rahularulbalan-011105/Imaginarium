import { useEffect, useRef, useState } from 'react'
import Header from './components/Header.jsx'
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
import ElectronicsLibrary from './components/ElectronicsLibrary.jsx'
import MechanicalLibrary from './components/MechanicalLibrary.jsx'
import JointPanel from './components/JointPanel.jsx'
import WiringPanel from './components/WiringPanel.jsx'
import WelcomeOverlay from './components/WelcomeOverlay.jsx'
import DiscordGate from './components/DiscordGate.jsx'
import ConstructaLogo from './components/ConstructaLogo.jsx'
import ProductTour from './components/onboarding/ProductTour.jsx'
import GuidedCoach from './components/onboarding/GuidedCoach.jsx'
import KeyboardShortcutsModal from './components/onboarding/KeyboardShortcutsModal.jsx'
import BeginnerGuideModal from './components/onboarding/BeginnerGuideModal.jsx'
import PanelHint from './components/onboarding/PanelHint.jsx'
import RobotPanel from './components/RobotPanel.jsx'
import OverlayBridge from './components/OverlayBridge.jsx'
import SimulationPanel from './components/SimulationPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import Icon from './components/ui/Icon.jsx'
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
import { combatManager } from './managers/CombatManager.js'
import { useCombatStore } from './stores/combatStore.js'
import CombatHUD from './components/combat/CombatHUD.jsx'
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
    <div className="flex h-screen items-center justify-center flex-col gap-6" style={{ background: '#121212' }}>
      <ConstructaLogo width={440} style={{ maxWidth: '78vw' }} />
      <div className="flex items-center gap-2.5">
        <div className="text-2xl animate-spin" style={{ color: '#ff7a18' }}>⚙</div>
        <div className="text-base" style={{ color: '#9096a0' }}>Loading your workshop…</div>
      </div>
    </div>
  )
}

// ── Resize handle component ───────────────────────────────────────────────────
function ResizeHandle({ onMouseDown }) {
  return (
    <div
      className="shrink-0 w-1 cursor-col-resize hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors"
      style={{ background: 'rgba(40,44,58,0.8)' }}
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
  const printBedVisible = useUiStore((s) => s.printBedVisible)
  const printBedSizeMm  = useUiStore((s) => s.printBedSizeMm)
  const { snapshot, undo, redo } = useHistory()
  const clipboard = useRef(null)
  // Smart duplicate-and-repeat chain: { newId, prev:{position,rotation,scale} }
  const dupChain = useRef(null)

  // ── Resizable right workspace ─────────────────────────────────────────────
  // The left sidebar is gone (its tools moved into the floating viewport
  // toolbox); only the right workspace (icon rail + section) is resizable now.
  const [rightWidth, setRightWidth] = useState(300)
  const rightResizing = useRef(false)

  useEffect(() => {
    const onMove = (e) => {
      if (rightResizing.current) setRightWidth(Math.max(224, Math.min(560, window.innerWidth - e.clientX)))
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
      // Physics Arena (combat) — CombatManager owns robot part positions too.
      const arenaOn = useCombatStore.getState().arenaActive
      if (arenaOn) combatManager.step()
      // Propagate rigid bonds every frame — bonds are live constraints.
      // Skipped during battle/arena (that manager owns robot part positions).
      const bonds = (battleOn || arenaOn) ? [] : Object.values(useRigidStore.getState().bonds)
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
      30000
    )
    return () => storageManager.disableAutoSave()
  }, [])

  useEffect(() => { resetBaseline() }, [])

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

  // ── Right workspace — grouped icon rail + one full-height section ─────────
  // Replaces the old horizontal tab strip. Each rail button carries the same
  // `tab-<id>` anchor the tutorials look for. Two brand-new sections group work
  // that used to be scattered: Simulation (entry/controls) and Settings.
  const RAIL = [
    { group: 'Design', items: [
      { id: 'properties', icon: 'sliders', label: 'Props' },
      { id: 'objects',    icon: 'layers',  label: 'Objects' },
      { id: 'library',    icon: 'package', label: 'Library' },
    ] },
    { group: 'Create', items: [
      { id: 'electronics', icon: 'cpu',  label: 'Elec' },
      { id: 'mechanical',  icon: 'bolt', label: 'Mech' },
    ] },
    { group: 'Build', items: [
      { id: 'wiring', icon: 'zap',   label: 'Wiring' },
      { id: 'joints', icon: 'link',  label: 'Joints' },
      { id: 'robot',  icon: 'robot', label: 'Robot' },
    ] },
    { group: 'Program', items: [
      { id: 'blocks', icon: 'puzzle', label: 'Blocks' },
      { id: 'code',   icon: 'code',   label: 'Code' },
    ] },
    { group: 'Run', items: [
      { id: 'sim',    icon: 'play',   label: 'Sim' },
      { id: 'battle', icon: 'swords', label: 'Battle' },
    ] },
    { group: 'Setup', items: [
      { id: 'settings', icon: 'gear', label: 'Settings' },
    ] },
  ]

  // Guard: never show the Boolean panel after the two-object pair is broken.
  const currentPanel = (activePanel === 'boolean' && !bothBoolean) ? 'properties' : activePanel

  const renderPanelBody = (panel) => {
    switch (panel) {
      case 'boolean':  return <BooleanPanel selectedId={selectedId} secondaryId={secondaryId} />
      case 'objects':  return <ObjectList />
      case 'wiring':   return <WiringPanel />
      case 'joints':   return <JointPanel />
      case 'robot':    return <RobotPanel />
      case 'blocks':   return <PanelErrorBoundary label="Blocks"><BlocksPanel /></PanelErrorBoundary>
      case 'battle':   return <PanelErrorBoundary label="Battle"><BattlePanel /></PanelErrorBoundary>
      case 'library':  return <AssetLibrary />
      case 'electronics': return <ElectronicsLibrary />
      case 'mechanical':  return <MechanicalLibrary />
      case 'sim':      return <PanelErrorBoundary label="Simulation"><SimulationPanel /></PanelErrorBoundary>
      case 'settings': return <SettingsPanel />
      case 'code':     return <CodeEditor />
      case 'properties':
      default:         return <PropertiesPanel />
    }
  }

  const railButton = ({ id, icon, label, isBool }) => {
    const active = currentPanel === id
    return (
      <button
        key={id}
        data-tour={`tab-${id}`}
        onClick={() => setActivePanel(id)}
        title={label === 'Sim' ? 'Simulation' : label === 'Props' ? 'Properties' : label}
        className="relative w-full flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl transition-all duration-200"
        style={active
          ? { background: isBool ? 'rgb(168 85 247 / 0.9)' : 'rgb(var(--a-600))', color: '#fff' }
          : { background: 'transparent', color: 'rgb(var(--g-400))' }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgb(var(--a-600) / 0.14)' }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
      >
        {active && <span className="absolute left-0.5 top-2 bottom-2 w-0.5 rounded-full" style={{ background: '#fff' }} />}
        <Icon name={icon} size={18} />
        <span className="text-[8px] font-medium leading-none">{label}</span>
      </button>
    )
  }

  const startRightResize = (e) => {
    e.preventDefault()
    rightResizing.current = true
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-slate-800 overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        {/* Viewport is now the primary surface — tools float inside it. */}
        <Viewport />

        <ResizeHandle onMouseDown={startRightResize} />

        {/* Right workspace — one full-height section + a grouped icon rail. */}
        <div data-tour="panel" className="flex shrink-0 bg-gray-900 min-h-0" style={{ width: rightWidth }}>
          {/* Active section body */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <PanelHint panelId={currentPanel} />
              {renderPanelBody(currentPanel)}
            </div>
          </div>

          {/* Grouped icon rail */}
          <nav className="shrink-0 w-14 flex flex-col items-stretch gap-0.5 py-2 px-1.5 overflow-y-auto border-l"
            style={{ borderColor: 'rgb(var(--g-700) / 0.6)', background: 'rgb(var(--g-950) / 0.55)' }}>
            {bothBoolean && (
              <>
                {railButton({ id: 'boolean', icon: 'boolean', label: 'Boolean', isBool: true })}
                <div className="h-px my-1 mx-2 rounded" style={{ background: 'rgb(var(--g-700))' }} />
              </>
            )}
            {RAIL.map((sec, i) => (
              <div key={sec.group}>
                {i > 0 && <div className="h-px my-1 mx-2 rounded" style={{ background: 'rgb(var(--g-700) / 0.6)' }} />}
                {sec.items.map((it) => railButton(it))}
              </div>
            ))}
          </nav>
        </div>
      </div>
      <StatusBar />

      {/* ── Onboarding layer (UI-only; observes state, never mutates it) ── */}
      {/* Mirrors onboarding flags into the overlay coordinator so the View Cube
          yields to the welcome card / tour / coach / reference modals. */}
      <OverlayBridge />
      {/* Blocking join-Discord gate — shown above the welcome card on every
          visit until the user joins (localStorage 'discord_joined_v1'). */}
      <DiscordGate />
      <CombatHUD />
      <WelcomeOverlay />
      <ProductTour />
      <GuidedCoach />
      <KeyboardShortcutsModal />
      <BeginnerGuideModal />
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
