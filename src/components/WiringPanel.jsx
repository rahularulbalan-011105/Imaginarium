import { useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import * as THREE from 'three'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { useHistory } from '../hooks/useHistory.js'

<<<<<<< HEAD
const ELEC_TYPES = new Set(['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo'])
=======
const ELEC_TYPES = new Set(['arduino', 'subo', 'motor', 'motor_bo', 'motor_dc', 'led', 'servo', 'ir_sensor', 'ultrasonic', 'buzzer', 'oled', 'gas_sensor'])
>>>>>>> master

const PIN_DEFS = {
  arduino:  ['D2','D3','D4','D5','D6','D7','D8','D9','D10','D11','5V','GND1','GND2'],
  subo:     ['IO1','IO1_V','IO1_G','IO2','IO2_V','IO2_G','IO3','IO3_V','IO3_G','IO4','IO4_V','IO4_G','IO5','IO5_V','IO5_G','IO6','IO6_V','IO6_G','IO7','IO7_V','IO7_G','IO8','IO8_V','IO8_G'],
  motor:    ['TERM_A','TERM_B'],
  motor_bo: ['TERM_A','TERM_B'],
  motor_dc: ['TERM_A','TERM_B'],
  led:      ['ANODE','CATHODE'],
  servo:    ['SIGNAL','VCC','GND'],
<<<<<<< HEAD
}

const WIRE_COLORS = ['#6366f1','#3b82f6','#22c55e','#ef4444','#8b5cf6','#ec4899','#06b6d4','#4F46E5']

const COMP_ICONS = { arduino: '🟢', subo: '🟣', motor: '⚙', motor_bo: '⚙', motor_dc: '🔧', led: '💡', servo: '🔩' }
=======
  ir_sensor:  ['OUT','GND','VCC'],
  ultrasonic: ['VCC','TRIG','ECHO','GND'],
  buzzer:     ['SIGNAL','GND'],
  oled:       ['GND','VCC','SCL','SDA'],
  gas_sensor: ['VCC','GND','DO','AO'],
}

const WIRE_COLORS = ['#f59e0b','#3b82f6','#22c55e','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316']

const COMP_ICONS = { arduino: '🟢', subo: '🟣', motor: '⚙', motor_bo: '⚙', motor_dc: '🔧', led: '💡', servo: '🔩', ir_sensor: '👁', ultrasonic: '📡', buzzer: '🔔', oled: '📺', gas_sensor: '💨' }
>>>>>>> master
function compIcon(type) { return COMP_ICONS[type] ?? '📦' }

function routeWire(fromMesh, toMesh) {
  if (!fromMesh || !toMesh) return null
  const from = fromMesh.position.clone().add(new THREE.Vector3(0, 0.5, 0))
  const to   = toMesh.position.clone().add(new THREE.Vector3(0, 0.5, 0))
  const mid1 = new THREE.Vector3(from.x, Math.max(from.y, to.y) + 1.5, from.z)
  const mid2 = new THREE.Vector3(to.x,   Math.max(from.y, to.y) + 1.5, to.z)
  return [from, mid1, mid2, to]
}

<<<<<<< HEAD
function buildWireLine(points, color = '#6366f1') {
=======
function buildWireLine(points, color = '#f59e0b') {
>>>>>>> master
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2 })
  return new THREE.Line(geo, mat)
}

