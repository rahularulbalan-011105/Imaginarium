import { useEffect, useRef, useState } from 'react'
import { combatManager } from '../../managers/CombatManager.js'
import { useCombatStore } from '../../stores/combatStore.js'
import { useGameStore } from '../../stores/gameStore.js'

// ─────────────────────────────────────────────────────────────────────────────
// CombatHUD — BattleBot Arena overlay.
//
// Rendered inside the Viewport container (absolute, not fixed): it covers the
// 3D view only — never the header, right panel or status bar.
//
//   Top-left / right : YOU / ENEMY cards (armor · HP · stability · heat · weapon)
//   Top-centre       : match clock + difficulty + camera mode
//   Centre           : crosshair ON THE REAL AIM POINT (CombatManager.aim — the
//                      ray WeaponManager fires along, projected to the screen),
//                      target / range / reload state, hit marker on confirmed hits
//   Bottom           : weapon slots (LMB / RMB) with live readiness, controls
//                      (from the user's actual bindings), Pause + Exit
//   Overlays         : Pause (Resume / Restart / Exit), Result (Rematch / Exit),
//                      combat callouts (component lost, …)
//
// Purely presentational: reads combatStore (mirrored from CombatManager) and the
// per-frame aim object; calls combatManager.stop / restart / togglePause only.
// Damage numbers render in DamageNumbers (own layer, z 95).
// ─────────────────────────────────────────────────────────────────────────────

