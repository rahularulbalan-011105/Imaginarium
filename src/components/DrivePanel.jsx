import { useState, useEffect, useCallback, useRef } from 'react'
import { simulationManager } from '../managers/SimulationManager.js'
import { objectManager } from '../managers/ObjectManager.js'
import { useUiStore } from '../stores/uiStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore, SENSOR_TYPES } from '../stores/electronicsStore.js'
import { usePhysicsStore } from '../stores/physicsStore.js'
import { driveManager } from '../managers/DriveManager.js'
import { ENVIRONMENTS } from '../managers/physics/EnvironmentConfig.js'

const LEGGED_SPEED = 8     // scene units/s
const LEGGED_TURN  = 1.8   // rad/s

export default function DrivePanel() {
  const setSimActive  = useUiStore(s => s.setSimActive)
  const objects       = useSceneStore(s => s.objects)
  const code          = useElectronicsStore(s => s.code)
  const connections   = useElectronicsStore(s => s.connections)
  const startSim      = useElectronicsStore(s => s.startSimulation)
  const stopSim       = useElectronicsStore(s => s.stopSimulation)
  const setMotorSpeed = useElectronicsStore(s => s.setMotorSpeed)
  const sensorValues  = useElectronicsStore(s => s.sensorValues)
  const setSensorValue = useElectronicsStore(s => s.setSensorValue)
  const autoSense     = useElectronicsStore(s => s.autoSense)
  const setAutoSense  = useElectronicsStore(s => s.setAutoSense)

  const environment     = usePhysicsStore(s => s.environment)
  const setEnvironment  = usePhysicsStore(s => s.setEnvironment)
  const wind            = usePhysicsStore(s => s.wind)
  const airDensity      = usePhysicsStore(s => s.airDensity)
  const gravity         = usePhysicsStore(s => s.gravity)
  const isLeggedRobot   = usePhysicsStore(s => s.isLeggedRobot)
  const setLeggedControl = usePhysicsStore(s => s.setLeggedControl)

  const [running,   setRunning]   = useState(false)
  const [error,     setError]     = useState(null)
  const [serialLog, setSerialLog] = useState('')
  const [robotMass, setRobotMass] = useState(null)
  const [oledText,  setOledText]  = useState('')
  const [buzzFreq,  setBuzzFreq]  = useState(0)

  const keysHeld   = useRef(new Set())
  const btnsHeld   = useRef(new Set())   // button IDs held via mouse

  // Poll running state
  useEffect(() => {
    const id = setInterval(() => setRunning(simulationManager.isRunning()), 100)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setRobotMass(driveManager.isActive ? driveManager._totalMass : null)
    }, 500)
    return () => clearInterval(id)
  }, [])


  // ── Legged robot: arrow key controls ────────────────────────────────────────
  const applyLeggedControl = useCallback(() => {
    const k = keysHeld.current
    const b = btnsHeld.current
    const fwd  = k.has('ArrowUp')    || b.has('fwd')
    const back = k.has('ArrowDown')  || b.has('back')
    const left = k.has('ArrowLeft')  || b.has('left')
    const right= k.has('ArrowRight') || b.has('right')
    const speed = (fwd ? LEGGED_SPEED : 0) + (back ? -LEGGED_SPEED : 0)
    const turn  = (left ? LEGGED_TURN : 0) + (right ? -LEGGED_TURN : 0)
    setLeggedControl(speed, turn)
  }, [setLeggedControl])

  useEffect(() => {
    if (!isLeggedRobot) return
    const onKeyDown = (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault()
        keysHeld.current.add(e.key)
        applyLeggedControl()
      }
    }
    const onKeyUp = (e) => {
      keysHeld.current.delete(e.key)
      applyLeggedControl()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
      keysHeld.current.clear()
      setLeggedControl(0, 0)
    }
  }, [isLeggedRobot, applyLeggedControl, setLeggedControl])

  const btnDown = (id) => { btnsHeld.current.add(id);    applyLeggedControl() }
  const btnUp   = (id) => { btnsHeld.current.delete(id); applyLeggedControl() }

  // ── Wheeled: code run/stop ───────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    setError(null)
    setSerialLog('')
    setOledText('')
    setBuzzFreq(0)
    simulationManager.configure(
      connections,
      objects,
      setMotorSpeed,
      (msg) => { setError(msg); stopSim() },
      (out) => setSerialLog(p => {
        const next = p + out
        return next.length > 2000 ? next.slice(next.length - 2000) : next
      }),
      (ledId, brightness) => objectManager.animateLed(ledId, brightness),
      undefined,                              // onServoAngle (servoAngles read in the render loop)
      (text) => setOledText(text),            // onOled  → OLED screen readout
      (id, freq) => setBuzzFreq(freq),        // onBuzzer → buzzer indicator
    )
    const err = simulationManager.start(code)
    if (err) setError(err.error)
    else     startSim()
  }, [code, connections, objects, startSim, stopSim, setMotorSpeed])

  const handleStop = useCallback(() => {
    simulationManager.stop()
    objectManager.resetAllLeds?.()
    stopSim()
    setError(null)
    setOledText('')
    setBuzzFreq(0)
  }, [stopSim])

  const handleExit = useCallback(() => {
    if (simulationManager.isRunning()) { simulationManager.stop(); stopSim() }
    setSimActive(false)
  }, [setSimActive, stopSim])

  const hasConnections = Object.keys(connections).length > 0
  const hasMotors = objects.some(o =>
    o.type === 'motor' || o.type === 'motor_bo' || o.type === 'motor_dc')

  // Legged robot info from driveManager
  const legCount  = isLeggedRobot ? (driveManager._leggedSystem?.numLegs ?? 0)  : 0
  const gaitLabel = isLeggedRobot ? (driveManager._leggedSystem?.gaitType ?? '') : ''

  // Peripherals present in the scene
  const sensors   = objects.filter(o => SENSOR_TYPES.has(o.type))
  const hasOled   = objects.some(o => o.type === 'oled')
  const hasBuzzer = objects.some(o => o.type === 'buzzer')

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-gray-950/97 border-t border-yellow-700/40 shadow-2xl">

      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-900/80 border-b border-gray-700/40">
        <span className="text-yellow-400 text-[11px] font-bold tracking-wider">
          {isLeggedRobot ? '🕷 LEGGED SIMULATION' : '⚙ SIMULATION MODE'}
        </span>
        {running && !isLeggedRobot && (
          <span className="flex items-center gap-1.5 text-[10px] text-green-400">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse inline-block" />
            Code running
          </span>
        )}
        <button
          onClick={handleExit}
          className="ml-auto text-[10px] text-gray-400 hover:text-red-300 transition-colors px-2.5 py-0.5 rounded border border-gray-600/50 hover:border-red-500/70"
        >
          ✕ Exit Simulation
        </button>
      </div>

      {/* Physics status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1 bg-gray-950/70 border-b border-gray-800/60 text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">Environment</span>
          <select
            value={environment}
            onChange={e => setEnvironment(e.target.value)}
            className="bg-gray-800 text-gray-200 border border-gray-700/60 rounded px-1.5 py-0.5 text-[10px] focus:outline-none cursor-pointer"
          >
            {Object.entries(ENVIRONMENTS).map(([key, env]) => (
              <option key={key} value={key}>{env.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">g =</span>
          <span className="text-orange-400 font-mono">{Math.abs(gravity).toFixed(2)} m/s²</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-500">ρ =</span>
          <span className="text-blue-400 font-mono">{airDensity.toFixed(3)} kg/m³</span>
        </div>
        {robotMass !== null && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">mass</span>
            <span className="text-cyan-400 font-mono">{robotMass.toFixed(3)} kg</span>
          </div>
        )}
        {wind.speed > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">Wind</span>
            <span className="text-teal-400 font-mono">{wind.speed.toFixed(1)} m/s</span>
          </div>
        )}
      </div>

      {/* ── Peripherals: live sensor inputs + OLED + buzzer ───────────────────── */}
      {(sensors.length > 0 || hasOled || hasBuzzer) && (
        <div className="flex flex-wrap items-end gap-4 px-4 py-2 bg-gray-950/60 border-b border-gray-800/60">
          {sensors.some(s => s.type === 'ir_sensor' || s.type === 'ultrasonic') && (
            <div className="flex flex-col">
              <div className="text-[9px] text-gray-500 mb-0.5">Detection</div>
              <button onClick={() => setAutoSense(a => !a)}
                title="Auto = sensors detect shapes you bring near them in the scene. Manual = set values by hand."
                className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${autoSense ? 'bg-cyan-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {autoSense ? '🎯 Auto (scene)' : '✋ Manual'}
              </button>
            </div>
          )}
          {sensors.map(s => (
            <SensorControl key={s.id} obj={s} value={sensorValues[s.id]} auto={autoSense} onChange={v => setSensorValue(s.id, v)} />
          ))}
          {hasOled && <OledScreen text={oledText} />}
          {hasBuzzer && (
            <div className="flex flex-col">
              <div className="text-[9px] text-gray-500 mb-0.5">🔔 Buzzer</div>
              <div className={`px-2 py-1 rounded text-[10px] font-mono ${buzzFreq > 0 ? 'bg-amber-700 text-white animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
                {buzzFreq > 0 ? `♪ ${Math.round(buzzFreq)} Hz` : 'silent'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Legged controls ─────────────────────────────────────────────────── */}
      {isLeggedRobot ? (
        <div className="flex items-center gap-5 px-4 py-2.5">
          {/* D-pad */}
          <div className="shrink-0 grid grid-cols-3 grid-rows-3 gap-1 w-[88px] h-[88px]">
            <div />
            <button
              onMouseDown={() => btnDown('fwd')}  onMouseUp={() => btnUp('fwd')}
              onMouseLeave={() => btnUp('fwd')}   onTouchStart={() => btnDown('fwd')} onTouchEnd={() => btnUp('fwd')}
              className="flex items-center justify-center bg-gray-700 hover:bg-green-700 active:bg-green-600 rounded text-white text-[14px] select-none cursor-pointer transition-colors"
            >▲</button>
            <div />
            <button
              onMouseDown={() => btnDown('left')} onMouseUp={() => btnUp('left')}
              onMouseLeave={() => btnUp('left')}  onTouchStart={() => btnDown('left')} onTouchEnd={() => btnUp('left')}
              className="flex items-center justify-center bg-gray-700 hover:bg-green-700 active:bg-green-600 rounded text-white text-[14px] select-none cursor-pointer transition-colors"
            >◄</button>
            <div className="flex items-center justify-center bg-gray-800/60 rounded text-[9px] text-gray-600">●</div>
            <button
              onMouseDown={() => btnDown('right')} onMouseUp={() => btnUp('right')}
              onMouseLeave={() => btnUp('right')}  onTouchStart={() => btnDown('right')} onTouchEnd={() => btnUp('right')}
              className="flex items-center justify-center bg-gray-700 hover:bg-green-700 active:bg-green-600 rounded text-white text-[14px] select-none cursor-pointer transition-colors"
            >►</button>
            <div />
            <button
              onMouseDown={() => btnDown('back')} onMouseUp={() => btnUp('back')}
              onMouseLeave={() => btnUp('back')}  onTouchStart={() => btnDown('back')} onTouchEnd={() => btnUp('back')}
              className="flex items-center justify-center bg-gray-700 hover:bg-green-700 active:bg-green-600 rounded text-white text-[14px] select-none cursor-pointer transition-colors"
            >▼</button>
            <div />
          </div>

          {/* Info / hints */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-green-400">
                {legCount > 0 ? `${legCount}-legged robot` : 'Legged robot'}
              </span>
              {gaitLabel && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-800/50 border border-purple-700/50 text-purple-300 uppercase tracking-wider">
                  {gaitLabel}
                </span>
              )}
            </div>
            <div className="text-[10px] text-gray-400 space-y-0.5">
              <div>Hold <kbd className="px-1 py-0.5 text-[9px] bg-gray-700 rounded">↑↓←→</kbd> arrow keys to walk · buttons above work too</div>
              <div className="text-gray-500">Gait runs automatically — no code needed</div>
              {running && (
                <div className="text-indigo-400">Code running · servos may override gait</div>
              )}
            </div>
          </div>

          {/* Optional: also allow running code for custom gait algorithms */}
          <div className="shrink-0 flex flex-col gap-1.5">
            <button
              onClick={running ? handleStop : handleRun}
              disabled={!running && !hasConnections}
              className={`px-3 py-1.5 rounded text-[10px] font-bold transition-colors ${
                running
                  ? 'bg-red-700 hover:bg-red-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
              title={hasConnections ? 'Run custom servo code' : 'No servo connections found'}
            >
              {running ? '⏹ Stop Code' : '▶ Run Code'}
            </button>
            {error && <div className="text-red-400 text-[9px] max-w-[140px] break-all">{error}</div>}
          </div>
        </div>

      ) : (
        /* ── Wheeled controls ─────────────────────────────────────────────── */
        <div className="flex items-center gap-5 px-4 py-2.5">
          <button
            onClick={running ? handleStop : handleRun}
            disabled={!running && !hasConnections && !hasMotors}
            className={`shrink-0 px-5 py-2 rounded-lg text-sm font-bold transition-colors ${
              running
                ? 'bg-red-700 hover:bg-red-600 text-white'
                : 'bg-green-700 hover:bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {running ? '⏹ Stop Code' : '▶ Run Code'}
          </button>

          <div className="flex-1 min-w-0">
            {error ? (
              <div className="text-red-400 text-[10px] font-mono break-all">{error}</div>
            ) : running ? (
              <div className="text-[10px] text-gray-400 space-y-0.5">
                <div>Motors spin · robot drives based on <code className="text-green-400">analogWrite(pin, speed)</code></div>
                {serialLog && (
                  <div className="font-mono text-cyan-400/80 truncate">{serialLog.slice(-120)}</div>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-gray-500 space-y-0.5">
                {!hasMotors && <div className="text-yellow-500/80">⚠ No motors — add motor_bo or motor_dc</div>}
                {hasMotors && !hasConnections && <div className="text-yellow-500/80">⚠ Motors not wired to Arduino</div>}
                {hasMotors && hasConnections && <div>Write Arduino code · click <span className="text-green-400">▶ Run Code</span></div>}
                <div className="text-gray-600">Both motors forward → straight · one faster → turn</div>
              </div>
            )}
          </div>

          <div className="shrink-0 text-[9px] font-mono text-slate-600 text-right space-y-0.5 border-l border-gray-700/50 pl-4">
            <div className="text-gray-500 font-sans font-medium mb-1">Quick reference</div>
            <div><span className="text-blue-400">analogWrite</span>(pin, <span className="text-green-400">255</span>);  <span className="text-gray-600">// full fwd</span></div>
            <div><span className="text-blue-400">analogWrite</span>(pin, <span className="text-yellow-400">128</span>);  <span className="text-gray-600">// half</span></div>
            <div><span className="text-blue-400">analogWrite</span>(pin,   <span className="text-red-400">0</span>);  <span className="text-gray-600">// stop</span></div>
            <div><span className="text-blue-400">delay</span>(<span className="text-orange-400">2000</span>);         <span className="text-gray-600">// 2 s</span></div>
          </div>
        </div>
      )}
    </div>
  )
}

// Live input control for a sensor — drives what digitalRead/analogRead/pulseIn return.
// In Auto mode IR/ultrasonic are read-only (driven by scene raycast); gas is always manual.
function SensorControl({ obj, value, onChange, auto }) {
  if (obj.type === 'ir_sensor') {
    const on = !!value
    return (
      <div className="flex flex-col">
        <div className="text-[9px] text-gray-500 mb-0.5">👁 {obj.name}</div>
        {auto ? (
          <div className={`px-2 py-1 rounded text-[10px] font-semibold ${on ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-500'}`}>
            {on ? 'Object detected' : 'Clear'}
          </div>
        ) : (
          <button onClick={() => onChange(on ? 0 : 1)}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${on ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            {on ? 'Object detected' : 'Clear (no object)'}
          </button>
        )}
      </div>
    )
  }
  if (obj.type === 'ultrasonic') {
    const cm = value ?? 100
    return (
      <div className="flex flex-col">
        <div className="text-[9px] text-gray-500 mb-0.5">📡 {obj.name} · <span className="text-teal-300 font-mono">{cm} cm</span></div>
        {auto ? (
          <div className="px-2 py-1 rounded text-[10px] font-mono bg-gray-800 text-teal-300 min-w-[80px]">{cm >= 400 ? 'no echo' : `${cm} cm`}</div>
        ) : (
          <input type="range" min="2" max="400" value={cm} onChange={e => onChange(+e.target.value)} className="w-36 accent-teal-500" />
        )}
      </div>
    )
  }
  if (obj.type === 'gas_sensor') {
    const g = value ?? 100
    return (
      <div className="flex flex-col">
        <div className="text-[9px] text-gray-500 mb-0.5">💨 {obj.name} · <span className="text-orange-300 font-mono">{g}</span></div>
        <input type="range" min="0" max="1023" value={g} onChange={e => onChange(+e.target.value)} className="w-36 accent-orange-500" />
      </div>
    )
  }
  return null
}

// OLED screen readout — mirrors what display.print/println + display() pushed.
function OledScreen({ text }) {
  return (
    <div className="flex flex-col">
      <div className="text-[9px] text-gray-500 mb-0.5">📺 OLED</div>
      <pre className="bg-black text-cyan-300 font-mono text-[9px] leading-tight rounded px-2 py-1 border border-cyan-900/60 min-w-[150px] min-h-[46px] max-h-[60px] whitespace-pre-wrap overflow-hidden">{text || ''}</pre>
    </div>
  )
}
