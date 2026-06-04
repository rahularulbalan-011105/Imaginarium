import { useCallback, useEffect, useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { objectManager } from '../managers/ObjectManager.js'
import { r3, radToDeg, degToRad, snapRotationToAxes } from '../utils/helpers.js'

function Vec3Input({ label, value, onChange, onBlurSnapshot, step = 0.1 }) {
  const handleChange = (axis) => (e) => {
    const v = parseFloat(e.target.value)
    if (!isNaN(v)) onChange({ ...value, [axis]: v })
  }
  return (
    <div className="mb-3">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        {['x', 'y', 'z'].map((axis) => (
          <div key={axis} className="relative">
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-500 uppercase">
              {axis}
            </span>
            <input
              type="number"
              value={r3(value[axis])}
              step={step}
              onBlur={onBlurSnapshot}
              onChange={handleChange(axis)}
              className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white pl-4 pr-1 py-1.5 focus:outline-none focus:border-blue-500"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const MATERIAL_TYPES = ['standard', 'metallic', 'transparent']

export default function PropertiesPanel() {
  const selectedId = useSceneStore((s) => s.selectedId)
  const objects = useSceneStore((s) => s.objects)
  const updateObject = useSceneStore((s) => s.updateObject)
  const removeObject = useSceneStore((s) => s.removeObject)
  const duplicateObject = useSceneStore((s) => s.duplicateObject)
  const { snapshot } = useHistory()

  const attachments     = useElectronicsStore((s) => s.attachments)
  const detachFromMotor = useElectronicsStore((s) => s.detachFromMotor)
  const attachToMotor   = useElectronicsStore((s) => s.attachToMotor)

  const obj = objects.find((o) => o.id === selectedId) ?? null

  // Attachment info for the selected object
  const attachedMotorId = obj ? (attachments[obj.id] ?? null) : null
  const attachedMotor   = attachedMotorId ? objects.find(o => o.id === attachedMotorId) : null

  const MOTOR_TYPES = ['motor', 'motor_bo', 'motor_dc']
  const isMotor = obj && MOTOR_TYPES.includes(obj.type)

  // Motors available for direct attachment
  const motors    = objects.filter(o => MOTOR_TYPES.includes(o.type))
  const canAttach = obj && !attachedMotor &&
    !MOTOR_TYPES.includes(obj.type) && obj.type !== 'arduino' &&
    motors.length > 0

  // Shaft picker state
  const [currentShaftName, setCurrentShaftName] = useState(null)
  useEffect(() => {
    if (!isMotor || !selectedId) { setCurrentShaftName(null); return }
    setCurrentShaftName(objectManager.getMesh(selectedId)?.userData.currentRotorName ?? null)
  }, [selectedId, isMotor])

  const handleSetShaft = (meshName) => {
    if (!selectedId) return
    objectManager.setMotorShaft(selectedId, meshName)
    setCurrentShaftName(meshName)
  }

  // Pre-attach: which shaft preset to snap to
  const [attachPreset, setAttachPreset] = useState('tip')
  const SHAFT_PRESETS = { tip: 3.0, mid: 2.2, base: 1.5 }

  // Pre-attach: which part of the object lands at the snap point
  // 'center' = object origin · 'front' = +X extremity · 'back' = -X extremity
  const [alignX, setAlignX] = useState('center')

  // Post-attach: local position within rotorGroup (X = along shaft, Y/Z = radial)
  const [shaftPos, setShaftPos] = useState({ x: 2.95, y: 0, z: 0 })

  // Sync shaftPos from Three.js whenever the selected attached object changes
  useEffect(() => {
    if (attachedMotor && selectedId) {
      const pos = objectManager.getAttachedLocalPosition(selectedId)
      if (pos) setShaftPos({ x: r3(pos.x), y: r3(pos.y), z: r3(pos.z) })
    }
  }, [selectedId, attachedMotor])

  const handleShaftPosChange = (axis, val) => {
    if (isNaN(val)) return
    const next = { ...shaftPos, [axis]: val }
    setShaftPos(next)
    objectManager.updateAttachedLocalPosition(selectedId, next.x, next.y, next.z)
  }

  const handleShaftSnap = (x) => {
    const next = { x, y: 0, z: 0 }
    setShaftPos(next)
    objectManager.updateAttachedLocalPosition(selectedId, x, 0, 0)
  }

  const update = useCallback(
    (updates) => {
      if (!selectedId) return
      updateObject(selectedId, updates)
    },
    [selectedId, updateObject]
  )

  const handleDelete = () => {
    removeObject(selectedId)
    snapshot()
  }

  const handleDuplicate = () => {
    duplicateObject(selectedId)
    snapshot()
  }

  const handleDetach = () => {
    if (!selectedId) return
    const worldPos = objectManager.detachMeshFromRotor(selectedId)
    detachFromMotor(selectedId)
    if (worldPos) {
      updateObject(selectedId, {
        position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        rotation: { x: 0, y: 0, z: 0 },
      })
    }
  }

  const handleAttachToMotor = (motorId) => {
    if (!selectedId || !motorId) return
    const snapX = SHAFT_PRESETS[attachPreset]
    const success = objectManager.attachMeshToRotor(selectedId, motorId, snapX, alignX)
    if (success) {
      attachToMotor(selectedId, motorId)
      // Read back actual position (bbox alignment may have shifted it)
      const pos = objectManager.getAttachedLocalPosition(selectedId)
      setShaftPos(pos ? { x: r3(pos.x), y: r3(pos.y), z: r3(pos.z) } : { x: snapX, y: 0, z: 0 })
    }
  }

  if (!obj) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="text-4xl mb-3 opacity-30">⚙</div>
        <div className="text-sm text-gray-500">Select an object to edit its properties</div>
      </div>
    )
  }

  const rotDeg = {
    x: radToDeg(obj.rotation.x),
    y: radToDeg(obj.rotation.y),
    z: radToDeg(obj.rotation.z),
  }

  return (
    <div className="flex flex-col gap-1 p-3 overflow-y-auto">
      {/* Name */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Name</div>
        <input
          type="text"
          value={obj.name}
          onChange={(e) => update({ name: e.target.value })}
          className="w-full bg-gray-800 border border-gray-600/50 rounded text-sm text-white px-2 py-1.5 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Attachment badge — shown when this object is riding a motor's rotor */}
      {attachedMotor && (
        <div className="mb-3 p-2.5 rounded bg-green-900/30 border border-green-700/40">
          <div className="text-[10px] text-green-400 uppercase tracking-wider font-semibold mb-1">
            Attached to Rotor
          </div>
          <div className="text-xs text-green-300 truncate mb-2">{attachedMotor.name}</div>

          {/* Shaft position — quick snap presets */}
          <div className="mb-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Snap to shaft</div>
            <div className="flex gap-1">
              {[['Tip', 3.0], ['Mid', 2.2], ['Base', 1.5]].map(([label, x]) => (
                <button
                  key={label}
                  onClick={() => handleShaftSnap(x)}
                  className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                    Math.abs(shaftPos.x - x) < 0.01 && shaftPos.y === 0 && shaftPos.z === 0
                      ? 'bg-green-700/50 border-green-500/60 text-green-200'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Fine-tune position along shaft and radial axes */}
          <div className="mb-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Fine position</div>
            <div className="grid grid-cols-3 gap-1">
              {[['X', 'x'], ['Y', 'y'], ['Z', 'z']].map(([label, axis]) => (
                <div key={axis} className="relative">
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-500 uppercase">
                    {label}
                  </span>
                  <input
                    type="number"
                    value={shaftPos[axis]}
                    step={0.1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v)) handleShaftPosChange(axis, v)
                    }}
                    className="w-full bg-gray-800 border border-gray-600/50 rounded text-xs text-white pl-4 pr-1 py-1.5 focus:outline-none focus:border-green-500"
                  />
                </div>
              ))}
            </div>
            <div className="text-[9px] text-gray-600 mt-1">X = along shaft · Y/Z = radial</div>
          </div>

          <button
            onClick={handleDetach}
            className="w-full py-1.5 bg-red-900/40 hover:bg-red-700/60 border border-red-700/50 text-red-300 hover:text-white text-xs rounded transition-colors"
          >
            Detach from Motor
          </button>
        </div>
      )}

      {/* Transform — hidden while attached (position is managed by Three.js parenting) */}
      {!attachedMotor && (
        <>
          <Vec3Input
            label="Position"
            value={obj.position}
            onBlurSnapshot={snapshot}
            onChange={(v) => update({ position: v })}
          />
          <Vec3Input
            label="Rotation (°)"
            value={rotDeg}
            step={1}
            onBlurSnapshot={snapshot}
            onChange={(v) =>
              update({
                rotation: { x: degToRad(v.x), y: degToRad(v.y), z: degToRad(v.z) },
              })
            }
          />
          <div className="-mt-1 mb-3">
            <button
              onClick={() => {
                const snapped = snapRotationToAxes(obj.rotation)
                update({ rotation: snapped })
                const mesh = objectManager.getMesh(obj.id)
                if (mesh) mesh.rotation.set(snapped.x, snapped.y, snapped.z)
                snapshot()
              }}
              title="Round each rotation axis to the nearest 0°/90°/180°/270° so the shape is perfectly grid-aligned"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs bg-indigo-900/40 hover:bg-indigo-700/50 border border-indigo-700/40 text-indigo-300 hover:text-white transition-colors"
            >
              <span>⊹</span>
              <span>Snap to Axes</span>
            </button>
          </div>
          <Vec3Input
            label="Scale"
            value={obj.scale}
            onBlurSnapshot={snapshot}
            onChange={(v) => update({ scale: v })}
            step={0.1}
          />
        </>
      )}

      {/* Attach to Motor — shown for any non-electronics object that isn't already attached */}
      {canAttach && (
        <div className="mb-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Motor Attachment</div>
          {/* Snap position picker */}
          <div className="mb-2">
            <div className="text-[9px] text-gray-500 mb-1">Snap to shaft position:</div>
            <div className="flex gap-1">
              {[['Tip', 'tip'], ['Mid', 'mid'], ['Base', 'base']].map(([label, key]) => (
                <button
                  key={key}
                  onClick={() => setAttachPreset(key)}
                  className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                    attachPreset === key
                      ? 'bg-blue-700/60 border-blue-500 text-white'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Alignment: which part of the object lands at the snap point */}
          <div className="mb-2">
            <div className="text-[9px] text-gray-500 mb-1">Align at snap point:</div>
            <div className="flex gap-1">
              {[
                { key: 'center', label: 'Center',   hint: 'Object center at snap' },
                { key: 'front',  label: '→ Tip',    hint: 'Pointed/front end at snap (e.g. cone tip)' },
                { key: 'back',   label: 'Base ←',   hint: 'Flat/back end at snap' },
              ].map(({ key, label, hint }) => (
                <button
                  key={key}
                  title={hint}
                  onClick={() => setAlignX(key)}
                  className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                    alignX === key
                      ? 'bg-orange-700/60 border-orange-500 text-white'
                      : 'bg-gray-800 border-gray-600/50 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-gray-600 mt-0.5">
              {alignX === 'front' ? 'Pointed/+X end at snap · body hangs back'
               : alignX === 'back' ? 'Flat/-X end at snap · body extends forward'
               : 'Object center placed at snap position'}
            </div>
          </div>
          {motors.length === 1 ? (
            <button
              onClick={() => handleAttachToMotor(motors[0].id)}
              className="w-full py-1.5 bg-blue-900/40 hover:bg-blue-700/60 border border-blue-700/50 text-blue-300 hover:text-white text-xs rounded transition-colors"
            >
              ⚙ Attach to {motors[0].name}
            </button>
          ) : (
            <div className="flex flex-col gap-1">
              {motors.map(m => (
                <button
                  key={m.id}
                  onClick={() => handleAttachToMotor(m.id)}
                  className="w-full py-1.5 bg-blue-900/40 hover:bg-blue-700/60 border border-blue-700/50 text-blue-300 hover:text-white text-xs rounded transition-colors"
                >
                  ⚙ Attach to {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rotating Part picker — only for motor objects */}
      {isMotor && (
        <div className="mb-3 border border-gray-700/40 rounded p-2">
          <div className="text-[10px] text-green-500 uppercase tracking-wider font-semibold mb-1">
            ↻ Rotating Part
          </div>
          <div className="text-[9px] text-gray-500 mb-2">
            Click a part to set it as the spinning shaft when the simulation runs.
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {objectManager.getMotorMeshNames(selectedId).map(name => (
              <button
                key={name}
                onClick={() => handleSetShaft(name)}
                className={`w-full text-left px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                  currentShaftName === name
                    ? 'bg-green-700/60 text-green-200 border border-green-600/50'
                    : 'text-gray-400 hover:bg-gray-700/60 hover:text-white'
                }`}
              >
                {currentShaftName === name ? '▶ ' : '   '}{name}
              </button>
            ))}
          </div>
          {currentShaftName && (
            <div className="text-[9px] text-green-500 mt-1.5">
              Shaft: <span className="font-mono">{currentShaftName}</span>
            </div>
          )}
        </div>
      )}

      {/* Color */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Color</div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={obj.color}
            onChange={(e) => update({ color: e.target.value })}
            className="w-9 h-9 rounded cursor-pointer border border-gray-600/50 bg-transparent"
          />
          <input
            type="text"
            value={obj.color}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) update({ color: e.target.value })
            }}
            className="flex-1 bg-gray-800 border border-gray-600/50 rounded text-xs text-white px-2 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>
      </div>

      {/* Material */}
      <div className="mb-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Material</div>
        <div className="grid grid-cols-3 gap-1">
          {MATERIAL_TYPES.map((m) => (
            <button
              key={m}
              onClick={() => update({ material: m })}
              className={`py-1.5 rounded text-xs capitalize transition-colors ${
                obj.material === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-600/50'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Visibility */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider">Visible</div>
        <button
          onClick={() => update({ visible: !obj.visible })}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            obj.visible
              ? 'bg-green-700/50 text-green-300 border border-green-700/50'
              : 'bg-gray-700 text-gray-400 border border-gray-600/50'
          }`}
        >
          {obj.visible ? 'Shown' : 'Hidden'}
        </button>
      </div>

      <div className="border-t border-gray-700/50 pt-3 flex gap-2">
        <button
          onClick={handleDuplicate}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs py-1.5 rounded transition-colors"
        >
          Duplicate
        </button>
        <button
          onClick={handleDelete}
          className="flex-1 bg-red-800/60 hover:bg-red-700 text-red-200 text-xs py-1.5 rounded transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
