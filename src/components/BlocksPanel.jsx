import { useEffect, useRef, useState } from 'react'
import * as Blockly from 'blockly'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { simulationManager } from '../managers/SimulationManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { defineArduinoBlocks, ARDUINO_TOOLBOX } from '../blockly/arduinoBlocks.js'
import { arduinoGenerator } from '../blockly/arduinoGenerator.js'

// A fresh workspace starts with a setup/loop container.
const STARTER = {
  blocks: {
    languageVersion: 0,
    blocks: [{ type: 'arduino_setup_loop', x: 40, y: 40 }],
  },
}

export default function BlocksPanel() {
  const hostRef    = useRef(null)
  const blocklyDiv = useRef(null)
  const wsRef      = useRef(null)
  const [code, setLocalCode] = useState('')
  const [error, setError]    = useState(null)
  const [started, setStarted] = useState(false)   // gate Blockly init behind a click
  const [maximized, setMaximized] = useState(false)

  const setCode       = useElectronicsStore(s => s.setCode)
  const setBlocksJson = useElectronicsStore(s => s.setBlocksJson)
  const simulation    = useElectronicsStore(s => s.simulation)
  const connections   = useElectronicsStore(s => s.connections)
  const startSimulation = useElectronicsStore(s => s.startSimulation)
  const stopSimulation  = useElectronicsStore(s => s.stopSimulation)
  const setMotorSpeed   = useElectronicsStore(s => s.setMotorSpeed)
  const setServoAngle   = useElectronicsStore(s => s.setServoAngle)

  // Initialise the workspace once the user opts in
  useEffect(() => {
    if (!started || !blocklyDiv.current) return
    // Hard-clean: dispose any prior workspace and clear the container so a
    // re-mount (StrictMode / tab switch) can never leave a ghost workspace
    // or duplicate scrollbar behind.
    if (wsRef.current) { try { wsRef.current.dispose() } catch (_) {} wsRef.current = null }
    blocklyDiv.current.innerHTML = ''

    defineArduinoBlocks()
    const ws = Blockly.inject(blocklyDiv.current, {
      toolbox: ARDUINO_TOOLBOX,
      trashcan: true,
      // Scrollbars OFF — pan by dragging empty canvas, zoom with wheel/controls.
      // (Their stale-track artifacts don't play well inside a resizable panel.)
      move: { scrollbars: false, drag: true, wheel: true },
      zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 2, minScale: 0.4 },
    })
    wsRef.current = ws

    // Restore saved workspace, else load the starter
    const saved = useElectronicsStore.getState().blocksJson
    try {
      Blockly.serialization.workspaces.load(saved ?? STARTER, ws)
    } catch (_) {
      Blockly.serialization.workspaces.load(STARTER, ws)
    }

    // Recompute SVG size AND workspace metrics/scrollbars. svgResize alone can
    // leave the scrollbar track at a stale width, so also call ws.resize().
    let rafId = null
    const refit = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        try { Blockly.svgResize(ws); ws.resize() } catch (_) {}
      })
    }

    const regen = () => {
      if (ws.isDragging()) return
      let gen = ''
      try { gen = arduinoGenerator.workspaceToCode(ws) } catch (e) { gen = '// ' + e.message }
      setLocalCode(gen)
      try { setBlocksJson(Blockly.serialization.workspaces.save(ws)) } catch (_) { /* ignore */ }
    }

    // Only react to meaningful edits — NOT UI events (clicks, scroll, viewport,
    // selection), which fire constantly. Debounced. Refit too: adding/removing
    // blocks changes content bounds and can leave the scrollbar mispositioned.
    let pending = null
    const onChange = (e) => {
      if (e.isUiEvent || ws.isDragging()) return
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => { regen(); refit() }, 200)
    }
    ws.addChangeListener(onChange)

    window.addEventListener('resize', refit)
    const ro = new ResizeObserver(refit)
    ro.observe(hostRef.current ?? blocklyDiv.current)

    // Layout for a freshly-shown panel settles over a few frames — refit a few
    // times so the canvas + scrollbars match the container.
    const timers = [0, 60, 160, 350, 600].map(ms => setTimeout(refit, ms))
    const t0 = setTimeout(() => { regen(); ws.scrollCenter() }, 80)

    return () => {
      clearTimeout(t0)
      timers.forEach(clearTimeout)
      if (pending) clearTimeout(pending)
      if (rafId) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', refit)
      ro.disconnect()
      ws.dispose(); wsRef.current = null
    }
  }, [started]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendToEditor = () => { setCode(code); useUiStore.getState().setActivePanel('code') }

  const handleRun = () => {
    setError(null)
    setCode(code)
    const objects = useSceneStore.getState().objects
    simulationManager.configure(
      connections, objects, setMotorSpeed,
      (errMsg) => { setError(errMsg); stopSimulation() },
      () => {},
      (ledId, brightness) => objectManager.animateLed(ledId, brightness),
      (servoId, angle) => setServoAngle(servoId, angle),
    )
    const err = simulationManager.start(code)
    if (err) setError(err.error)
    else startSimulation()
  }

  const handleStop = () => {
    simulationManager.stop()
    objectManager.resetAllLeds()
    stopSimulation()
    setError(null)
  }

  // Wipe the workspace back to a single clean starter (clears persisted junk).
  const resetBlocks = () => {
    const ws = wsRef.current
    setBlocksJson(null)
    if (ws) {
      try {
        Blockly.serialization.workspaces.load(STARTER, ws)
        ws.scrollCenter()
      } catch (_) { /* ignore */ }
    }
  }

  return (
    <div className={
      maximized
        ? 'flex flex-col bg-gray-950 fixed inset-3 z-50 rounded-xl border border-gray-700 shadow-2xl overflow-hidden'
        : 'flex flex-col h-full min-h-0 bg-gray-950 overflow-hidden'
    }>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/50 shrink-0">
        <span className="text-xs font-semibold text-gray-300">🧩 Blocks</span>
        {started && (
          <>
            <button
              onClick={() => setMaximized(m => !m)}
              title={maximized ? 'Restore to panel' : 'Maximize editor'}
              className="ml-1 text-[11px] text-gray-400 hover:text-white px-1.5 py-0.5 rounded border border-gray-700/50 hover:border-gray-500 transition-colors leading-none"
            >
              {maximized ? '🗗 Restore' : '🗖 Maximize'}
            </button>
            <button
              onClick={resetBlocks}
              title="Clear all blocks back to a clean start"
              className="text-[11px] text-gray-400 hover:text-red-300 px-1.5 py-0.5 rounded border border-gray-700/50 hover:border-red-500/50 transition-colors leading-none"
            >
              ↺ Reset
            </button>
          </>
        )}
        <div className={`ml-auto w-2 h-2 rounded-full ${simulation.running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
        <span className="text-[10px] text-gray-500">{simulation.running ? 'Running' : 'Idle'}</span>
      </div>

      {/* Workspace — Blockly fills an absolutely-positioned box inside a sized,
          clipped host so its size is unambiguous and never overflows the panel */}
      {started ? (
        <div ref={hostRef} className="relative flex-1 min-h-0 overflow-hidden">
          <div ref={blocklyDiv} className="absolute inset-0" />
        </div>
      ) : (
        <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-4xl opacity-40">🧩</div>
          <div className="text-xs text-gray-400 max-w-[220px]">
            Visual Arduino blocks. Loads a ~700&nbsp;KB editor — click to start.
          </div>
          <button
            onClick={() => setStarted(true)}
            className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
          >
            Load Block Editor
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 px-3 py-2 border-t border-gray-700/50 shrink-0">
        {simulation.running ? (
          <button onClick={handleStop}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors">
            <span>■</span> Stop
          </button>
        ) : (
          <button onClick={handleRun}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-medium transition-colors">
            <span>▶</span> Run Blocks
          </button>
        )}
        <button onClick={sendToEditor}
          title="Copy the generated C++ into the Code tab"
          className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-medium transition-colors">
          {'</>'} To Code
        </button>
      </div>

      {error && (
        <div className="mx-3 mb-2 px-2.5 py-2 bg-red-900/30 border border-red-700/50 rounded text-[11px] text-red-300 font-mono shrink-0 leading-snug">
          <div className="text-red-400 font-semibold text-[10px] uppercase tracking-wide mb-0.5">Error</div>
          {error}
        </div>
      )}

      {/* Live generated-code preview */}
      <div className="px-3 pb-3 shrink-0">
        <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Generated C++</div>
        <pre className="bg-gray-900 text-green-400 font-mono text-[10px] p-2 rounded border border-gray-700/40 h-24 overflow-auto whitespace-pre-wrap break-words">
          {code || <span className="text-gray-600">Drag blocks to generate code…</span>}
        </pre>
      </div>
    </div>
  )
}
