import { useEffect, useRef, useState } from 'react'
import { combatManager } from '../../managers/CombatManager.js'
import { useCombatStore } from '../../stores/combatStore.js'

// ─────────────────────────────────────────────────────────────────────────────
// CombatHUD — third-person PvP arena overlay.
//
//   Top-left  : PLAYER — armor / core (HP) / heat + weapon + cooldown
//   Top-right : ENEMY  — armor / core / heat
//   Center    : crosshair + hit marker (damage numbers are a separate DOM layer)
//   Bottom    : ability icons (placeholders) + camera-mode legend + Exit
//
// Purely presentational: reads combatStore (mirrored from CombatManager) and only
// calls combatManager.stop(). Damage numbers render in DamageNumbers (own layer).
// ─────────────────────────────────────────────────────────────────────────────

const TEAM = { player: '#22c55e', enemy: '#ef4444' }

function Bar({ value, max, color, label, right }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', justifyContent: 'space-between', fontSize: 9, color: 'rgb(var(--g-400))', marginBottom: 2 }}>
        <span>{label}</span><span>{Math.ceil(value)}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'rgb(var(--g-800))', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, marginLeft: right ? 'auto' : 0, background: color, transition: 'width 110ms linear' }} />
      </div>
    </div>
  )
}

function CombatantCard({ a, side }) {
  const right = side === 'right'
  const accent = right ? TEAM.enemy : TEAM.player
  const dead = a.state === 'destroyed'
  const heatWarn = a.heat > a.heatMax * 0.8
  return (
    <div style={{
      width: 250, padding: '11px 13px', borderRadius: 14, textAlign: right ? 'right' : 'left',
      background: 'rgb(var(--g-900) / 0.92)', border: `1.5px solid ${accent}`,
      boxShadow: a.overheated ? '0 0 16px #ef444488' : `0 4px 18px rgba(0,0,0,.4)`, opacity: dead ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginBottom: 7 }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 5, background: accent, color: '#fff' }}>
          {right ? 'Enemy' : 'You'}
        </span>
        {a.class && <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: 4, background: 'rgb(var(--g-800))', color: 'rgb(var(--g-300))' }}>{a.class}</span>}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--g-100))' }}>{a.name}{dead && ' 💥'}</span>
        {a.staggered && <span style={badge('#f59e0b')}>STAGGER</span>}
        {a.overheated && <span style={badge('#ef4444')}>OVERHEAT</span>}
      </div>
      <Bar value={a.armor} max={a.armorMax} color="#38bdf8" label="ARMOR" right={right} />
      <Bar value={a.core} max={a.coreMax} color={accent} label="HP" right={right} />
      <Bar value={a.stability} max={a.stabilityMax} color="#f59e0b" label="STABILITY" right={right} />
      <Bar value={a.heat} max={a.heatMax} color={heatWarn ? '#ef4444' : '#fb923c'} label="HEAT" right={right} />
      {a.weaponName && (
        <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', justifyContent: 'space-between', fontSize: 10, marginTop: 5, color: 'rgb(var(--g-300))' }}>
          <span>🔫 {a.weaponName}</span>
          <span style={{ color: a.reloading ? '#f59e0b' : 'rgb(var(--g-400))', fontWeight: 700 }}>
            {a.reloading ? 'RELOAD…' : `${a.ammo}/${a.magSize}`}
          </span>
        </div>
      )}
    </div>
  )
}

// Center crosshair + hit marker (brief X-flash when the player lands a hit).
function Crosshair() {
  const hitAt = useCombatStore((s) => s.hitMarkerAt)
  const [hit, setHit] = useState(false)
  useEffect(() => {
    if (!hitAt) return
    setHit(true)
    const t = setTimeout(() => setHit(false), 180)
    return () => clearTimeout(t)
  }, [hitAt])
  return (
    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 40, height: 40 }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.35)' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,.8)', transform: 'translate(-50%,-50%)' }} />
      {/* hit marker */}
      {hit && ['45deg', '-45deg'].map((r, i) => (
        <div key={i} style={{ position: 'absolute', top: '50%', left: '50%', width: 22, height: 3, background: '#fca5a5', borderRadius: 2, transform: `translate(-50%,-50%) rotate(${r})` }} />
      ))}
    </div>
  )
}