// ── Pin button ────────────────────────────────────────────────────────────────
function PinButton({ pinId, pin, step, srcPin, dstPin, connectedPins, connForPin, onClick }) {
  const isSelected  = pinId === srcPin || pinId === dstPin
  const isConnected = connectedPins.has(pinId)
  const isSrc       = step === 'dest' && pinId === srcPin
  const isWaiting   = step === 'dest' && pinId !== srcPin && !isConnected

  let bg, textColor, border, cursor
<<<<<<< HEAD
  if (isSelected)  { bg = 'bg-indigo-600/50'; textColor = 'text-indigo-200'; border = 'border-indigo-500/70'; cursor = 'cursor-pointer' }
=======
  if (isSelected)  { bg = 'bg-amber-600/50'; textColor = 'text-amber-200'; border = 'border-amber-500/70'; cursor = 'cursor-pointer' }
>>>>>>> master
  else if (isConnected) { bg = 'bg-green-900/40'; textColor = 'text-green-300'; border = 'border-green-600/50'; cursor = 'cursor-pointer' }
  else if (isWaiting)   { bg = 'bg-blue-900/30'; textColor = 'text-blue-300'; border = 'border-blue-700/40'; cursor = 'cursor-pointer' }
  else { bg = 'bg-gray-700/40'; textColor = 'text-gray-400'; border = 'border-gray-600/30'; cursor = 'cursor-pointer' }

  let title = step === 'source'
    ? `Start wire here`
    : isConnected ? `Connect another wire to ${pin}` : `Connect to ${pin}`

  return (
    <button
      disabled={isSrc}
      onClick={onClick}
      className={`py-1 px-0.5 rounded text-[9px] font-mono border transition-colors ${bg} ${textColor} ${border} ${cursor} disabled:opacity-40 disabled:cursor-not-allowed`}
      title={title}
    >
      {pin}
      {isConnected && <span className="text-green-400 ml-0.5">●</span>}
    </button>
  )
}

export default function WiringPanel() {
  const objects      = useSceneStore(s => s.objects)
  const connections  = useElectronicsStore(s => s.connections)
  const addWireConnection    = useElectronicsStore(s => s.addWireConnection)
  const removeWireConnection = useElectronicsStore(s => s.removeWireConnection)
  const { snapshot } = useHistory()

  const elecObjects = objects.filter(o => ELEC_TYPES.has(o.type))

  // 'idle' = nothing selected
  // 'source' = source pin selected, waiting for dest
  // 'confirm' = both selected, show confirm
  // 'disconnect' = user clicked a connected pin, showing disconnect prompt
  const [mode, setMode]       = useState('idle')
  const [srcPin, setSrcPin]   = useState(null)
  const [dstPin, setDstPin]   = useState(null)
  const [wireColor, setWireColor] = useState(WIRE_COLORS[0])
  const [disconnectConnId, setDisconnectConnId] = useState(null)
  const [disconnectInfo, setDisconnectInfo]     = useState(null) // { from, to, color }

  const reset = () => { setMode('idle'); setSrcPin(null); setDstPin(null); setDisconnectConnId(null); setDisconnectInfo(null) }

  // Map: pinId → connId (for quickly finding a connection by pin)
  const pinToConn = {}
  for (const [connId, { fromPinId, toPinId }] of Object.entries(connections)) {
    pinToConn[fromPinId] = connId
    pinToConn[toPinId]   = connId
  }

  const connectedPins = new Set(Object.keys(pinToConn))

  const friendlyPin = (pinId) => {
    if (!pinId) return '?'
    const [compId, pin] = pinId.split(':')
    const comp = objects.find(o => o.id === compId)
    return `${comp?.name ?? compId} · ${pin}`
  }

  const handlePinClick = (compId, pinName) => {
    const pinId = `${compId}:${pinName}`

    // Any pin can take any number of wires (GND, 5V, signal — all fan-out freely).
    // Clicking a pin only ever STARTS or COMPLETES a wire; disconnecting is done
    // separately from the "Active Connections" list below.
    if (mode === 'idle') {
      setSrcPin(pinId)
      setMode('source')
    } else if (mode === 'source') {
      if (pinId === srcPin) { reset(); return }   // clicking the same pin cancels
      setDstPin(pinId)
      setMode('confirm')
    }
  }

  const connect = useCallback(() => {
    if (!srcPin || !dstPin) return
    // Skip if this exact pair is already wired (either direction). Different
    // pins sharing GND/5V are fine — only an identical duplicate is rejected.
    const dup = Object.values(connections).some(c =>
      (c.fromPinId === srcPin && c.toPinId === dstPin) ||
      (c.fromPinId === dstPin && c.toPinId === srcPin))
    if (dup) { reset(); return }
    const connId = uuidv4()
    addWireConnection(srcPin, dstPin, connId)

    const [srcComp] = srcPin.split(':')
    const [dstComp] = dstPin.split(':')
    const fromMesh = objectManager.getMesh(srcComp)
    const toMesh   = objectManager.getMesh(dstComp)
    const pts = routeWire(fromMesh, toMesh)
    if (pts) {
      const line = buildWireLine(pts, wireColor)
      line.userData.connId    = connId
      line.userData.fromPinId = srcPin   // lets ObjectManager.updateWires() re-route
      line.userData.toPinId   = dstPin   // this wire as the components move
      objectManager.addWire(connId, line)
    }

    snapshot()
    reset()
  }, [srcPin, dstPin, wireColor, connections, addWireConnection, snapshot])

  const disconnect = useCallback((connId) => {
    objectManager.removeWire(connId)
    removeWireConnection(connId)
    snapshot()
    reset()
  }, [removeWireConnection, snapshot])

  if (elecObjects.length === 0) {
    return (
      <div className="p-4 text-center py-10">
        <div className="text-3xl mb-2 opacity-30">⚡</div>
        <div className="text-xs text-gray-500">No electronics in scene.<br />Add an Arduino, Motor, Servo, or LED first.</div>
      </div>
    )
  }

  // ── Disconnect prompt ──────────────────────────────────────────────────────
  if (mode === 'disconnect' && disconnectInfo) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] text-red-400 uppercase tracking-wider font-semibold">Remove Connection?</div>
        <div className="bg-gray-800/60 border border-red-700/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-xs mb-1">
            <div className="w-3 h-1.5 rounded flex-shrink-0" style={{ background: disconnectInfo.color }} />
            <span className="text-white font-medium">{friendlyPin(disconnectInfo.from)}</span>
          </div>
          <div className="text-gray-500 text-[10px] pl-5 mb-1">→</div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-1.5 rounded flex-shrink-0" style={{ background: disconnectInfo.color }} />
            <span className="text-white font-medium">{friendlyPin(disconnectInfo.to)}</span>
          </div>
        </div>
        <button
          onClick={() => disconnect(disconnectConnId)}
