import { useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// DiscordGate — a blocking "join our Discord" popup shown on every visit UNTIL
// the user joins. It sits above the Welcome/Explore overlay (z 300 > 100), so it
// is always handled first. Once the user clicks "Join" (or confirms they already
// joined) a localStorage flag is set and it never shows again.
//
// Note: we can only detect the CLICK, not actual Discord registration — there's
// no backend link to Discord. Clicking Join opens the invite and marks it done.
// ─────────────────────────────────────────────────────────────────────────────

const KEY    = 'discord_joined_v1'
const INVITE = 'https://discord.gg/zCKjH3WP6'

export default function DiscordGate() {
  const [joined, setJoined] = useState(() => {
    try { return !!localStorage.getItem(KEY) } catch { return false }
  })
  if (joined) return null

  const markJoined = () => {
    try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
    setJoined(true)
  }
  const join = () => {
    window.open(INVITE, '_blank', 'noopener,noreferrer')
    markJoined()
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 300 }}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(5px)' }} />

      <div className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden text-center"
        style={{ background: 'rgb(var(--g-900))', border: '1px solid #5865F2' }}>

        <div className="px-8 pt-8 pb-5"
          style={{ background: 'linear-gradient(180deg, rgba(88,101,242,0.20), transparent)' }}>
          {/* Discord mark */}
          <svg viewBox="0 0 71 55" width="56" height="44" className="mx-auto mb-3" aria-hidden="true">
            <path fill="#5865F2" d="M60.1 4.9A58.5 58.5 0 0 0 45.6.4a.2.2 0 0 0-.2.1c-.6 1.1-1.3 2.6-1.8 3.7a54 54 0 0 0-16.2 0c-.5-1.2-1.2-2.6-1.9-3.7a.2.2 0 0 0-.2-.1c-5 .9-9.9 2.4-14.5 4.5a.2.2 0 0 0-.1.1C1.6 18.7-.9 32.1.3 45.4c0 .1 0 .1.1.2a58.9 58.9 0 0 0 17.8 9 .2.2 0 0 0 .2-.1c1.4-1.9 2.6-3.9 3.6-6a.2.2 0 0 0-.1-.3c-1.9-.7-3.7-1.6-5.5-2.6a.2.2 0 0 1 0-.4l1.1-.8a.2.2 0 0 1 .2 0 42 42 0 0 0 35.6 0 .2.2 0 0 1 .2 0l1.1.8a.2.2 0 0 1 0 .4c-1.7 1-3.6 1.9-5.5 2.6a.2.2 0 0 0-.1.3c1 2.1 2.3 4.1 3.6 6a.2.2 0 0 0 .2.1 58.7 58.7 0 0 0 17.8-9 .2.2 0 0 0 .1-.2c1.4-15.4-2.4-28.7-10.1-40.4a.2.2 0 0 0-.1-.1ZM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.1 0-4 2.8-7.2 6.4-7.2 3.6 0 6.5 3.3 6.4 7.2 0 3.9-2.8 7.1-6.4 7.1Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.1 0-4 2.8-7.2 6.4-7.2 3.6 0 6.5 3.3 6.4 7.2 0 3.9-2.8 7.1-6.4 7.1Z"/>
          </svg>
          <h1 className="text-lg font-bold" style={{ color: 'rgb(var(--g-100))' }}>
            Join our Discord community
          </h1>
          <p className="text-xs mt-2 max-w-xs mx-auto leading-relaxed" style={{ color: 'rgb(var(--g-400))' }}>
            Get help, share your robot builds, and hear about new features first.
            Join our Discord to continue into the editor.
          </p>
        </div>

        <div className="px-8 pb-7 flex flex-col items-center gap-3">
          <button
            onClick={join}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
            style={{ background: '#5865F2', boxShadow: '0 0 14px rgba(88,101,242,0.45)' }}
          >
            Join our Discord →
          </button>
          <button
            onClick={markJoined}
            className="text-[11px] transition-colors hover:underline"
            style={{ color: 'rgb(var(--g-500))' }}
          >
            I've already joined
          </button>
        </div>
      </div>
    </div>
  )
}
