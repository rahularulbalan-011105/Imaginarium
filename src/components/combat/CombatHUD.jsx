import { combatManager } from '../../managers/CombatManager.js'
import { useCombatStore } from '../../stores/combatStore.js'

// ─────────────────────────────────────────────────────────────────────────────
// CombatHUD — Stage 1 arena overlay. Shows each robot's armor (top) + core
// (bottom) HP layers, plus the match status/winner banner and an Exit button.
// Purely presentational: reads combatStore (mirrored from CombatManager) and only
// calls combatManager.stop(). Rendered above the viewport when arenaActive.
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_COLORS = ['#4f46e5', '#ef4444', '#059669', '#f59e0b']

function Bar({ value, max, color, label }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div style={{ marginBottom: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgb(var(--g-400))', marginBottom: 1 }}>
        <span>{label}</span><span>{Math.ceil(value)}</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: 'rgb(var(--g-800))', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 120ms linear' }} />
      </div>
    </div>
  )
}

function RobotCard({ a, align }) {
  const dead = a.state === 'destroyed'
  const accent = TEAM_COLORS[a.team % TEAM_COLORS.length]
  return (
    <div style={{
      width: 210, padding: '10px 12px', borderRadius: 12,
      background: 'rgb(var(--g-900) / 0.92)', border: `1px solid ${accent}`,
      textAlign: align, opacity: dead ? 0.5 : 1,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--g-100))', marginBottom: 6 }}>
        {a.name} {dead && '💥'}
      </div>
      <Bar value={a.armor} max={a.armorMax} color="#38bdf8" label="ARMOR" />
      <Bar value={a.core}  max={a.coreMax}  color={accent} label="CORE" />
    </div>
  )
}

export default function CombatHUD() {
  const arenaActive = useCombatStore((s) => s.arenaActive)
  const actors      = useCombatStore((s) => s.actors)
  const status      = useCombatStore((s) => s.status)
  const message     = useCombatStore((s) => s.message)
  if (!arenaActive) return null

  const list = Object.values(actors)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'none' }}>
      {/* Top bar: robot HP cards */}
      <div style={{ position: 'absolute', top: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 16 }}>
        {list.map((a, i) => <RobotCard key={a.id} a={a} align={i === 0 ? 'left' : 'right'} />)}
      </div>

      {/* Center status banner */}
      {status === 'loading' && (
        <div style={bannerStyle}>Loading physics…</div>
      )}
      {message && (
        <div style={{ ...bannerStyle, borderColor: '#f59e0b' }}>{message}</div>
      )}

      {/* Controls hint + Exit */}
      <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 12, pointerEvents: 'auto' }}>
        <div style={{ fontSize: 11, color: 'rgb(var(--g-400))', alignSelf: 'center' }}>
          P1: WASD · P2: Arrows · ram to damage
        </div>
        <button
          onClick={() => combatManager.stop()}
          style={{ padding: '8px 16px', borderRadius: 8, fontWeight: 700, fontSize: 12, color: '#fff', background: '#dc2626', border: 'none', cursor: 'pointer' }}
        >
          Exit Arena
        </button>
      </div>
    </div>
  )
}

const bannerStyle = {
  position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%,-50%)',
  padding: '12px 26px', borderRadius: 12, fontSize: 20, fontWeight: 800, color: '#fff',
  background: 'rgb(var(--g-900) / 0.9)', border: '1px solid rgb(var(--a-500))',
}
