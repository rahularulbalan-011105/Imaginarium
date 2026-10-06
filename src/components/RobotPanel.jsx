import { useState } from 'react'
import { useSceneStore } from '../stores/sceneStore.js'
import { useRobotStore } from '../stores/robotStore.js'
import { useRigidStore } from '../stores/rigidStore.js'
import { useElectronicsStore } from '../stores/electronicsStore.js'
import { useHistory } from '../hooks/useHistory.js'
import { buildAssemblies } from '../utils/robotAssembly.js'
import { createBlueprint } from '../robot/RobotBlueprint.js'
import { effectiveMass } from '../managers/physics/MassCalculator.js'
import { moduleLabels } from '../robot/ModuleLoader.js'
import { scanCapabilities, suggestLocomotion } from '../robot/autoBlueprint.js'
import { buildLinks, buildJoints, buildElectronics } from '../robot/blueprintBuilder.js'
import { validatePower } from '../robot/PowerSystem.js'
import { AI_BEHAVIORS } from '../robot/ai/behaviors.js'

// The UI offers only the robot types the simulator drives end-to-end today.
// Tracked / drone / marine / hybrid stay supported by the blueprint + module
// architecture (RobotBlueprint.LOCOMOTION_TYPES) — they are just not offered here.
const VISIBLE_TYPES = ['wheels', 'legs']

