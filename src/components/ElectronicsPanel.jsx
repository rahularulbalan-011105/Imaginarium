import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { objectManager } from '../managers/ObjectManager.js'
import { createWireLine, updateWireLine } from '../utils/electronicsFactory.js'
import * as THREE from 'three'

export default function ElectronicsPanel({ selectedId, secondaryId }) {
  const objects = useSceneStore((s) => s.objects)
  const clearSecondaryId = useSceneStore((s) => s.clearSecondaryId)
  const connections = useElectronicsStore((s) => s.connections)
  const addConnection = useElectronicsStore((s) => s.addConnection)
  const removeConnection = useElectronicsStore((s) => s.removeConnection)

  const objA = objects.find(o => o.id === selectedId)
  const objB = objects.find(o => o.id === secondaryId)
  if (!objA || !objB) return null

  // Determine which is Arduino and which is Motor
  const arduino = [objA, objB].find(o => o.type === 'arduino' || o.type === 'subo')
  const motor   = [objA, objB].find(o => o.type === 'motor')

  if (!arduino || !motor) return null  // Need one of each

  const existingConn = connections.find(
    c => c.arduinoId === arduino.id && c.motorId === motor.id
  )

  const handleConnect = () => {
    const pin = 3  // default PWM pin
    addConnection(arduino.id, motor.id, pin)

    // Draw wire between them in Three.js
    const meshA = objectManager.getMesh(arduino.id)
    const meshB = objectManager.getMesh(motor.id)
    if (meshA && meshB) {
      const from = meshA.position.clone().add(new THREE.Vector3(0, 0.5, 0))
      const to   = meshB.position.clone().add(new THREE.Vector3(-1.5, 0.5, 0))
      const line = createWireLine(from, to)
      line.userData.connId = `${arduino.id}-${motor.id}`
      objectManager.addWire(line.userData.connId, line)
    }
    clearSecondaryId()
  }

  const handleDisconnect = () => {
    const wireId = `${arduino.id}-${motor.id}`
    objectManager.removeWire(wireId)
    removeConnection(existingConn.id)
    clearSecondaryId()
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] text-green-400 uppercase tracking-wider font-semibold">
        Electronics Connection
      </div>

      <div className="flex items-center gap-2 bg-gray-800/60 rounded p-2 text-xs">
        <span className="text-2xl">🟢</span>
        <div>
          <div className="text-white font-medium">{arduino.name}</div>
          <div className="text-gray-500 text-[10px]">Arduino</div>
        </div>
        <span className="text-gray-500 mx-1">→ Pin 3</span>
        <span className="text-2xl">⚙</span>
        <div>
          <div className="text-white font-medium">{motor.name}</div>
          <div className="text-gray-500 text-[10px]">Motor</div>
        </div>
      </div>

      {existingConn ? (
        <>
          <div className="flex items-center gap-2 text-xs text-green-400 bg-green-900/20 border border-green-700/40 rounded p-2">
            <span>✓</span>
            <span>Connected via Pin 3 (PWM)</span>
          </div>
          <button
            onClick={handleDisconnect}
            className="w-full py-2 rounded text-xs bg-red-800/50 hover:bg-red-700/60 border border-red-700/40 text-red-300 transition-colors"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <div className="text-[10px] text-gray-500 leading-relaxed">
            Connects Motor to Arduino Pin 3 (PWM). Use{' '}
            <code className="text-green-400">analogWrite(3, 0–255)</code> in your code to control speed.
          </div>
          <button
            onClick={handleConnect}
            className="w-full py-2 rounded text-xs bg-green-800/50 hover:bg-green-700/60 border border-green-700/40 text-green-300 transition-colors font-medium"
          >
            ⚡ Connect (Pin 3)
          </button>
        </>
      )}

      <button
        onClick={clearSecondaryId}
        className="text-xs text-gray-500 hover:text-gray-300 text-center py-1 transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
