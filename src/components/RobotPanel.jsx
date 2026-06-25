import { useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useRobotStore } from '../stores/robotStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { buildAssemblies } from '../utils/robotAssembly.js'
import { createBlueprint, LOCOMOTION_TYPES } from '../robot/RobotBlueprint.js'
import { moduleLabels } from '../robot/ModuleLoader.js'

const LOCO_META = {
  wheels: { icon: '🛞', label: 'Wheeled' },
  tracks: { icon: '🚜', label: 'Tracked' },
  legs:   { icon: '🕷', label: 'Legged' },
  rotors: { icon: '🚁', label: 'Drone' },
  marine: { icon: '🌊', label: 'Marine' },
  hybrid: { icon: '🧩', label: 'Hybrid' },
}

// Map an assembly's member component types → actuators / sensors / controller.
// This only PRE-FILLS the blueprint (wizard convenience); the saved blueprint is
// the authority — we never inspect geometry at sim time.
function scanCapabilities(memberIds, byId) {
  const actuators = [], sensors = []
  let controller = null
  for (const id of memberIds) {
    const o = byId[id]; if (!o) continue
    if (o.type === 'servo')                                   actuators.push({ role: 'servo', componentId: id, type: 'servo' })
    else if (['motor', 'motor_bo', 'motor_dc'].includes(o.type)) actuators.push({ role: 'drive', componentId: id, type: o.type })
    else if (o.type === 'ultrasonic')                         sensors.push({ role: 'range', componentId: id, type: 'ultrasonic' })
    else if (o.type === 'ir_sensor')                          sensors.push({ role: 'ir',    componentId: id, type: 'ir_sensor' })
    else if (o.type === 'gas_sensor')                         sensors.push({ role: 'gas',   componentId: id, type: 'gas_sensor' })
    else if (o.type === 'arduino' || o.type === 'subo')       controller = { type: o.type, componentId: id }
  }
  return { actuators, sensors, controller }
}

// Suggest a default locomotion type from the scan (only a wizard default).
function suggestLocomotion(actuators) {
  if (actuators.some(a => a.type === 'servo')) return 'legs'
  if (actuators.some(a => a.role === 'drive')) return 'wheels'
  return 'wheels'
}

