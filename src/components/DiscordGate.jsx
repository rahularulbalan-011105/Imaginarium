import { useState, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// DiscordGate — a compact "join our Discord" toast.
//
// Appears ~2.5s AFTER load (not instantly, not blocking) in the upper-left, to
// the RIGHT of the floating Tools toolbox (which is pinned top-3 left-3, 176px
// wide) so it never overlaps it. Shown on every visit until the user joins;
// clicking Join (or "already joined") sets a localStorage flag and it never
// returns. Detecting the click is the best we can do without Discord OAuth.
// ─────────────────────────────────────────────────────────────────────────────

const KEY    = 'discord_joined_v1'
const INVITE = 'https://discord.gg/zCKjH3WP6'
const SHOW_DELAY_MS = 2500

export default function DiscordGate() {
  const [joined, setJoined] = useState(() => {
    try { return !!localStorage.getItem(KEY) } catch { return false }
  })
  const [visible, setVisible] = useState(false)

  // Delay the appearance so it doesn't pop the instant the app loads.
  useEffect(() => {
    if (joined) return
    const t = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [joined])

  if (joined || !visible) return null

  const markJoined = () => {
    try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
    setJoined(true)
  }
  const join = () => { window.open(INVITE, '_blank', 'noopener,noreferrer'); markJoined() }

  return (
    // Fixed, upper-left, past the 176px toolbox (left-3 = 12px → toolbox ends ~192px)
    // and below the ~56px header. Non-blocking: only the card catches clicks.
    <div style={{ position: 'fixed', top: 66, left: 200, zIndex: 60, width: 270, pointerEvents: 'none' }}>
      <div style={{
        pointerEvents: 'auto', borderRadius: 12, overflow: 'hidden',
        background: 'rgb(var(--g-900) / 0.97)', border: '1px solid #5865F2',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', background: 'rgba(88,101,242,0.14)' }}>
          <svg viewBox="0 0 71 55" width="22" height="17" aria-hidden="true">
            <path fill="#5865F2" d="M60.1 4.9A58.5 58.5 0 0 0 45.6.4a.2.2 0 0 0-.2.1c-.6 1.1-1.3 2.6-1.8 3.7a54 54 0 0 0-16.2 0c-.5-1.2-1.2-2.6-1.9-3.7a.2.2 0 0 0-.2-.1c-5 .9-9.9 2.4-14.5 4.5a.2.2 0 0 0-.1.1C1.6 18.7-.9 32.1.3 45.4c0 .1 0 .1.1.2a58.9 58.9 0 0 0 17.8 9 .2.2 0 0 0 .2-.1c1.4-1.9 2.6-3.9 3.6-6a.2.2 0 0 0-.1-.3c-1.9-.7-3.7-1.6-5.5-2.6a.2.2 0 0 1 0-.4l1.1-.8a.2.2 0 0 1 .2 0 42 42 0 0 0 35.6 0 .2.2 0 0 1 .2 0l1.1.8a.2.2 0 0 1 0 .4c-1.7 1-3.6 1.9-5.5 2.6a.2.2 0 0 0-.1.3c1 2.1 2.3 4.1 3.6 6a.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.8-9 .2.2 0 0 0 .1-.2c1.4-15.4-2.4-28.7-10.1-40.4a.2.2 0 0 0-.1-.1ZM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.1 0-4 2.8-7.2 6.4-7.2 3.6 0 6.5 3.3 6.4 7.2 0 3.9-2.8 7.1-6.4 7.1Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.1 0-4 2.8-7.2 6.4-7.2 3.6 0 6.5 3.3 6.4 7.2 0 3.9-2.8 7.1-6.4 7.1Z"/>
          </svg>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--g-100))' }}>Join our Discord</span>
        </div>
        <div style={{ padding: '9px 11px 11px' }}>
          <p style={{ margin: '0 0 9px', fontSize: 11, lineHeight: 1.4, color: 'rgb(var(--g-400))' }}>
            Get help, share your builds, and hear about new features first.
          </p>
          <button
            onClick={join}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#fff', background: '#5865F2', border: 'none', cursor: 'pointer' }}
          >
            Join our Discord →
          </button>
          <button
            onClick={markJoined}
            style={{ display: 'block', margin: '7px auto 0', fontSize: 10, color: 'rgb(var(--g-500))', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            I've already joined
          </button>
        </div>
      </div>
    </div>
  )
}