const LOCO_META = {
  wheels: { icon: '🛞', label: 'Wheeled' },
  tracks: { icon: '🚜', label: 'Tracked' },
  legs:   { icon: '🕷', label: 'Legged' },
  rotors: { icon: '🚁', label: 'Drone' },
  marine: { icon: '🌊', label: 'Marine' },
  hybrid: { icon: '🧩', label: 'Hybrid' },
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
    const links       = buildLinks(chosen.rootId, chosen.memberIds)  // link tree from bonds + attachments
    const joints      = buildJoints(chosen.memberIds)                // jointStore joints within this robot
    const connections = buildElectronics(chosen.memberIds)           // wiring conns within this robot
    const bp = createBlueprint({
      rootId: chosen.rootId,
      members: chosen.memberIds,
      robotName: name.trim() || chosen.name || 'Robot',
      locomotion: { type: loco, params: {} },
      actuators, sensors, controller, links, joints,
      electronics: { connections },
    })
    addBlueprint(bp)
    snapshot()
    setName('')
  }

  // When the assembly changes, pre-suggest a locomotion type from its components.
  const onPickAssembly = (id) => {
    setRootId(id)
    const a = assemblies.find(x => x.rootId === id)
    if (a) { const { actuators } = scanCapabilities(a.memberIds, byId); const t = suggestLocomotion(actuators); setLoco(VISIBLE_TYPES.includes(t) ? t : 'wheels') }
  }

  const [editing, setEditing] = useState(null)   // blueprint id whose details are open

  const statsOf = (bp) => {
    const members = (bp.members ?? []).map(id => byId[id]).filter(Boolean)
    const mass = members.reduce((m, o) => m + effectiveMass(o), 0)
    const servos = (bp.actuators ?? []).filter(x => x.type === 'servo').length
    return { mass, parts: members.length, joints: (bp.joints?.length ?? 0) + servos }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Generate (top) ───────────────────────────────────────────────── */}
      <section className="ui-card p-3 flex flex-col gap-2.5">
        <div className="ui-section-title">Robot</div>
        {assemblies.length === 0 ? (
          <div className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--g-400))' }}>
            Build a robot first — bond parts together and attach wheels or legs — then generate it here.
          </div>
        ) : (
          <>
            <label className="text-[10px] font-semibold" style={{ color: 'rgb(var(--g-400))' }}>
              Robot Model
              <select value={rootId} onChange={e => onPickAssembly(e.target.value)}
                className="w-full mt-1 rounded-lg text-xs px-2 py-1.5 focus:outline-none" style={{ background: 'rgb(var(--g-800))', color: 'rgb(var(--g-100))', border: '1px solid rgb(var(--g-700) / 0.6)' }}>
                {assemblies.map(a => <option key={a.rootId} value={a.rootId}>{a.name} · {a.memberIds.length} parts</option>)}
              </select>
            </label>
            <label className="text-[10px] font-semibold" style={{ color: 'rgb(var(--g-400))' }}>
              Name
              <input value={name} onChange={e => setName(e.target.value)} placeholder={chosen?.name ?? 'Robot'}
                className="w-full mt-1 rounded-lg text-xs px-2 py-1.5 focus:outline-none" style={{ background: 'rgb(var(--g-800))', color: 'rgb(var(--g-100))', border: '1px solid rgb(var(--g-700) / 0.6)' }} />
            </label>
            <div>
              <div className="text-[10px] font-semibold mb-1" style={{ color: 'rgb(var(--g-400))' }}>Robot Type</div>
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Robot Type">
                {VISIBLE_TYPES.map(t => (
                  <button key={t} role="radio" aria-checked={loco === t} onClick={() => setLoco(t)}
                    className={`ui-btn flex items-center justify-center gap-1.5 ${loco === t ? 'ui-btn-primary' : ''}`}>
                    <span className="text-sm leading-none">{LOCO_META[t].icon}</span>{LOCO_META[t].label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={generate} disabled={!chosen} className="ui-btn ui-btn-primary w-full !py-2 disabled:opacity-40">
              ＋ Generate
            </button>
            <div className="text-[10px] leading-relaxed" style={{ color: 'rgb(var(--g-500))' }}>
              Actuators, sensors and the controller are filled in from the robot’s wired parts. The type decides which physics modules load.
            </div>
          </>
        )}
      </section>

      {/* ── Generated robots: below Generate, in the order they were made ─ */}
      {blueprintList.length > 0 && <div className="ui-section-title -mb-1">Generated</div>}
      {blueprintList.map(bp => {
        const st = statsOf(bp)
        const meta = LOCO_META[bp.locomotion.type] ?? { icon: '🤖', label: bp.locomotion.type }
        const open = editing === bp.id
        return (
          <article key={bp.id} className="ui-card p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-sm leading-none">{meta.icon}</span>
              <span className="text-[11px] font-bold tracking-wider uppercase" style={{ color: 'rgb(var(--a-600))' }}>{meta.label}</span>
            </div>
            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'rgb(var(--g-500))' }}>Robot Model</div>
            <div className="text-xs font-semibold truncate mb-2" style={{ color: 'rgb(var(--g-100))' }}>{bp.robotName}</div>
            <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'rgb(var(--g-500))' }}>Physics</div>
            <div className="grid grid-cols-2 gap-x-3 text-[11px] mb-2.5" style={{ color: 'rgb(var(--g-200))' }}>
              <span>Mass: {st.mass.toFixed(2)} kg</span><span>Joints: {st.joints}</span>
              <span>Parts: {st.parts}</span><span>Power: {validatePower(bp).draw_mA} mA</span>
            </div>
            <button onClick={() => setEditing(open ? null : bp.id)} aria-expanded={open} className="ui-btn w-full">
              {open ? 'Done' : 'Edit'}
            </button>

            {open && (
              <div className="mt-3 pt-3 flex flex-col gap-2.5" style={{ borderTop: '1px solid rgb(var(--g-700) / 0.45)' }}>
                <div>
                  <div className="text-[10px] font-semibold mb-1" style={{ color: 'rgb(var(--g-400))' }}>Robot Type</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {VISIBLE_TYPES.map(t => (
                      <button key={t} onClick={() => { updateBlueprint(bp.id, { locomotion: { ...bp.locomotion, type: t } }); snapshot() }}
                        className={`ui-btn ${bp.locomotion.type === t ? 'ui-btn-primary' : ''}`}>{LOCO_META[t].label}</button>
                    ))}
                  </div>
                </div>
                <label className="text-[10px] font-semibold" style={{ color: 'rgb(var(--g-400))' }}>
                  AI driver
                  <select
                    value={bp.aiModules?.[0]?.key ?? 'idle'}
                    onChange={(e) => { const k = e.target.value; updateBlueprint(bp.id, { aiModules: k === 'idle' ? [] : [{ key: k }] }); snapshot() }}
                    className="w-full mt-1 rounded-lg text-xs px-2 py-1.5 focus:outline-none" style={{ background: 'rgb(var(--g-800))', color: 'rgb(var(--g-100))', border: '1px solid rgb(var(--g-700) / 0.6)' }}
                    title="Run this robot from an AI behavior instead of firmware. Then press Simulate. Saved with the project."
                  >
                    {Object.entries(AI_BEHAVIORS).map(([key, b]) => <option key={key} value={key}>{b.label}</option>)}
                  </select>
                </label>
                {moduleLabels(bp).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {moduleLabels(bp).map(m => (
                      <span key={m} className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: 'rgb(var(--g-800))', color: 'rgb(var(--g-300))' }}>{m}</span>
                    ))}
                  </div>
                )}
                <button onClick={() => { removeBlueprint(bp.id); setEditing(null); snapshot() }} className="ui-btn ui-btn-danger w-full">Delete robot</button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
