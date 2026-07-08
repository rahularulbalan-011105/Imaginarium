import { useState, useEffect } from 'react'
import ConstructaLogo from './ConstructaLogo.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// DiscordGate — the "join our beta community" card.
//
// Mounts only after the loading screen (models ready → canvas open), then appears
// after a short beat so it lands just as the workshop opens. Compact, upper-left,
// non-blocking (clear of the Tools toolbox). "Join" opens the invite + sets a
// localStorage flag so it never returns; "Continue building" dismisses it for now
// (it reappears next visit until the user joins).
// ─────────────────────────────────────────────────────────────────────────────

const KEY    = 'discord_joined_v1'
const INVITE = 'https://discord.gg/zCKjH3WP6'
const SHOW_DELAY_MS = 800

const PERKS = [
  'Guided walkthroughs',
  'Early access to new features',
  'Direct feedback to the team',
  'Share your builds with others',
]

export default function DiscordGate() {
  const [joined, setJoined] = useState(() => {
    try { return !!localStorage.getItem(KEY) } catch { return false }
  })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (joined) return
    const t = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [joined])

  if (joined || !visible) return null

  const join = () => {
    window.open(INVITE, '_blank', 'noopener,noreferrer')
    try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
    setJoined(true)
  }
  const later = () => setVisible(false)   // dismiss for now; returns next visit

  return (
    <div style={{ position: 'fixed', top: 66, left: 200, zIndex: 60, width: 300, pointerEvents: 'none' }}>
      <div style={{
        pointerEvents: 'auto', borderRadius: 14, overflow: 'hidden',
        background: 'rgb(var(--g-900) / 0.98)', border: '1px solid #5865F2',
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
      }}>
        {/* Logo */}
        <div style={{ padding: '16px 16px 6px', display: 'flex', justifyContent: 'center' }}>
          <ConstructaLogo width={150} />
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'rgb(var(--g-100))', textAlign: 'center', marginBottom: 12 }}>
            Join our beta community
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgb(var(--g-400))', marginBottom: 6 }}>Get:</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
            {PERKS.map((p) => (
              <li key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgb(var(--g-200))' }}>
                <span style={{ color: '#22c55e', fontWeight: 800 }}>✓</span>{p}
              </li>
            ))}
          </ul>

          <button
            onClick={join}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13, fontWeight: 800, color: '#fff', background: '#5865F2', border: 'none', cursor: 'pointer', boxShadow: '0 0 12px rgba(88,101,242,0.4)' }}
          >
            Join Discord Community
          </button>
          <button
            onClick={later}
            style={{ display: 'block', width: '100%', marginTop: 9, fontSize: 12, color: 'rgb(var(--g-400))', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Continue building →
          </button>
        </div>
      </div>
    </div>
  )
}
