import { lazy, Suspense } from 'react'
import { useSimToggle } from '../managers/simControl.js'
import { recordSnapshot } from '../managers/history/editorDispatch.js'
import { usePhysicsStore } from '../stores/physicsStore.js'
import Icon from './ui/Icon.jsx'
import { useSceneStore } from '../stores/sceneStore.js'
// Lazy: the ESP32 section is only mounted when the scene actually has a board.
const Esp32Panel = lazy(() => import('./Esp32Panel.jsx'))

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
    <div className="ui-section-title mb-2">
      {children}
    </div>
  )
}

export default function SimulationPanel() {
  const { simActive, preparing, toggle } = useSimToggle()
  const environment  = usePhysicsStore((s) => s.environment)
  const setEnvironment = usePhysicsStore((s) => s.setEnvironment)
  const gravity      = usePhysicsStore((s) => s.gravity)
  // The ESP32 section only exists when the scene actually has an ESP32 board.
  const hasEsp32 = useSceneStore((s) => s.objects.some((o) => o.type === 'esp32'))

  return (
    <div className="p-3 flex flex-col gap-4">
      {/* ── Run / Stop ─────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Run</SectionTitle>
        <button
          data-tour="simulate"
          onClick={toggle}
          disabled={preparing}
          className={`w-full ${simActive ? 'ui-btn' : 'ui-btn ui-btn-primary'}`}
          style={{ height: 36, ...(simActive ? { color: '#b91c1c', borderColor: 'rgb(220 38 38 / 0.45)' } : null) }}
        >
          <Icon name={simActive ? 'stop' : 'play'} size={14} />
          {preparing ? 'Starting…' : simActive ? 'Stop simulation' : 'Start simulation'}
        </button>
        <div className="text-[12px] mt-2 leading-snug" style={{ color: 'rgb(var(--g-500))' }}>
          {simActive
            ? 'Running. Drive controls are at the bottom of the 3D view.'
            : 'Adds gravity, friction and wind so you can drive and test what you built. The Simulate button in the top bar does the same.'}
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
                onClick={() => { setEnvironment(env.id); recordSnapshot('Environment') }}
                aria-pressed={active}
                className="ui-btn justify-start"
                style={active ? { borderColor: 'rgb(var(--a-600))', color: 'rgb(var(--a-700))', background: 'rgb(var(--a-600) / 0.08)' } : undefined}
              >
                {env.label}
              </button>
            )
          })}
        </div>
        <div className="text-[11px] mt-2" style={{ color: 'rgb(var(--g-500))' }}>
          Gravity: {gravity.toFixed(2)} m/s²
        </div>
      </div>

      {/* ── ESP32 (only when the scene has one) ───────────────────────────── */}
      {hasEsp32 && (
        <div className="-mx-3 -mb-3">
          <Suspense fallback={null}><Esp32Panel /></Suspense>
        </div>
      )}
    </div>
  )
}