// Bottom ability bar — placeholder slots (primary/secondary + two empty).
function AbilityBar({ player }) {
  const slots = [
    { icon: '🔫', label: 'LMB', name: player?.weaponName || 'Primary', ready: true },
    { icon: '🗡', label: 'RMB', name: player?.secondaryName || 'Secondary', ready: player?.secondaryReady !== false },
    { icon: '＋', label: 'Q', name: 'Ability', ready: false },
    { icon: '＋', label: 'E', name: 'Ability', ready: false },
  ]
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {slots.map((s, i) => (
        <div key={i} title={s.name} style={{
          width: 46, height: 46, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgb(var(--g-900) / 0.9)', border: `1px solid ${s.ready ? 'rgb(var(--a-500))' : 'rgb(var(--g-700))'}`,
          opacity: s.ready ? 1 : 0.45,
        }}>
          <span style={{ fontSize: 17, lineHeight: 1 }}>{s.icon}</span>
          <span style={{ fontSize: 8, color: 'rgb(var(--g-400))', marginTop: 2 }}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}

const CAM_LABELS = { default: 'Combat', shoulder: 'Shoulder (F1)', tactical: 'Tactical (F2)', orbit: 'Orbit (F3)', topdown: 'Top-Down (F4)' }

export default function CombatHUD() {
  const arenaActive = useCombatStore((s) => s.arenaActive)
  const actors = useCombatStore((s) => s.actors)
  const status = useCombatStore((s) => s.status)
  const message = useCombatStore((s) => s.message)
  const playerId = useCombatStore((s) => s.playerId)
  const enemyId = useCombatStore((s) => s.enemyId)
  const cameraMode = useCombatStore((s) => s.cameraMode)
  if (!arenaActive) return null

  const list = Object.values(actors)
  const player = (playerId && actors[playerId]) || list[0]
  const enemy = (enemyId && actors[enemyId]) || list[1]
  const fighting = status === 'fighting'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'none' }}>
      {/* Player (top-left) + Enemy (top-right) */}
      <div style={{ position: 'absolute', top: 14, left: 14 }}>{player && <CombatantCard a={player} side="left" />}</div>
      <div style={{ position: 'absolute', top: 14, right: 14 }}>{enemy && <CombatantCard a={enemy} side="right" />}</div>

      {/* Center crosshair + hit marker (only while fighting) */}
      {fighting && <Crosshair />}

      {/* Player overheat vignette */}
      {player?.overheated && (
        <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 180px 40px rgba(239,68,68,.35)', animation: 'none' }} />
      )}

      {/* Center status banner */}
      {status === 'loading' && <div style={bannerStyle}>Deploying…</div>}
      {message && <div style={{ ...bannerStyle, borderColor: status === 'over' ? '#22c55e' : 'rgb(var(--a-500))' }}>{message}</div>}

      {/* Camera-mode legend (top-center) */}
      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: 'rgb(var(--g-400))', background: 'rgb(var(--g-900) / 0.7)', padding: '3px 10px', borderRadius: 8 }}>
        📷 {CAM_LABELS[cameraMode] || 'Combat'} · F1–F4 views
      </div>

      {/* Bottom: abilities + controls hint + Exit */}
      <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 18px' }}>
        <div style={{ pointerEvents: 'auto' }}><AbilityBar player={player} /></div>
        <div style={{ fontSize: 11, color: 'rgb(var(--g-400))', textAlign: 'center', alignSelf: 'center' }}>
          <b style={{ color: 'rgb(var(--g-200))' }}>WASD</b> move · <b style={{ color: 'rgb(var(--g-200))' }}>LMB</b> primary · <b style={{ color: 'rgb(var(--g-200))' }}>RMB</b> secondary
        </div>
        <button
          onClick={() => combatManager.stop()}
          style={{ pointerEvents: 'auto', padding: '9px 18px', borderRadius: 9, fontWeight: 700, fontSize: 12, color: '#fff', background: '#dc2626', border: 'none', cursor: 'pointer' }}
        >
          Exit Arena
        </button>
      </div>
    </div>
  )
}

const badge = (color) => ({ fontSize: 8, fontWeight: 800, letterSpacing: '.06em', padding: '1px 5px', borderRadius: 4, background: color, color: '#fff' })

const bannerStyle = {
  position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)',
  padding: '12px 28px', borderRadius: 12, fontSize: 22, fontWeight: 800, color: '#fff',
  background: 'rgb(var(--g-900) / 0.9)', border: '1.5px solid rgb(var(--a-500))', pointerEvents: 'none',
}
