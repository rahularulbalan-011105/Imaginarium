import { useState, useMemo } from 'react'
import { useJointStore, JOINT_TYPES } from '../stores/jointStore.js'
import { useSceneStore } from '../stores/sceneStore.js'
import { jointManager } from '../managers/JointManager.js'
import { useHistory } from '../hooks/useHistory.js'

// Viewport listens for this to enter feature-pick mode (corner/edge/face joints)
export const jointPickEvents = new EventTarget()

function JointCard({ joint, objects }) {
  const { updateJoint, removeJoint, driveJoint } = useJointStore()
  const { snapshot } = useHistory()
  const parent = objects.find(o => o.id === joint.parentId)
  const child  = objects.find(o => o.id === joint.childId)
  const meta   = JOINT_TYPES[joint.type] ?? JOINT_TYPES.hinge
  const [expanded, setExpanded] = useState(false)

  const remove = () => {
    jointManager.removeJoint(joint.id)
    snapshot()
  }

  const update = (updates) => {
    updateJoint(joint.id, updates)
    snapshot()
  }

  const drive = (val) => {
    driveJoint(joint.id, parseFloat(val))
  }

  return (
    <div className="bg-gray-800/60 rounded border border-gray-700/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-700/30" onClick={() => setExpanded(e => !e)}>
        <span className="text-base">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-white truncate">
            {meta.label} Joint
          </div>
          <div className="text-[10px] text-gray-400 truncate">
            {parent?.name ?? '?'} → {child?.name ?? '?'}
          </div>
          {joint.featureKind && (
            <div className="text-[9px] text-teal-400 capitalize">
              {joint.featureKind} pivot
            </div>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); update({ visible: !joint.visible }) }}
          className={`text-[10px] px-1.5 py-0.5 rounded ${joint.visible ? 'text-indigo-400' : 'text-gray-600'}`}
          title="Toggle marker visibility"
        >
          {joint.visible ? '👁' : '👁‍🗨'}
        </button>
        <span className="text-gray-500 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-700/40">
          {/* Joint Type */}
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1 mt-2">Type</div>
            <div className="grid grid-cols-3 gap-1">
              {Object.entries(JOINT_TYPES).map(([key, m]) => (
                <button
                  key={key}
                  onClick={() => update({ type: key })}
                  className={`text-[10px] py-1 rounded flex flex-col items-center gap-0.5 transition-colors ${
                    joint.type === key
                      ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-600/50'
                      : 'bg-gray-700/40 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <span>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Axis (for applicable joint types) */}
          {meta.hasAxis && (
            <div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Axis</div>
              <div className="flex gap-1">
                {['x', 'y', 'z'].map(ax => (
                  <button
                    key={ax}
                    onClick={() => update({ axis: { x: ax === 'x' ? 1 : 0, y: ax === 'y' ? 1 : 0, z: ax === 'z' ? 1 : 0 } })}
                    className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors ${
                      (ax === 'x' && joint.axis.x === 1) ||
                      (ax === 'y' && joint.axis.y === 1) ||
                      (ax === 'z' && joint.axis.z === 1)
                        ? 'bg-indigo-600/40 text-indigo-300'
                        : 'bg-gray-700/40 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {ax.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Angle / position limits */}
          {meta.hasLimits && (
            <div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">
                {joint.type === 'slider' ? 'Distance Limits' : 'Angle Limits (°)'}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-[9px] text-gray-500 mb-0.5">Min</div>
                  <input
                    type="number"
                    value={joint.type === 'slider' ? joint.limits.minDist : joint.limits.minAngle}
                    onChange={e => {
                      const v = parseFloat(e.target.value) || 0
                      update({ limits: joint.type === 'slider'
                        ? { ...joint.limits, minDist: v }
                        : { ...joint.limits, minAngle: v }
                      })
                    }}
                    className="w-full bg-gray-700 text-white text-[11px] px-2 py-1 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-[9px] text-gray-500 mb-0.5">Max</div>
                  <input
                    type="number"
                    value={joint.type === 'slider' ? joint.limits.maxDist : joint.limits.maxAngle}
                    onChange={e => {
                      const v = parseFloat(e.target.value) || 0
                      update({ limits: joint.type === 'slider'
                        ? { ...joint.limits, maxDist: v }
                        : { ...joint.limits, maxAngle: v }
                      })
                    }}
                    className="w-full bg-gray-700 text-white text-[11px] px-2 py-1 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Manual drive — ball pivots get one slider per rotation axis */}
          {joint.type === 'ball' ? (
            <div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">
                Pivot Rotation (°)
              </div>
              {['x', 'y', 'z'].map(ax => (
                <div key={ax} className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-bold text-indigo-500 uppercase w-3">{ax}</span>
                  <input
                    type="range"
                    min={joint.limits.minAngle}
                    max={joint.limits.maxAngle}
                    step={1}
                    value={joint.ballRot?.[ax] ?? 0}
                    onChange={e => jointManager.driveBall(joint.id, ax, parseFloat(e.target.value))}
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-[10px] text-indigo-400 w-8 text-right">
                    {(joint.ballRot?.[ax] ?? 0).toFixed(0)}°
                  </span>
                </div>
              ))}
            </div>
          ) : meta.hasLimits && (
            <div>
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">
                {joint.type === 'slider' ? 'Position' : 'Current Angle (°)'}
              </div>
              <input
                type="range"
                min={joint.type === 'slider' ? joint.limits.minDist : joint.limits.minAngle}
                max={joint.type === 'slider' ? joint.limits.maxDist : joint.limits.maxAngle}
                step={0.5}
                value={joint.type === 'slider' ? joint.currentPosition : joint.currentAngle}
                onChange={e => jointManager.driveJoint(joint.id, parseFloat(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="text-[10px] text-indigo-400 text-center">
                {joint.type === 'slider'
                  ? joint.currentPosition.toFixed(1) + ' units'
                  : joint.currentAngle.toFixed(1) + '°'}
              </div>
            </div>
          )}

          {/* Motor settings */}
          {meta.motorized && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={joint.motorSettings.motorized}
                  onChange={e => update({ motorSettings: { ...joint.motorSettings, motorized: e.target.checked } })}
                  className="accent-indigo-500"
                />
                <span className="text-[10px] text-gray-300">Motorized</span>
              </label>
              {joint.motorSettings.motorized && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[9px] text-gray-500 mb-0.5">Speed (°/s)</div>
                    <input
                      type="number"
                      value={joint.motorSettings.speed}
                      onChange={e => update({ motorSettings: { ...joint.motorSettings, speed: parseFloat(e.target.value) || 0 } })}
                      className="w-full bg-gray-700 text-white text-[11px] px-2 py-1 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 mb-0.5">
                      {joint.type === 'servo' ? 'Target (°)' : 'Torque'}
                    </div>
                    <input
                      type="number"
                      value={joint.type === 'servo' ? joint.motorSettings.targetAngle : joint.motorSettings.torque}
                      onChange={e => {
                        const v = parseFloat(e.target.value) || 0
                        update({ motorSettings: joint.type === 'servo'
                          ? { ...joint.motorSettings, targetAngle: v }
                          : { ...joint.motorSettings, torque: v }
                        })
                      }}
                      className="w-full bg-gray-700 text-white text-[11px] px-2 py-1 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Anchor point display */}
          <div>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Anchor Point</div>
            <div className="text-[10px] text-gray-400 font-mono">
              ({joint.anchorPoint.x.toFixed(2)}, {joint.anchorPoint.y.toFixed(2)}, {joint.anchorPoint.z.toFixed(2)})
            </div>
          </div>

          {/* Remove */}
          <button
            onClick={remove}
            className="w-full py-1.5 rounded text-[11px] bg-red-900/30 hover:bg-red-800/40 border border-red-700/40 text-red-400 transition-colors mt-1"
          >
            Remove Joint
          </button>
        </div>
      )}
    </div>
  )
}

export default function JointPanel() {
  // Select the raw map (stable reference) and derive the array via useMemo.
  // Returning Object.values() directly from the selector creates a new array
  // every render, which makes useSyncExternalStore loop infinitely.
  const jointsMap = useJointStore(s => s.joints)
  const joints    = useMemo(() => Object.values(jointsMap), [jointsMap])
  const objects = useSceneStore(s => s.objects)
  const selectedId   = useSceneStore(s => s.selectedId)
  const secondaryId  = useSceneStore(s => s.secondaryId)
  const { snapshot } = useHistory()

  const canCreate = selectedId && secondaryId && selectedId !== secondaryId
  const [pendingType, setPendingType] = useState('hinge')

  const createJoint = () => {
    if (!canCreate) return
    jointManager.createJoint(selectedId, secondaryId, pendingType)
    snapshot()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Create joint UI */}
      <div className="px-3 py-3 border-b border-gray-700/50 space-y-2">
        <div className="text-[9px] text-indigo-500 uppercase tracking-wider font-semibold">
          Create Joint
        </div>

        {/* Feature-pick flow — Fusion-style joint origins */}
        <button
          onClick={() => jointPickEvents.dispatchEvent(new CustomEvent('start'))}
          className="w-full py-2 rounded text-xs bg-teal-700/40 hover:bg-teal-600/50 border border-teal-600/50 text-teal-200 transition-colors font-semibold"
        >
          🎯 Pick Joint Origins
        </button>
        <div className="text-[9px] text-gray-500 leading-relaxed">
          Click a <span className="text-teal-300">corner</span>, <span className="text-teal-300">edge</span>, or{' '}
          <span className="text-teal-300">face</span> on the first object, then on the second. The pick decides the
          motion — corner → ball pivot · edge → slider · face → hinge.
        </div>

        <div className="h-px bg-gray-700/50 my-1" />
        <div className="text-[9px] text-gray-600 uppercase tracking-wider">Or join whole objects</div>

        {canCreate ? (
          <>
            <div className="text-[10px] text-gray-400">
              Between{' '}
              <span className="text-white font-medium">
                {objects.find(o => o.id === selectedId)?.name ?? '?'}
              </span>
              {' '}→{' '}
              <span className="text-indigo-300 font-medium">
                {objects.find(o => o.id === secondaryId)?.name ?? '?'}
              </span>
            </div>
            <select
              value={pendingType}
              onChange={e => setPendingType(e.target.value)}
              className="w-full bg-gray-700 text-white text-[11px] px-2 py-1.5 rounded border border-gray-600 focus:border-indigo-500 focus:outline-none"
            >
              {Object.entries(JOINT_TYPES).map(([k, m]) => (
                <option key={k} value={k}>{m.icon} {m.label}</option>
              ))}
            </select>
            <button
              onClick={createJoint}
              className="w-full py-2 rounded text-xs bg-indigo-700/40 hover:bg-indigo-600/50 border border-indigo-600/50 text-indigo-300 transition-colors font-semibold"
            >
              ⚙ Create Joint
            </button>
          </>
        ) : (
          <div className="text-[10px] text-gray-500 text-center py-2">
            Shift-click a second object to create a joint between them
          </div>
        )}
      </div>

      {/* Joint list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {joints.length === 0 ? (
          <div className="text-[10px] text-gray-600 text-center py-6">
            No joints yet.<br />Select two objects and press Create Joint.
          </div>
        ) : (
          joints.map(j => <JointCard key={j.id} joint={j} objects={objects} />)
        )}
      </div>
    </div>
  )
}
