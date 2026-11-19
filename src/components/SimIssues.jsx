// "Why isn't it moving?" — the simulator's diagnosis, in the sim HUD.
// Each issue says WHERE the problem is (CAD / Electronics / Code), what is
// wrong, and how to fix it, with a button that opens that workspace.
import { useState } from 'react'
import { usePhysicsStore } from '../stores/physicsStore.js'
import { useUiStore } from '../stores/uiStore.js'
import { CATEGORY_LABEL } from '../managers/physics/robotics/diagnosis.js'

const CHIP = {
  cad:         'bg-sky-600 border-sky-700 text-white',
  electronics: 'bg-amber-600 border-amber-700 text-white',
  code:        'bg-fuchsia-600 border-fuchsia-700 text-white',
}
const ORDER = { error: 0, warning: 1 }

/** Which right-panel section fixes it. */
function panelFor(issue) {
  if (issue.category === 'electronics') return 'wiring'
  if (issue.category === 'code') return 'code'
  return /Physics →/.test(issue.fix) ? 'physics' : 'objects'
}

export function SimModeBadge() {
  const mode = usePhysicsStore(s => s.simMode)
  if (!mode) return null
  const look = {
    real:       ['Real physics', 'bg-green-600 border-green-700 text-white', 'Servo torque, joints, contacts and friction move the robot.'],
    simplified: ['Simplified walk', 'bg-slate-500 border-slate-600 text-white', 'You chose Physics model = kinematic: the body is moved at the commanded speed, not by the feet.'],
    blocked:    ['Not simulated', 'bg-red-600 border-red-700 text-white', "The physics engine couldn't model this robot, so it won't move."],
  }[mode]
  if (!look) return null
  return (
    <span title={look[2]} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${look[1]}`}>{look[0]}</span>
  )
}

export default function SimIssues() {
  const issues = usePhysicsStore(s => s.simIssues)
  const setActivePanel = useUiStore(s => s.setActivePanel)
  const [open, setOpen] = useState({})
  if (!issues.length) return null
  const sorted = [...issues].sort((a, b) => (ORDER[a.severity] ?? 2) - (ORDER[b.severity] ?? 2))
  // Fixed colours (zinc/red/amber are NOT theme-remapped): a solid dark card
  // that reads the same on the light and the dark HUD.
  return (
    <div className="px-4 pt-2 space-y-1.5" data-testid="sim-issues">
      {sorted.map(i => (
        <div key={i.id} className={`rounded-md border-l-4 border bg-zinc-900 px-3 py-2 text-[11px] shadow ${i.severity === 'error' ? 'border-red-500' : 'border-amber-400'}`}>
          <div className="flex items-center gap-2">
            <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${CHIP[i.category] ?? CHIP.cad}`}>
              {CATEGORY_LABEL[i.category] ?? i.category}
            </span>
            <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${i.severity === 'error' ? 'text-red-400' : 'text-amber-300'}`}>
              {i.severity === 'error' ? 'Error' : 'Warning'}
            </span>
            <span className="font-semibold text-zinc-50 truncate">{i.title}</span>
            <button onClick={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))}
              className="ml-auto shrink-0 text-zinc-300 hover:text-white underline">{open[i.id] ? 'Less' : 'Why?'}</button>
            <button onClick={() => setActivePanel(panelFor(i))}
              className="shrink-0 px-2 py-0.5 rounded border border-zinc-600 bg-zinc-800 hover:bg-zinc-700 text-zinc-100">Open {CATEGORY_LABEL[i.category]}</button>
          </div>
          {open[i.id] && <div className="mt-1 text-zinc-300 leading-snug">{i.detail}</div>}
          <div className="mt-1 text-zinc-100 leading-snug"><span className="font-semibold text-emerald-400">Fix: </span>{i.fix}</div>
        </div>
      ))}
    </div>
  )
}