<<<<<<< HEAD
          className="w-full py-2 rounded text-xs font-bold bg-red-900/40 hover:bg-red-700/50 border border-red-700/40 text-red-300 hover:text-slate-900 transition-colors"
=======
          className="w-full py-2 rounded text-xs font-bold bg-red-900/40 hover:bg-red-700/50 border border-red-700/40 text-red-300 hover:text-white transition-colors"
>>>>>>> master
        >
          ✂ Disconnect
        </button>
        <button
          onClick={reset}
          className="w-full py-1.5 rounded text-xs bg-gray-700/40 hover:bg-gray-600/40 text-gray-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  // ── Confirm new connection ─────────────────────────────────────────────────
  if (mode === 'confirm') {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="text-[10px] text-green-400 uppercase tracking-wider font-semibold">Confirm Connection</div>

        {/* Wire color picker */}
        <div>
          <div className="text-[9px] text-gray-500 mb-1.5">Wire color</div>
          <div className="flex gap-1.5 flex-wrap">
            {WIRE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setWireColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${wireColor === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="bg-gray-800/60 border border-green-700/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-xs mb-1">
            <div className="w-3 h-1.5 rounded flex-shrink-0" style={{ background: wireColor }} />
            <span className="text-white font-medium">{friendlyPin(srcPin)}</span>
          </div>
          <div className="text-gray-500 text-[10px] pl-5 mb-1">→</div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-3 h-1.5 rounded flex-shrink-0" style={{ background: wireColor }} />
<<<<<<< HEAD
            <span className="text-indigo-300 font-medium">{friendlyPin(dstPin)}</span>
=======
            <span className="text-amber-300 font-medium">{friendlyPin(dstPin)}</span>
>>>>>>> master
          </div>
        </div>

        <button
          onClick={connect}
<<<<<<< HEAD
          className="w-full py-2 rounded text-xs font-bold bg-green-900/40 hover:bg-green-700/50 border border-green-700/40 text-green-300 hover:text-slate-900 transition-colors"
=======
          className="w-full py-2 rounded text-xs font-bold bg-green-900/40 hover:bg-green-700/50 border border-green-700/40 text-green-300 hover:text-white transition-colors"
>>>>>>> master
        >
          ⚡ Connect
        </button>
        <button
          onClick={reset}
          className="w-full py-1.5 rounded text-xs bg-gray-700/40 hover:bg-gray-600/40 text-gray-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    )
  }

  // ── Idle / source picking ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header + step indicator */}
      <div className="px-3 py-2 border-b border-gray-700/50 shrink-0">
        {mode === 'idle' ? (
          <>
<<<<<<< HEAD
            <div className="text-[10px] text-indigo-400 uppercase tracking-wider font-semibold">
=======
            <div className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold">
>>>>>>> master
              ① Pick a pin to start a wire
            </div>
            <div className="text-[9px] text-gray-500 mt-0.5">Pins fan out freely — wire GND/5V to as many parts as you like. Remove wires from the list below.</div>
          </>
        ) : (
          <>
            <div className="text-[10px] text-blue-400 uppercase tracking-wider font-semibold">
              ② Pick destination pin
            </div>
            <div className="flex items-center gap-1 mt-0.5">
<<<<<<< HEAD
              <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
=======
              <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
>>>>>>> master
              <span className="text-[10px] text-white">{friendlyPin(srcPin)}</span>
            </div>
            <button onClick={reset} className="text-[9px] text-gray-500 hover:text-gray-300 mt-1 transition-colors">
              ← Cancel
            </button>
          </>
        )}
      </div>

      {/* Wire color picker — only in idle mode */}
      {mode === 'idle' && (
        <div className="px-3 py-2 border-b border-gray-700/50 shrink-0">
          <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">Wire Color</div>
          <div className="flex gap-1.5 flex-wrap">
            {WIRE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setWireColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${wireColor === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Component pin grid */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {elecObjects.map(comp => {
          const pins = PIN_DEFS[comp.type] ?? []
          return (
            <div key={comp.id} className="bg-gray-800/50 rounded-lg border border-gray-700/40 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/80 border-b border-gray-700/30">
                <span className="text-base">{compIcon(comp.type)}</span>
                <div>
                  <div className="text-xs font-semibold text-white leading-tight">{comp.name}</div>
                  <div className="text-[9px] text-gray-500 capitalize leading-tight">{comp.type}</div>
                </div>
              </div>
              <div className="px-3 py-2 grid grid-cols-3 gap-1">
                {pins.map(pin => {
                  const pinId = `${comp.id}:${pin}`
                  const connId = pinToConn[pinId]
                  return (
                    <PinButton
                      key={pin}
                      pinId={pinId}
                      pin={pin}
                      step={mode}
                      srcPin={srcPin}
                      dstPin={dstPin}
                      connectedPins={connectedPins}
                      connForPin={connId}
                      onClick={() => handlePinClick(comp.id, pin)}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Active connections list — always visible at bottom */}
      {Object.keys(connections).length > 0 && (
        <div className="border-t border-gray-700/50 shrink-0">
          <div className="px-3 pt-2 pb-1">
            <div className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">
              Active Connections ({Object.keys(connections).length})
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto px-3 pb-2 space-y-1">
            {Object.entries(connections).map(([connId, { fromPinId, toPinId }]) => {
              const wire   = objectManager.getWire?.(connId)
              const wColor = wire?.material?.color ? '#' + wire.material.color.getHexString() : '#888'
              return (
                <div
                  key={connId}
                  className="flex items-center gap-2 bg-gray-800/40 hover:bg-gray-700/40 rounded px-2 py-1.5 group transition-colors"
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: wColor }} />
                  <div className="flex-1 min-w-0 text-[9px]">
                    <div className="text-gray-300 truncate">{friendlyPin(fromPinId)}</div>
                    <div className="text-gray-500 truncate">→ {friendlyPin(toPinId)}</div>
                  </div>
                  <button
                    onClick={() => disconnect(connId)}
                    className="shrink-0 opacity-40 group-hover:opacity-100 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded px-1.5 py-0.5 text-[10px] font-medium transition-all"
                    title="Disconnect"
                  >
                    ✂ Cut
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
