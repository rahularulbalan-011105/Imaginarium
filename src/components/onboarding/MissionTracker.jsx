import { useEffect, useRef, useState } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'
import { useSceneStore } from '../../stores/sceneStore.js'
import { useElectronicsStore } from '../../stores/electronicsStore.js'
import { useUiStore } from '../../stores/uiStore.js'
import { MISSIONS } from '../../onboarding/missions.js'

// Learn-by-doing checklist. It OBSERVES the app's real state to know when a
// mission is done — it never adds, moves, or changes any object, and never
// calls a manager. Completely non-destructive: the user performs every action.

export default function MissionTracker() {
  const active   = useOnboardingStore((s) => s.missionsActive)
  const index    = useOnboardingStore((s) => s.missionIndex)
  const flash    = useOnboardingStore((s) => s.missionFlash)
  const advance  = useOnboardingStore((s) => s.advanceMission)
  const clearFl  = useOnboardingStore((s) => s.clearMissionFlash)
  const end      = useOnboardingStore((s) => s.endMissions)
  const restart  = useOnboardingStore((s) => s.restartMissions)

  // Read-only subscriptions used purely for progress detection.
  const objects     = useSceneStore((s) => s.objects)
  const connections = useElectronicsStore((s) => s.connections)
  const simRunning  = useElectronicsStore((s) => s.simulation.running)
  const activePanel = useUiStore((s) => s.activePanel)
  const simActive   = useUiStore((s) => s.simActive)

  const [collapsed, setCollapsed] = useState(false)
  const baseline = useRef({ pos: {}, scale: {}, conn: 0 })

  // Snapshot a baseline whenever the active mission changes, so "move" / "resize"
  // / "connect" compare against the state at the moment the mission began.
  useEffect(() => {
    if (!active) return
    const objs = useSceneStore.getState().objects
    baseline.current = {
      pos:   Object.fromEntries(objs.map((o) => [o.id, { ...o.position }])),
      scale: Object.fromEntries(objs.map((o) => [o.id, { ...o.scale }])),
      conn:  Object.keys(useElectronicsStore.getState().connections).length,
    }
  }, [index, active])

  // Detect completion of the current mission.
  useEffect(() => {
    if (!active) return
    const m = MISSIONS[index]
    if (!m) return
    const changed = (a, b) =>
      !!a && !!b && (Math.abs(a.x - b.x) > 1e-3 || Math.abs(a.y - b.y) > 1e-3 || Math.abs(a.z - b.z) > 1e-3)

    let done = false
    switch (m.id) {
      case 'cube':    done = objects.some((o) => o.type === 'box'); break
      case 'move':    done = objects.some((o) => changed(o.position, baseline.current.pos[o.id])); break
      case 'scale':   done = objects.some((o) => changed(o.scale, baseline.current.scale[o.id])); break
      case 'arduino': done = objects.some((o) => o.type === 'arduino' || o.type === 'subo'); break
      case 'motor':   done = objects.some((o) => ['motor', 'motor_bo', 'motor_dc'].includes(o.type)); break
      case 'wire':    done = Object.keys(connections).length > baseline.current.conn; break
      case 'code':    done = activePanel === 'code'; break
      case 'run':     done = simRunning || simActive; break
      default: done = false
    }
    if (done) advance(m.flash)
  }, [active, index, objects, connections, simRunning, activePanel, simActive, advance])

  // Auto-dismiss the feedback toast.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(clearFl, 2400)
    return () => clearTimeout(t)
  }, [flash, clearFl])

  if (!active) return null

  const allDone = index >= MISSIONS.length
  const current = MISSIONS[index]

  return (
    <>
      {/* Feedback toast */}
      {flash && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[115] pointer-events-none">
          <div className="px-4 py-2 rounded-full text-sm font-bold text-slate-900 shadow-2xl animate-bounce"
            style={{ background: 'linear-gradient(90deg,#16a34a,#15803d)' }}>
            {flash}
          </div>
        </div>
      )}

      {/* Checklist card (bottom-right, out of the way) */}
      <div className="fixed bottom-10 right-4 z-[110] w-64 rounded-xl shadow-2xl overflow-hidden"
        style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500) / 0.3)' }}>

        <div className="flex items-center gap-2 px-3 py-2"
          style={{ background: 'linear-gradient(90deg, rgb(var(--a-500) / 0.15), transparent)' }}>
          <span className="text-sm">🎓</span>
          <span className="text-xs font-bold text-indigo-800 flex-1">
            {allDone ? 'Tutorial complete!' : `Mission ${index + 1} of ${MISSIONS.length}`}
          </span>
          <button onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand' : 'Collapse'}
            className="text-gray-500 hover:text-slate-900 text-xs leading-none">{collapsed ? '▢' : '—'}</button>
          <button onClick={end} title="Exit tutorial"
            className="text-gray-500 hover:text-slate-900 text-xs leading-none">✕</button>
        </div>

        {!collapsed && (
          <div className="px-3 py-2">
            {allDone ? (
              <div className="text-center py-2">
                <div className="text-3xl mb-2">🤖🎉</div>
                <div className="text-xs text-gray-300 leading-relaxed mb-3">
                  You built, wired, programmed, and simulated a robot. You know the whole workflow now!
                </div>
                <div className="flex gap-2">
                  <button onClick={restart}
                    className="flex-1 py-1.5 rounded text-xs text-gray-300 bg-gray-700/60 hover:bg-gray-600 transition-colors">↻ Again</button>
                  <button onClick={end}
                    className="flex-1 py-1.5 rounded text-xs font-semibold text-white transition-all hover:brightness-110"
                    style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))' }}>Done ✓</button>
                </div>
              </div>
            ) : (
              <>
                {/* Current mission call-out */}
                <div className="mb-2 p-2 rounded-lg" style={{ background: 'rgb(var(--a-500) / 0.08)', border: '1px solid rgb(var(--a-500) / 0.18)' }}>
                  <div className="text-xs font-semibold text-indigo-800 mb-0.5">{current.label}</div>
                  <div className="text-[10px] text-gray-400 leading-snug">{current.tip}</div>
                </div>
                {/* Compact checklist */}
                <div className="space-y-0.5 max-h-44 overflow-y-auto">
                  {MISSIONS.map((m, i) => {
                    const isDone = i < index
                    const isCur  = i === index
                    return (
                      <div key={m.id} className={`flex items-center gap-2 text-[11px] px-1 py-0.5 rounded ${isCur ? 'text-indigo-800' : isDone ? 'text-gray-500' : 'text-gray-600'}`}>
                        <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                          isDone ? 'bg-green-600 text-white' : isCur ? 'border border-indigo-500 text-indigo-400' : 'border border-gray-600'
                        }`}>
                          {isDone ? '✓' : i + 1}
                        </span>
                        <span className={isDone ? 'line-through' : ''}>{m.label}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
