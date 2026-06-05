import { useState, useCallback, useEffect } from 'react'
import { driveManager } from '../managers/DriveManager.js'
import { simulationManager } from '../managers/SimulationManager.js'
import { useUiStore } from '../stores/uiStore.js'
import { useSceneStore } from '../stores/sceneStore.js'

const PRESETS = [
  { id: 'fwd',  label: '↑', title: 'Forward',     l:  100, r:  100 },
  { id: 'tl',   label: '↰', title: 'Turn Left',    l:   20, r:  100 },
  { id: 'tr',   label: '↱', title: 'Turn Right',   l:  100, r:   20 },
  { id: 'sl',   label: '⟲', title: 'Spin Left',    l: -100, r:  100 },
  { id: 'sr',   label: '⟳', title: 'Spin Right',   l:  100, r: -100 },
  { id: 'bwd',  label: '↓', title: 'Backward',     l: -100, r: -100 },
  { id: 'stop', label: '■', title: 'Stop',         l:    0, r:    0 },
]

function Btn({ label, title, active, red, onClick }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`py-1.5 rounded text-sm font-bold transition-colors select-none ${
        red
          ? active ? 'bg-red-600 text-white' : 'bg-red-900/60 hover:bg-red-700 text-red-300'
          : active ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
      }`}
    >
      {label}
    </button>
  )
}

export default function DrivePanel() {
  const setSimActive = useUiStore(s => s.setSimActive)
  const updateObject = useSceneStore(s => s.updateObject)

  const [leftVal,      setLeftVal]      = useState(0)
  const [rightVal,     setRightVal]     = useState(0)
  const [activePreset, setActivePreset] = useState(null)
  const [codeRunning,  setCodeRunning]  = useState(false)

  // Push slider values into driveManager whenever they change
  useEffect(() => {
    driveManager.manualSpeeds.l = leftVal
    driveManager.manualSpeeds.r = rightVal
  }, [leftVal, rightVal])

  // Poll simulation running state for the "code active" badge
  useEffect(() => {
    const id = setInterval(() => setCodeRunning(simulationManager.isRunning()), 150)
    return () => clearInterval(id)
  }, [])

  const applyPreset = useCallback((p) => {
    setLeftVal(p.l)
    setRightVal(p.r)
    setActivePreset(p.id)
    driveManager.manualSpeeds.l = p.l
    driveManager.manualSpeeds.r = p.r
  }, [])

  const handleSlider = useCallback((side, val) => {
    if (side === 'l') setLeftVal(val)
    else              setRightVal(val)
    setActivePreset(null)
  }, [])

  const handleExit = useCallback(() => {
    // Stop any running code before exiting
    if (simulationManager.isRunning()) simulationManager.stop()
    driveManager.manualSpeeds = { l: 0, r: 0 }
    setSimActive(false)
    // App.jsx effect handles the actual driveManager.exit() call
  }, [setSimActive])

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-gray-950/97 border-t border-cyan-700/40 shadow-2xl">

      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-900/80 border-b border-gray-700/40">
        <span className="text-cyan-400 text-[11px] font-bold tracking-wider">⚙ SIMULATION</span>
        {codeRunning && (
          <span className="flex items-center gap-1.5 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse inline-block" />
            Code driving motors
          </span>
        )}
        {!codeRunning && (leftVal !== 0 || rightVal !== 0) && (
          <span className="text-[10px] text-yellow-400">Manual drive active</span>
        )}
        <button
          onClick={handleExit}
          className="ml-auto text-[10px] text-gray-400 hover:text-red-300 transition-colors px-2.5 py-0.5 rounded border border-gray-600/50 hover:border-red-500/70"
        >
          ✕ Exit Simulation
        </button>
      </div>

      {/* Body */}
      <div className="flex items-center gap-5 px-5 py-3">

        {/* Motor speed sliders */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Manual Motor Speeds</div>
          {[['L Motor', leftVal, 'l'], ['R Motor', rightVal, 'r']].map(([lbl, val, side]) => (
            <div key={side} className="flex items-center gap-2">
              <span className="text-[9px] text-gray-400 w-12 shrink-0">{lbl}</span>
              <span className="text-[9px] text-gray-600 w-5 text-right">-100</span>
              <input
                type="range" min="-100" max="100" step="5" value={val}
                onChange={e => handleSlider(side, parseInt(e.target.value, 10))}
                className="flex-1 h-1.5 accent-cyan-400 cursor-pointer"
              />
              <span className="text-[9px] text-gray-600 w-5">+100</span>
              <span className={`text-[10px] font-mono font-bold w-10 text-right shrink-0 ${
                val > 0 ? 'text-green-400' : val < 0 ? 'text-red-400' : 'text-gray-600'
              }`}>
                {val > 0 ? '+' : ''}{val}%
              </span>
            </div>
          ))}
        </div>

        <div className="w-px bg-gray-700/50 self-stretch shrink-0" />

        {/* D-pad preset grid */}
        <div className="shrink-0">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5 text-center">Quick Drive</div>
          {/* Row 1: blank | Forward | blank */}
          <div className="grid grid-cols-3 gap-1 w-[88px]">
            <div />
            <Btn label="↑" title="Forward" active={activePreset === 'fwd'}
              onClick={() => applyPreset(PRESETS.find(p => p.id === 'fwd'))} />
            <div />

            {/* Row 2: Spin L | ← (turn left) | Spin R  -- using arrows that map: tl=left col, sr=right col */}
            <Btn label="↰" title="Turn Left"  active={activePreset === 'tl'}
              onClick={() => applyPreset(PRESETS.find(p => p.id === 'tl'))} />
            <Btn label="⟲" title="Spin Left"  active={activePreset === 'sl'}
              onClick={() => applyPreset(PRESETS.find(p => p.id === 'sl'))} />
            <Btn label="↱" title="Turn Right" active={activePreset === 'tr'}
              onClick={() => applyPreset(PRESETS.find(p => p.id === 'tr'))} />

            {/* Row 3: ⟳ | Stop | blank */}
            <Btn label="⟳" title="Spin Right" active={activePreset === 'sr'}
              onClick={() => applyPreset(PRESETS.find(p => p.id === 'sr'))} />
            <Btn label="■" title="Stop" red active={activePreset === 'stop'}
              onClick={() => applyPreset(PRESETS.find(p => p.id === 'stop'))} />
            <div />

            {/* Row 4: blank | Backward | blank */}
            <div />
            <Btn label="↓" title="Backward" active={activePreset === 'bwd'}
              onClick={() => applyPreset(PRESETS.find(p => p.id === 'bwd'))} />
            <div />
          </div>
        </div>

        <div className="w-px bg-gray-700/50 self-stretch shrink-0" />

        {/* Code hint */}
        <div className="shrink-0 text-[9px] text-gray-600 max-w-[140px] space-y-1">
          <div className="text-gray-400 font-medium text-[10px]">Code-driven mode</div>
          <div>Write Arduino code in the <span className="text-cyan-400">{'{} Code'}</span> tab then press <span className="text-green-400">▶ Run</span></div>
          <div className="font-mono text-[8px] text-green-500/80 mt-1">analogWrite(pin, 255);</div>
          <div className="font-mono text-[8px] text-green-500/80">// 0=stop · 255=full fwd</div>
          <div className="mt-1 text-gray-700">Sliders take over when code stops</div>
        </div>

      </div>
    </div>
  )
}
