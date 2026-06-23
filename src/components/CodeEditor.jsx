import { useEffect, useRef, useState } from 'react'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { simulationManager } from '../managers/SimulationManager.js'
import { objectManager } from '../managers/ObjectManager.js'

const TEMPLATES = [
  {
    label: 'Motor ramp',
    code: `// Motor TERM_A → Pin ~3, TERM_B → GND
int motorPin = 3;

void setup() {
  pinMode(motorPin, OUTPUT);
}

void loop() {
  analogWrite(motorPin, 220);
  delay(2000);
  analogWrite(motorPin, 80);
  delay(1000);
  analogWrite(motorPin, 0);
  delay(1000);
}`,
  },
  {
    label: 'Servo sweep',
    code: `// Servo SIGNAL → Pin ~9, VCC → 5V, GND → GND
#include <Servo.h>
Servo myServo;

void setup() {
  myServo.attach(9);
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 5) {
    myServo.write(angle);
    delay(30);
  }
  for (int angle = 180; angle >= 0; angle -= 5) {
    myServo.write(angle);
    delay(30);
  }
}`,
  },
  {
    label: 'LED blink',
    code: `// LED ANODE → Pin ~5, CATHODE → GND
int ledPin = 5;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  analogWrite(ledPin, 200);
  delay(500);
  analogWrite(ledPin, 0);
  delay(500);
}`,
  },
]

export default function CodeEditor() {
  const code           = useElectronicsStore((s) => s.code)
  const setCode        = useElectronicsStore((s) => s.setCode)
  const simulation     = useElectronicsStore((s) => s.simulation)
  const connections    = useElectronicsStore((s) => s.connections)
  const startSimulation = useElectronicsStore((s) => s.startSimulation)
  const stopSimulation  = useElectronicsStore((s) => s.stopSimulation)
  const setMotorSpeed   = useElectronicsStore((s) => s.setMotorSpeed)
  const setServoAngle   = useElectronicsStore((s) => s.setServoAngle)
  const objects         = useSceneStore((s) => s.objects)

  const [error, setError]                 = useState(null)
  const [serialLog, setSerialLog]         = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const serialRef    = useRef(null)
  const templatesRef = useRef(null)

  useEffect(() => {
    if (serialRef.current) serialRef.current.scrollTop = serialRef.current.scrollHeight
  }, [serialLog])

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplates) return
    const handler = (e) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target))
        setShowTemplates(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTemplates])

  const CONTROLLABLE = ['motor', 'motor_bo', 'motor_dc', 'led', 'servo', 'ir_sensor', 'ultrasonic', 'buzzer', 'oled', 'gas_sensor']
  const hasConnections  = Object.keys(connections).length > 0
  const hasMotors       = objects.some(o => ['motor', 'motor_bo', 'motor_dc'].includes(o.type))
  const hasLeds         = objects.some(o => o.type === 'led')
  const hasServos       = objects.some(o => o.type === 'servo')
  const hasArduino      = objects.some(o => o.type === 'arduino' || o.type === 'subo')
  const hasControllable = hasMotors || hasLeds || hasServos

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
      (ledId, brightness) => objectManager.animateLed(ledId, brightness),
      (servoId, angle) => setServoAngle(servoId, angle)
    )

    const err = simulationManager.start(code)
    if (err) {
      setError(err.error)
    } else {
      startSimulation()
    }
  }

  const handleStop = () => {
    simulationManager.stop()
    objectManager.resetAllLeds()
    stopSimulation()
    setError(null)
  }

  const noArduino    = !hasArduino
  const noComponent  = !hasControllable
  const noConnection = hasArduino && hasControllable && !hasConnections

  const hasMotorSpeeds = Object.keys(simulation.motorSpeeds ?? {}).length > 0
  const hasServoAngles = Object.keys(simulation.servoAngles ?? {}).length > 0

  return (
    <div className="flex flex-col h-full bg-gray-950">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/50 shrink-0">
        <span className="text-xs font-semibold text-gray-300">Arduino Code</span>

        {/* Templates dropdown */}
        <div className="relative ml-1" ref={templatesRef}>
          <button
            onClick={() => setShowTemplates(v => !v)}
            title="Insert a code template"
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded border border-gray-700/50 hover:border-gray-500 transition-colors leading-none"
          >
            Templates ▾
          </button>
          {showTemplates && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-gray-800 border border-gray-700 rounded shadow-xl min-w-[130px]">
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => { setCode(t.code); setShowTemplates(false) }}
                  className="block w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`ml-auto w-2 h-2 rounded-full ${simulation.running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
        <span className="text-[10px] text-gray-500">{simulation.running ? 'Running' : 'Idle'}</span>
      </div>

      {/* Prerequisite hints */}
      {(noArduino || noComponent || noConnection) && (
        <div className="px-3 py-2 space-y-1 shrink-0 border-b border-gray-700/30">
          {noArduino   && <Hint icon="⚠" text="Add an Arduino or SUBO board to the scene" />}
          {noComponent && <Hint icon="⚠" text="Add an electronics component (motor, servo, LED, sensor, buzzer, OLED…)" />}
          {!noArduino && !noComponent && noConnection && (
            <Hint icon="⚠" text="Draw a wire from an Arduino pin to the component" />
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
      <div data-tour="code-run" className="flex gap-2 px-3 py-2 border-t border-gray-700/50 shrink-0">
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
            disabled={!hasArduino || !hasControllable || !hasConnections}
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
      {simulation.running && (hasMotorSpeeds || hasServoAngles) && (
        <div className="px-3 pb-1 shrink-0 space-y-1">
          {hasMotorSpeeds && (
            <>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider">Motors</div>
              {Object.entries(simulation.motorSpeeds).map(([id, speed]) => {
                const obj = objects.find(o => o.id === id)
                return (
                  <div key={id} className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span className="truncate max-w-[70px]">{obj?.name ?? id}</span>
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 transition-all duration-100" style={{ width: `${(Math.abs(speed) / 255) * 100}%` }} />
                    </div>
                    <span className="w-7 text-right tabular-nums">{speed}</span>
                  </div>
                )
              })}
            </>
          )}
          {hasServoAngles && (
            <>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-1">Servos</div>
              {Object.entries(simulation.servoAngles).map(([id, angle]) => {
                const obj = objects.find(o => o.id === id)
                return (
                  <div key={id} className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span className="truncate max-w-[70px]">{obj?.name ?? id}</span>
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all duration-100" style={{ width: `${(angle / 180) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums">{angle}°</span>
                  </div>
                )
              })}
            </>
          )}
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
