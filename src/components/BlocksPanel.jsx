import Icon from './ui/Icon.jsx'
import { useEffect, useRef, useState } from 'react'
import * as Blockly from 'blockly'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { simulationManager } from '../managers/SimulationManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { defineArduinoBlocks, ARDUINO_TOOLBOX } from '../blockly/arduinoBlocks.js'
import { arduinoGenerator } from '../blockly/arduinoGenerator.js'
import { analyzeArduino } from '../utils/arduinoDiagnostics.js'
import { enterSimForCode } from '../managers/simForCode.js'
import CompilerOutput from './CompilerOutput.jsx'

// A fresh workspace starts with a setup/loop container.
const STARTER = {
  blocks: {
    languageVersion: 0,
    blocks: [{ type: 'arduino_setup_loop', x: 40, y: 40 }],
  },
}

export default function BlocksPanel({ workspace = false }) {
  const hostRef    = useRef(null)
  const blocklyDiv = useRef(null)
  const wsRef      = useRef(null)
  const [code, setLocalCode] = useState('')
  const [error, setError]    = useState(null)
  const [diag, setDiag]      = useState(null)   // same compiler diagnostics as the Code editor
  // Gate Blockly init behind a click — except in the main workspace, where opening
  // Code → Blocks is itself the deliberate action (Blockly is lazy-loaded).
  const [started, setStarted] = useState(workspace)
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
      // Blockly's default sounds load from blockly-demo.appspot.com, which the
      // app's CSP (media-src 'self') blocks — a console error on every drag.
      sounds: false,
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

  const handleRun = async () => {
    setError(null)
    setCode(code)
    window.dispatchEvent(new Event('constructa:code-run'))   // → community popup (first run only)
    const objects = useSceneStore.getState().objects
    // Same compiler diagnostics as the text editor, run on the generated C++.
    const board = objects.some(o => o.type === 'subo') ? 'subo' : 'arduino'
    const report = analyzeArduino(code, { board })
    setDiag(report)
    if (!report.ok) return   // blocking errors — withhold execution
    await enterSimForCode()   // robot moves only under the simulator (no-op if on / no actuators)
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
      <div className="flex items-center gap-2 px-3 h-11 shrink-0" style={{ background: 'rgb(var(--g-900))', borderBottom: '1px solid rgb(var(--g-700))' }}>
        {/* Run is the main action of this screen, so it leads the bar. */}
        {simulation.running ? (
          <button onClick={handleStop} className="ui-btn" style={{ color: '#b91c1c', borderColor: 'rgb(220 38 38 / 0.45)' }}>
            <Icon name="stop" size={13} /> Stop
          </button>
        ) : (
          <button onClick={handleRun} className="ui-btn ui-btn-primary">
            <Icon name="play" size={13} /> Run blocks
          </button>
        )}
        <button onClick={sendToEditor}
          title="Copy the C++ these blocks make into the C++ tab (replaces the sketch there)"
          className="ui-btn">
          Use in C++
        </button>
        {started && (
          <>
            {!workspace && <button
              onClick={() => setMaximized(m => !m)}
              title={maximized ? 'Restore to panel' : 'Maximize editor'}
              className="ui-btn ui-btn-quiet"
            >
              {maximized ? 'Restore' : 'Maximize'}
            </button>}
            <button
              onClick={resetBlocks}
              title="Clear all blocks back to a clean start"
              className="ui-btn ui-btn-quiet"
            >
              Clear
            </button>
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-gray-500">
          <span className={`w-2 h-2 rounded-full ${simulation.running ? 'bg-green-500' : 'bg-gray-600'}`} />
          {simulation.running ? 'Running' : 'Stopped'}
        </span>
      </div>

      {/* Workspace — Blockly fills an absolutely-positioned box inside a sized,
          clipped host so its size is unambiguous and never overflows the panel */}
      {started ? (
        <div ref={hostRef} className="relative flex-1 min-h-0 overflow-hidden">
          <div ref={blocklyDiv} className="absolute inset-0" />
        </div>
      ) : (
        <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-[13px] text-gray-400 max-w-[260px]">
            Program your robot by snapping blocks together. No typing needed.
          </div>
          <button onClick={() => setStarted(true)} className="ui-btn ui-btn-primary">
            Open the block editor
          </button>
        </div>
      )}

      {/* Compiler diagnostics on the generated C++ (line numbers refer to the preview below) */}
      <CompilerOutput result={diag} />

      {error && (
        <div className="mx-3 mb-2 px-2.5 py-2 bg-red-900/30 border border-red-700/50 rounded text-[11px] text-red-300 font-mono shrink-0 leading-snug">
          <div className="text-red-400 font-semibold text-[11px] mb-0.5">Error while running</div>
          {error}
        </div>
      )}

      {/* Live generated-code preview */}
      <div className="px-3 pb-3 shrink-0">
        <div className="text-[12px] font-medium text-gray-400 mb-1 mt-2">C++ made by your blocks</div>
        <pre className="bg-gray-900 text-green-400 font-mono text-[10px] p-2 rounded border border-gray-700/40 h-24 overflow-auto whitespace-pre-wrap break-words">
          {code || <span className="text-gray-600">Drag blocks to generate code…</span>}
        </pre>
      </div>
    </div>
  )
}
