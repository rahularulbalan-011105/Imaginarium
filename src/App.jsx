import { useEffect, useRef, useState } from 'react'
import Header from './components/Header.jsx'
import Toolbar from './components/Toolbar.jsx'
import Viewport from './components/Viewport.jsx'
import PropertiesPanel from './components/PropertiesPanel.jsx'
import ObjectList from './components/ObjectList.jsx'
import StatusBar from './components/StatusBar.jsx'
import BooleanPanel from './components/BooleanPanel.jsx'
import CodeEditor from './components/CodeEditor.jsx'
import { useSceneStore } from './stores/sceneStore.js'
import { useUiStore } from './stores/uiStore.js'
import { useElectronicsStore } from './stores/electronicsStore.js'
import { useHistory } from './hooks/useHistory.js'
import { historyManager } from './managers/HistoryManager.js'
import { sceneManager } from './managers/SceneManager.js'
import { objectManager } from './managers/ObjectManager.js'
import { storageManager } from './managers/StorageManager.js'
import { simulationManager } from './managers/SimulationManager.js'
import { driveManager } from './managers/DriveManager.js'
import { wireManager } from './managers/WireManager.js'
import { buildProjectSnapshot, snapRotationToAxes } from './utils/helpers.js'
import { preloadModels } from './utils/modelLoader.js'

const SHAPE_KEYS = { '1': 'box', '2': 'sphere', '3': 'cylinder', '4': 'cone', '5': 'torus', '6': 'plane', '7': 'capsule', '8': 'pyramid', '9': 'prism', '0': 'diamond' }
const ELEC_TYPES = ['arduino', 'motor', 'motor_bo', 'motor_dc', 'led']

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950 text-white flex-col gap-3">
      <div className="text-2xl animate-spin">⚙</div>
      <div className="text-sm text-gray-400">Loading 3D models…</div>
    </div>
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
  const { snapshot, undo, redo } = useHistory()
  const clipboard = useRef(null)

  const addWireConnection    = useElectronicsStore((s) => s.addWireConnection)
  const removeWireConnection = useElectronicsStore((s) => s.removeWireConnection)

  const objA = objects.find(o => o.id === selectedId)
  const objB = objects.find(o => o.id === secondaryId)
  const bothGeometry = secondaryId &&
    objA && objB &&
    !ELEC_TYPES.includes(objA.type) &&
    !ELEC_TYPES.includes(objB.type)

  // ── Motor + LED animation, and differential drive physics ────────────────
  const simActiveRef = useRef(false)
  simActiveRef.current = simActive

  useEffect(() => {
    sceneManager.onAnimationTick = () => {
      if (simulationManager.isRunning()) {
        for (const [id, speed] of Object.entries(simulationManager.motorSpeeds)) {
          objectManager.animateMotor(id, speed)
        }
        for (const [id, brightness] of Object.entries(simulationManager.ledBrightness)) {
          objectManager.animateLed(id, brightness)
        }
      }
      // Drive physics runs every frame when simulation mode is active
      if (simActiveRef.current) driveManager.step()
    }
    return () => { sceneManager.onAnimationTick = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enter / exit drive mode when simActive toggles ───────────────────────
  useEffect(() => {
    if (simActive) {
      driveManager.enter(useSceneStore.getState().objects)
    } else {
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
    storageManager.enableAutoSave(() => buildProjectSnapshot(useSceneStore.getState()), 30000)
    return () => storageManager.disableAutoSave()
  }, [])

  useEffect(() => { historyManager.push([]) }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea'

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

      if (isTyping) return
      if (SHAPE_KEYS[e.key]) { addObject(SHAPE_KEYS[e.key]); snapshot(); return }

      switch (e.key) {
        case 'Delete': case 'Backspace': deleteSelected(); snapshot(); break
        case 'd': case 'D':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); if (selectedId) { duplicateObject(selectedId); snapshot() } }
          break
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
    { id: 'code',       label: '{ } Code' },
  ]

  const renderRightPanel = () => {
    if (secondaryId && bothGeometry) {
      return (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-purple-700/50 bg-purple-900/20 shrink-0">
            <span className="text-purple-400 text-sm">⊕</span>
            <span className="text-xs font-semibold text-purple-300">Boolean</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <BooleanPanel selectedId={selectedId} secondaryId={secondaryId} />
          </div>
        </>
      )
    }

    return (
      <>
        <div className="flex border-b border-gray-700/50 shrink-0">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActivePanel(id)}
              className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
                activePanel === id
                  ? 'text-white border-b-2 border-blue-500 bg-gray-800/50'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {activePanel === 'properties' ? <PropertiesPanel />
            : activePanel === 'objects' ? <ObjectList />
            : <CodeEditor />}
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        <Toolbar />
        <Viewport />
        <div className="flex flex-col w-64 shrink-0 bg-gray-900 border-l border-gray-700/50">
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
