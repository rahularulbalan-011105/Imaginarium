import { useUiStore } from '../stores/uiStore.js'
import { usePhysicsStore } from '../stores/physicsStore.js'
import Icon from './ui/Icon.jsx'
import { trackEvent } from '../utils/utmTracking.js'

// ─────────────────────────────────────────────────────────────────────────────
// SimulationPanel — a single home for the simulation entry points that used to
// be scattered (the Simulate toggle lived in the left toolbar; physics/env in
// the drive HUD; battle in its own tab). PRESENTATION ONLY: every control here
// calls an EXISTING store action (uiStore.setSimActive, physicsStore.
// setEnvironment, activePanel switch) — no behavior is added or changed. The
// detailed drive / robot controls still appear as the in-viewport DrivePanel
// HUD while a simulation is running (unchanged).
// ─────────────────────────────────────────────────────────────────────────────

const ENVIRONMENTS = [
  { id: 'earth',  label: 'Earth',  emoji: '🌍' },
  { id: 'moon',   label: 'Moon',   emoji: '🌙' },
  { id: 'mars',   label: 'Mars',   emoji: '🔴' },
  { id: 'zero_g', label: 'Zero-G', emoji: '🛰️' },
]

function SectionTitle({ children }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgb(var(--g-500))' }}>
      {children}
    </div>
  )
}

export default function SimulationPanel() {
  const simActive    = useUiStore((s) => s.simActive)
  const setSimActive = useUiStore((s) => s.setSimActive)
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const environment  = usePhysicsStore((s) => s.environment)
  const setEnvironment = usePhysicsStore((s) => s.setEnvironment)
  const gravity      = usePhysicsStore((s) => s.gravity)

  return (
    <div className="p-3 flex flex-col gap-4">
      {/* ── Run / Stop ─────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Simulation</SectionTitle>
        <button
          data-tour="simulate"
          onClick={() => { if (!simActive) trackEvent('sim_started'); setSimActive(!simActive) }}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${simActive ? 'animate-pulse' : 'hover:brightness-110'}`}
          style={simActive
            ? { background: '#eab308', color: '#1a1a1a', boxShadow: '0 2px 10px rgba(234,179,8,0.4)' }
            : { background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))', color: '#fff', boxShadow: '0 2px 10px rgb(var(--a-600) / 0.35)' }}
        >
          <Icon name={simActive ? 'stop' : 'play'} size={16} />
          {simActive ? 'Stop Simulation' : 'Start Simulation'}
        </button>
        <div className="text-[11px] mt-2 leading-snug" style={{ color: 'rgb(var(--g-400))' }}>
          {simActive
            ? 'Running with physics. Drive & robot controls appear in the viewport HUD.'
            : 'Applies gravity, friction and wind so you can drive and test the build.'}
        </div>
      </div>

      {/* ── Environment ────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Environment</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          {ENVIRONMENTS.map((env) => {
            const active = environment === env.id
            return (
              <button
                key={env.id}
                onClick={() => setEnvironment(env.id)}
                className="flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-colors"
                style={active
                  ? { background: 'rgb(var(--a-600))', color: '#fff' }
                  : { background: 'rgb(var(--g-800) / 0.6)', color: 'rgb(var(--g-300))' }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgb(var(--a-600) / 0.14)' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'rgb(var(--g-800) / 0.6)' }}
              >
                <span>{env.emoji}</span>{env.label}
              </button>
            )
          })}
        </div>
        <div className="text-[11px] mt-2" style={{ color: 'rgb(var(--g-500))' }}>
          Gravity: {gravity.toFixed(2)} m/s²
        </div>
      </div>

      {/* ── Game mode ──────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Game Mode</SectionTitle>
        <button
          onClick={() => setActivePanel('battle')}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-xs transition-colors"
          style={{ background: 'rgb(168 85 247 / 0.16)', color: 'rgb(var(--g-200))', border: '1px solid rgb(168 85 247 / 0.4)' }}
        >
          <Icon name="swords" size={15} /> Open Robo-Sumo Battle
        </button>
        <div className="text-[11px] mt-2 leading-snug" style={{ color: 'rgb(var(--g-500))' }}>
          Push your opponent out of the ring — local 2-player or online.
        </div>
      </div>
    </div>
  )
}
