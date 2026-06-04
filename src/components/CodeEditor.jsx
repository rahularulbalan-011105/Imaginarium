import { useEffect, useRef, useState } from 'react'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { simulationManager } from '../managers/SimulationManager.js'
import { objectManager } from '../managers/ObjectManager.js'

export default function CodeEditor() {
  const code           = useElectronicsStore((s) => s.code)
  const setCode        = useElectronicsStore((s) => s.setCode)
  const simulation     = useElectronicsStore((s) => s.simulation)
  const connections    = useElectronicsStore((s) => s.connections)
  const startSimulation = useElectronicsStore((s) => s.startSimulation)
  const stopSimulation  = useElectronicsStore((s) => s.stopSimulation)
  const setMotorSpeed   = useElectronicsStore((s) => s.setMotorSpeed)
  const objects         = useSceneStore((s) => s.objects)

  const [error, setError]         = useState(null)
  const [serialLog, setSerialLog] = useState('')
  const serialRef = useRef(null)

  // Auto-scroll serial monitor when new output arrives
  useEffect(() => {
    if (serialRef.current) serialRef.current.scrollTop = serialRef.current.scrollHeight
  }, [serialLog])

  const hasConnections = Object.keys(connections).length > 0
  const hasMotors  = objects.some(o => o.type === 'motor' || o.type === 'motor_bo' || o.type === 'motor_dc')
  const hasArduino = objects.some(o => o.type === 'arduino')

  const handleRun = () => {
    setError(null)
    setSerialLog('')

    simulationManager.configure(
      connections,
      objects,
      setMotorSpeed,
      (errMsg) => { setError(errMsg); stopSimulation() },
      (output) => {
        setSerialLog(prev => {
          const next = prev + output
          return next.length > 4000 ? next.slice(next.length - 4000) : next
        })
      },
      (ledId, brightness) => objectManager.animateLed(ledId, brightness)
    )

    const err = simulationManager.start(code)
    if (err) {
      setError(err.error)
    } else {
      startSimulation()
    }
  }

  const handleStop = () => {
    simulationManager.stop()   // also fires onLedBrightness(id, 0) for active LEDs
    objectManager.resetAllLeds()
    stopSimulation()
    setError(null)
  }

  const noArduino    = !hasArduino
  const noMotor      = !hasMotors
  const noConnection = hasArduino && hasMotors && !hasConnections

  return (
    <div className="flex flex-col h-full bg-gray-950">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/50 shrink-0">
        <span className="text-xs font-semibold text-gray-300">Arduino Code</span>
        <div className={`ml-auto w-2 h-2 rounded-full ${simulation.running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
        <span className="text-[10px] text-gray-500">{simulation.running ? 'Running' : 'Idle'}</span>
      </div>

      {/* Prerequisite hints */}
      {(noArduino || noMotor || noConnection) && (
        <div className="px-3 py-2 space-y-1 shrink-0 border-b border-gray-700/30">
          {noArduino && <Hint icon="⚠" text="Add an Arduino to the scene" />}
          {noMotor   && <Hint icon="⚠" text="Add a Motor to the scene" />}
          {!noArduino && !noMotor && noConnection && (
            <Hint icon="⚠" text="Draw a wire from an Arduino pin to the Motor terminal" />
          )}
        </div>
      )}

      {/* Code textarea */}
      <textarea
        value={code}
        onChange={e => setCode(e.target.value)}
        spellCheck={false}
        className="flex-1 bg-gray-950 text-green-300 font-mono text-xs p-3 resize-none focus:outline-none border-0 leading-relaxed min-h-0"
        style={{ fontFamily: "'Fira Code', 'Consolas', monospace", tabSize: 2 }}
      />

      {/* Run/Stop controls */}
      <div className="flex gap-2 px-3 py-2 border-t border-gray-700/50 shrink-0">
        {simulation.running ? (
          <button
            onClick={handleStop}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors"
          >
            <span>■</span> Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!hasArduino || !hasMotors || !hasConnections}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
          >
            <span>▶</span> Run
          </button>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-3 mb-2 px-2.5 py-2 bg-red-900/30 border border-red-700/50 rounded text-[11px] text-red-300 font-mono shrink-0 leading-snug">
          <div className="text-red-400 font-semibold text-[10px] uppercase tracking-wide mb-0.5">Error</div>
          {error}
        </div>
      )}

      {/* Component state indicators */}
      {simulation.running && (
        Object.keys(simulation.motorSpeeds).length > 0 ||
        Object.keys(simulation.motorSpeeds).length === 0
      ) && (
        <div className="px-3 pb-1 shrink-0 space-y-1">
          {Object.keys(simulation.motorSpeeds).length > 0 && (
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Motors</div>
          )}
          {Object.entries(simulation.motorSpeeds).map(([id, speed]) => {
            const obj = objects.find(o => o.id === id)
            return (
              <div key={id} className="flex items-center gap-2 text-[10px] text-gray-400">
                <span className="truncate max-w-[70px]">{obj?.name ?? id}</span>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 transition-all duration-100" style={{ width: `${(speed / 255) * 100}%` }} />
                </div>
                <span className="w-7 text-right tabular-nums">{speed}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Serial monitor */}
      {(simulation.running || serialLog) && (
        <div className="px-3 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Serial Monitor</span>
            {serialLog && (
              <button
                onClick={() => setSerialLog('')}
                className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <pre
            ref={serialRef}
            className="bg-gray-900 text-green-400 font-mono text-[10px] p-2 rounded border border-gray-700/40 h-20 overflow-y-auto whitespace-pre-wrap break-words"
          >
            {serialLog || <span className="text-gray-600 not-italic">No output yet…</span>}
          </pre>
        </div>
      )}
    </div>
  )
}

function Hint({ icon, text }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-yellow-500">
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  )
}