export default function RobotPanel() {
  const objects     = useSceneStore(s => s.objects)
  const selectedId  = useSceneStore(s => s.selectedId)
  useRigidStore(s => s.bonds)            // re-render when grouping changes
  useElectronicsStore(s => s.attachments)
  const blueprints  = useRobotStore(s => s.blueprints)
  const addBlueprint    = useRobotStore(s => s.addBlueprint)
  const removeBlueprint = useRobotStore(s => s.removeBlueprint)
  const updateBlueprint = useRobotStore(s => s.updateBlueprint)
  const { snapshot } = useHistory()

  const assemblies = buildAssemblies()
  const byId = Object.fromEntries(objects.map(o => [o.id, o]))

  // Default the wizard to the assembly containing the current selection.
  const defaultRoot = assemblies.find(a => a.memberIds.includes(selectedId))?.rootId
                    ?? assemblies[0]?.rootId ?? ''
  const [rootId, setRootId] = useState(defaultRoot)
  const [name, setName]     = useState('')
  const [loco, setLoco]     = useState('wheels')

  const chosen = assemblies.find(a => a.rootId === rootId) ?? null
  const blueprintList = Object.values(blueprints)

  const generate = () => {
    if (!chosen) return
    const { actuators, sensors, controller } = scanCapabilities(chosen.memberIds, byId)
    const bp = createBlueprint({
      rootId: chosen.rootId,
      members: chosen.memberIds,
      robotName: name.trim() || chosen.name || 'Robot',
      locomotion: { type: loco, params: {} },
      actuators, sensors, controller,
    })
    addBlueprint(bp)
    snapshot()
    setName('')
  }

  // When the assembly changes, pre-suggest a locomotion type from its components.
  const onPickAssembly = (id) => {
    setRootId(id)
    const a = assemblies.find(x => x.rootId === id)
    if (a) { const { actuators } = scanCapabilities(a.memberIds, byId); setLoco(suggestLocomotion(actuators)) }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-semibold">🤖 Robot Blueprints</div>

      {/* Existing blueprints */}
      {blueprintList.length === 0 ? (
        <div className="text-[10px] text-gray-600">No robots defined yet. A blueprint declares the robot's locomotion + parts so the simulator loads the right physics — no geometry guessing.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {blueprintList.map(bp => (
            <div key={bp.id} className="border border-gray-700/50 rounded p-2">
              <div className="flex items-center gap-2">
                <span className="text-base">{LOCO_META[bp.locomotion.type]?.icon ?? '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">{bp.robotName}</div>
                  <div className="text-[9px] text-gray-500">{LOCO_META[bp.locomotion.type]?.label ?? bp.locomotion.type} · {(bp.members?.length ?? 0)} parts</div>
                </div>
                <button onClick={() => { removeBlueprint(bp.id); snapshot() }}
                  className="text-[10px] text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-900/30">🗑</button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {moduleLabels(bp).map(m => (
                  <span key={m} className="text-[8px] px-1.5 py-0.5 rounded bg-cyan-900/40 border border-cyan-800/50 text-cyan-700">{m}</span>
                ))}
              </div>
              {/* quick locomotion change */}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {LOCOMOTION_TYPES.map(t => (
                  <button key={t} onClick={() => { updateBlueprint(bp.id, { locomotion: { ...bp.locomotion, type: t } }); snapshot() }}
                    className={`text-[8px] px-1.5 py-0.5 rounded border ${bp.locomotion.type === t ? 'bg-cyan-700 border-cyan-500 text-white' : 'bg-gray-800 border-gray-600/40 text-gray-400 hover:text-slate-800'}`}>
                    {LOCO_META[t]?.label ?? t}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create robot wizard */}
      <div className="border-t border-gray-700/50 pt-2 flex flex-col gap-2">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Create Robot</div>

        {assemblies.length === 0 ? (
          <div className="text-[10px] text-gray-600">Build a robot first (bond parts / attach wheels), then define its blueprint here.</div>
        ) : (
          <>
            <label className="text-[9px] text-gray-500">
              Assembly
              <select value={rootId} onChange={e => onPickAssembly(e.target.value)}
                className="w-full mt-0.5 bg-gray-800 border border-gray-600/50 rounded text-xs text-slate-800 px-2 py-1.5 focus:outline-none">
                {assemblies.map(a => <option key={a.rootId} value={a.rootId}>{a.name} · {a.memberIds.length} parts</option>)}
              </select>
            </label>

            <label className="text-[9px] text-gray-500">
              Name
              <input value={name} onChange={e => setName(e.target.value)} placeholder={chosen?.name ?? 'Robot'}
                className="w-full mt-0.5 bg-gray-800 border border-gray-600/50 rounded text-xs text-slate-800 px-2 py-1.5 focus:outline-none" />
            </label>

            <div className="text-[9px] text-gray-500">Robot type</div>
            <div className="grid grid-cols-3 gap-1">
              {LOCOMOTION_TYPES.map(t => (
                <button key={t} onClick={() => setLoco(t)}
                  className={`flex flex-col items-center gap-0.5 py-1.5 rounded border text-[9px] transition-colors ${loco === t ? 'bg-cyan-700/70 border-cyan-500 text-white' : 'bg-gray-800 border-gray-600/40 text-gray-400 hover:text-slate-800'}`}>
                  <span className="text-base leading-none">{LOCO_META[t]?.icon}</span>
                  <span>{LOCO_META[t]?.label ?? t}</span>
                </button>
              ))}
            </div>

            <button onClick={generate} disabled={!chosen}
              className="w-full py-2 rounded text-xs font-bold bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white transition-colors">
              ＋ Generate Blueprint
            </button>
            <div className="text-[9px] text-gray-600">Actuators, sensors and the controller are auto-filled from the assembly's wired components. The locomotion type you pick decides which physics modules load.</div>
          </>
        )}
      </div>
    </div>
  )
}