const TEAM = { player: '#22c55e', enemy: '#ef4444' }
const Z_HUD = 90

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
  const weaponState = !a.weaponName ? null : a.reloading ? 'RELOADING' : a.ammo <= 0 ? 'EMPTY' : 'READY'
  return (
    <div style={{
      width: 'min(250px, 32vw)', padding: '11px 13px', borderRadius: 14, textAlign: right ? 'right' : 'left',
      background: 'rgb(var(--g-900) / 0.92)', border: `1.5px solid ${accent}`,
      boxShadow: a.overheated ? '0 0 16px #ef444488' : '0 4px 18px rgba(0,0,0,.4)', opacity: dead ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 5, background: accent, color: '#fff' }}>
          {right ? 'Enemy' : 'You'}
        </span>
        {a.class && <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: 4, background: 'rgb(var(--g-800))', color: 'rgb(var(--g-300))' }}>{a.class}</span>}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--g-100))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{a.name}{dead && ' 💥'}</span>
        {a.staggered && <span style={badge('#f59e0b')}>STAGGER</span>}
        {a.overheated && <span style={badge('#ef4444')}>OVERHEAT</span>}
      </div>
      <Bar value={a.armor} max={a.armorMax} color="#38bdf8" label="ARMOR" right={right} />
      <Bar value={a.core} max={a.coreMax} color={accent} label="HP" right={right} />
      <Bar value={a.stability} max={a.stabilityMax} color="#f59e0b" label="STABILITY" right={right} />
      <Bar value={a.heat} max={a.heatMax} color={heatWarn ? '#ef4444' : '#fb923c'} label="HEAT" right={right} />
      <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', justifyContent: 'space-between', fontSize: 10, marginTop: 5, color: 'rgb(var(--g-300))' }}>
        <span>🔫 {a.weaponName || 'No weapon — melee only'}</span>
        {weaponState && (
          <span style={{ color: weaponState === 'READY' ? '#86efac' : '#f59e0b', fontWeight: 700 }}>
            {weaponState === 'READY' ? `${a.ammo}/${a.magSize}` : weaponState}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Crosshair ────────────────────────────────────────────────────────────────
// Positioned every animation frame from combatManager.aim (imperative DOM, no
// React re-render). Colour/label reflect the REAL firing state:
//   white  = aim point in open space        orange = enemy in the beam, in range
//   dim    = enemy in the beam, out of range / weapon not ready
//   X mark = a hit confirmed by the damage pipeline (hitMarkerAt)
function Crosshair({ active }) {
  const ref = useRef(null), labelRef = useRef(null), ringRef = useRef(null)
  const hitAt = useCombatStore((s) => s.hitMarkerAt)
  const [hit, setHit] = useState(false)
  useEffect(() => {
    if (!hitAt) return
    setHit(true)
    const t = setTimeout(() => setHit(false), 160)
    return () => clearTimeout(t)
  }, [hitAt])
  useEffect(() => {
    if (!active) return
    let raf = 0, lastLabel = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = ref.current, aim = combatManager.aim
      if (!el) return
      if (!aim.visible) { el.style.opacity = '0'; return }
      el.style.opacity = '1'
      el.style.transform = `translate(${aim.x}px, ${aim.y}px) translate(-50%, -50%)`
      const color = aim.onTarget ? (aim.inRange && aim.ready ? '#fb923c' : 'rgba(251,146,60,.55)') : 'rgba(255,255,255,.75)'
      const ring = ringRef.current
      if (ring) { ring.style.borderColor = color; ring.style.transform = aim.onTarget ? 'scale(0.82)' : 'scale(1)' }
      const label = aim.reloading ? 'RELOADING' : aim.onTarget && !aim.inRange ? `OUT OF RANGE · ${Math.round(aim.dist)}` : aim.onTarget ? (aim.ready ? 'TARGET' : 'COOLING') : aim.blocked ? '' : ''
      if (label !== lastLabel && labelRef.current) { labelRef.current.textContent = label; lastLabel = label }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  if (!active) return null
  return (
    <div ref={ref} style={{ position: 'fixed', left: 0, top: 0, width: 44, height: 44, opacity: 0, willChange: 'transform', pointerEvents: 'none' }}>
      <div ref={ringRef} style={{ position: 'absolute', inset: 4, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.75)', transition: 'transform 90ms, border-color 90ms', boxShadow: '0 0 0 1px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.45)' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 3, height: 3, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.6)', transform: 'translate(-50%,-50%)' }} />
      {['0deg', '90deg'].map((r) => (
        <div key={r} style={{ position: 'absolute', top: '50%', left: '50%', width: 14, height: 1.5, background: 'rgba(255,255,255,.75)', boxShadow: '0 0 0 0.5px rgba(0,0,0,.5)', transform: `translate(-50%,-50%) rotate(${r})` }} />
      ))}
      {hit && ['45deg', '-45deg'].map((r) => (
        <div key={r} style={{ position: 'absolute', top: '50%', left: '50%', width: 26, height: 3, background: '#fca5a5', borderRadius: 2, boxShadow: '0 0 6px #ef4444', transform: `translate(-50%,-50%) rotate(${r})` }} />
      ))}
      <div ref={labelRef} style={{ position: 'absolute', top: 46, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 9, fontWeight: 800, letterSpacing: '.08em', color: '#fde68a', textShadow: '0 1px 2px #000' }} />
    </div>
  )
}

// Bottom weapon slots — real readiness from the actor mirror (WeaponManager).
function WeaponSlots({ player }) {
  const slots = [
    { key: 'LMB', icon: '🔫', name: player?.weaponName, ready: !!player?.weaponName && !player.reloading && player.ammo > 0, sub: player?.weaponName ? (player.reloading ? 'reload' : `${player.ammo}/${player.magSize}`) : 'none' },
    { key: 'RMB', icon: '🗡', name: player?.secondaryName || 'Melee Strike', ready: player?.secondaryReady !== false, sub: player?.secondaryReady === false ? 'cooling' : 'ready' },
  ]
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {slots.map((s) => (
        <div key={s.key} title={s.name || 'No weapon mounted'} style={{
          minWidth: 78, padding: '6px 8px', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center',
          background: 'rgb(var(--g-900) / 0.9)', border: `1px solid ${s.ready ? 'rgb(var(--a-500))' : 'rgb(var(--g-700))'}`, opacity: s.name ? 1 : 0.5,
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{s.icon}</span>
          <span style={{ fontSize: 9, color: 'rgb(var(--g-200))', marginTop: 3, fontWeight: 700 }}>{s.key}</span>
          <span style={{ fontSize: 8, color: s.ready ? '#86efac' : '#f59e0b', marginTop: 1, textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.sub}</span>
        </div>
      ))}
    </div>
  )
}

const keyName = (k) => ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Space' }[k] ?? (k || '').toUpperCase())
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const CAM_LABELS = { default: 'Combat', shoulder: 'Shoulder (F1)', tactical: 'Tactical (F2)', orbit: 'Orbit (F3)', topdown: 'Top-Down (F4)' }

function Notices() {
  const notices = useCombatStore((s) => s.notices)
  const [, force] = useState(0)
  useEffect(() => { const t = setInterval(() => force(n => n + 1), 500); return () => clearInterval(t) }, [])
  const now = performance.now()
  const live = notices.filter(n => now - n.at < 4200)
  if (!live.length) return null
  return (
    <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {live.map(n => (
        <div key={n.id} style={{ fontSize: 12, fontWeight: 700, color: '#fde68a', background: 'rgb(var(--g-900) / 0.85)', border: '1px solid #f59e0b88', padding: '4px 12px', borderRadius: 8, opacity: Math.max(0.15, 1 - (now - n.at - 2800) / 1400) }}>
          ⚠ {n.text}
        </div>
      ))}
    </div>
  )
}

function PauseOverlay() {
  return (
    <div data-hud-ui style={{ ...sheet, pointerEvents: 'auto' }}>
      <div style={panel}>
        <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '.08em', color: '#fff' }}>PAUSED</div>
        <div style={{ fontSize: 11, color: 'rgb(var(--g-400))', marginTop: 4 }}>Esc to resume · the robots are frozen</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => combatManager.togglePause(false)} style={btn('rgb(var(--a-600))')}>▶ Resume</button>
          <button onClick={() => combatManager.restart()} style={btn('rgb(var(--g-700))')}>↻ Restart</button>
          <button onClick={() => combatManager.stop()} style={btn('#dc2626')}>Exit Arena</button>
        </div>
      </div>
    </div>
  )
}

function ResultOverlay({ result }) {
  const title = result.outcome === 'victory' ? 'VICTORY' : result.outcome === 'defeat' ? 'DEFEAT' : 'DRAW'
  const color = result.outcome === 'victory' ? '#22c55e' : result.outcome === 'defeat' ? '#ef4444' : '#f59e0b'
  const you = result.stats[result.playerId], foe = result.stats[result.enemyId]
  const Row = ({ label, a, b }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr', fontSize: 12, padding: '3px 0', borderTop: '1px solid rgb(var(--g-800))' }}>
      <span style={{ textAlign: 'right', color: '#fff', fontWeight: 700 }}>{a}</span>
      <span style={{ textAlign: 'center', color: 'rgb(var(--g-400))', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
      <span style={{ textAlign: 'left', color: '#fff', fontWeight: 700 }}>{b}</span>
    </div>
  )
  return (
    <div data-hud-ui style={{ ...sheet, pointerEvents: 'auto', background: 'rgba(0,0,0,.35)' }}>
      <div style={{ ...panel, minWidth: 360, borderColor: color }}>
        <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: '.1em', color }}>{title}</div>
        <div style={{ fontSize: 12, color: 'rgb(var(--g-300))', marginTop: 2 }}>
          {result.winnerName ? `${result.winnerName} wins` : 'Both robots were destroyed'} · {fmtTime(result.elapsed)}
        </div>
        <div style={{ marginTop: 14, width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr', fontSize: 11, fontWeight: 800, marginBottom: 2 }}>
            <span style={{ textAlign: 'right', color: TEAM.player }}>{you?.name || 'You'}</span><span /><span style={{ textAlign: 'left', color: TEAM.enemy }}>{foe?.name || 'Enemy'}</span>
          </div>
          <Row label="hits landed" a={you?.hits ?? 0} b={foe?.hits ?? 0} />
          <Row label="damage dealt" a={you?.dealt ?? 0} b={foe?.dealt ?? 0} />
          <Row label="parts lost" a={you?.partsLost ?? 0} b={foe?.partsLost ?? 0} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={() => combatManager.restart()} style={btn('rgb(var(--a-600))')}>↻ Rematch</button>
          <button onClick={() => combatManager.stop()} style={btn('rgb(var(--g-700))')}>Back to Editor</button>
        </div>
      </div>
    </div>
  )
}

export default function CombatHUD() {
  const arenaActive = useCombatStore((s) => s.arenaActive)
  const actors = useCombatStore((s) => s.actors)
  const status = useCombatStore((s) => s.status)
  const playerId = useCombatStore((s) => s.playerId)
  const enemyId = useCombatStore((s) => s.enemyId)
  const cameraMode = useCombatStore((s) => s.cameraMode)
  const paused = useCombatStore((s) => s.paused)
  const elapsed = useCombatStore((s) => s.elapsed)
  const difficulty = useCombatStore((s) => s.difficulty)
  const result = useCombatStore((s) => s.result)
  const keys = useGameStore((s) => s.controls.p1)
  if (!arenaActive) return null

  const list = Object.values(actors)
  const player = (playerId && actors[playerId]) || list[0]
  const enemy = (enemyId && actors[enemyId]) || list[1]
  const fighting = status === 'fighting'

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: Z_HUD, pointerEvents: 'none', userSelect: 'none' }}>
      {/* Player (top-left) + Enemy (top-right) */}
      <div style={{ position: 'absolute', top: 14, left: 14 }}>{player && <CombatantCard a={player} side="left" />}</div>
      <div style={{ position: 'absolute', top: 14, right: 14 }}>{enemy && <CombatantCard a={enemy} side="right" />}</div>

      {/* Match clock + difficulty + camera mode (top-centre) */}
      <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#fff', textShadow: '0 1px 3px #000', background: 'rgb(var(--g-900) / 0.75)', padding: '2px 14px', borderRadius: 10, border: '1px solid rgb(var(--g-700))' }}>
          {fmtTime(elapsed)}
        </div>
        <div style={{ fontSize: 9, color: 'rgb(var(--g-400))', marginTop: 4, background: 'rgb(var(--g-900) / 0.6)', padding: '2px 8px', borderRadius: 6, display: 'inline-block' }}>
          AI {difficulty} · 📷 {CAM_LABELS[cameraMode] || 'Combat'} · F1–F4
        </div>
      </div>

      {/* Crosshair on the real aim point (only while fighting and not paused) */}
      <Crosshair active={fighting && !paused} />

      {/* Player overheat vignette */}
      {player?.overheated && (
        <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 180px 40px rgba(239,68,68,.35)' }} />
      )}

      {status === 'loading' && <div style={bannerStyle}>Deploying…</div>}

      <Notices />

      {/* Bottom: weapons · controls · pause/exit (the pause / result sheets carry their own actions) */}
      {!(paused && fighting) && status !== 'over' && <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 18px', gap: 12 }}>
        <div data-hud-ui style={{ pointerEvents: 'auto' }}><WeaponSlots player={player} /></div>
        <div style={{ fontSize: 11, color: 'rgb(var(--g-400))', textAlign: 'center', alignSelf: 'center', background: 'rgb(var(--g-900) / 0.6)', padding: '4px 10px', borderRadius: 8 }}>
          <b style={kb}>{keyName(keys.up)}{keyName(keys.left)}{keyName(keys.down)}{keyName(keys.right)}</b> drive · <b style={kb}>LMB</b> fire · <b style={kb}>RMB</b> melee · <b style={kb}>Esc</b> pause
        </div>
        <div data-hud-ui style={{ pointerEvents: 'auto', display: 'flex', gap: 8 }}>
          {fighting && <button onClick={() => combatManager.togglePause()} style={btn('rgb(var(--g-700))', true)}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>}
          <button onClick={() => combatManager.stop()} style={btn('#dc2626', true)}>Exit Arena</button>
        </div>
      </div>}

      {paused && fighting && <PauseOverlay />}
      {status === 'over' && result && <ResultOverlay result={result} />}
    </div>
  )
}

const kb = { color: 'rgb(var(--g-200))' }
const badge = (color) => ({ fontSize: 8, fontWeight: 800, letterSpacing: '.06em', padding: '1px 5px', borderRadius: 4, background: color, color: '#fff' })
const btn = (bg, small) => ({ padding: small ? '8px 14px' : '10px 18px', borderRadius: 9, fontWeight: 700, fontSize: 12, color: '#fff', background: bg, border: 'none', cursor: 'pointer' })
// Sheets start below the top cards (≈ 250 px) so they never overlap them, and
// scroll on short viewports.
const sheet = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'min(250px, 28vh) 16px 16px', overflow: 'auto' }
const panel = { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '22px 30px', borderRadius: 16, background: 'rgb(var(--g-900) / 0.96)', border: '1.5px solid rgb(var(--a-500))', boxShadow: '0 12px 40px rgba(0,0,0,.5)' }
const bannerStyle = {
  position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)',
  padding: '12px 28px', borderRadius: 12, fontSize: 22, fontWeight: 800, color: '#fff',
  background: 'rgb(var(--g-900) / 0.9)', border: '1.5px solid rgb(var(--a-500))', pointerEvents: 'none',
}
