import { useState, useEffect } from 'react'
import ConstructaLogo from './ConstructaLogo.jsx'
import { recordPopupAction, trackEvent } from '../utils/utmTracking.js'
import { useOnboardingStore } from '../onboarding/onboardingStore.js'

// ─────────────────────────────────────────────────────────────────────────────
// DiscordGate — the "join our beta community" card.
//
// Appears ONCE — the first time the user runs their code (▶ Run) — not on load.
// Displays the Discord server invite.
//
// The community moved from WhatsApp to Discord, so the storage keys are *_v2:
// people who joined (or dismissed) the old WhatsApp group have not seen this
// one, and should be offered it once.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'discord_joined_v2'         // set once they join
const SHOWN_KEY = 'discord_prompt_shown_v2'   // set the first time we show it
const DISCORD_INVITE = 'https://discord.gg/QzEJ4Vrgn'
const DISCORD_BLURPLE = '#5865F2'

const PERKS = [
  'Guided walkthroughs',
  'Early access to new features',
  'Direct feedback to the team',
  'Share your builds with others',
]

export default function DiscordGate() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handleOpen = () => {
      setVisible(true)
    }
    window.addEventListener('constructa:open_community', handleOpen)
    return () => window.removeEventListener('constructa:open_community', handleOpen)
  }, [])

  // Show ONCE, on the first time the user runs code (▶ Run) — not on load.
  useEffect(() => {
    const onRun = () => {
      // Never interrupt a guided tutorial (e.g. the puppy-repair mission runs
      // code itself) — only offer the community card on a genuine, self-directed
      // Run outside any coach/tour.
      if (useOnboardingStore.getState().coachActive) return
      try {
        if (localStorage.getItem(KEY)) return         // already joined
        if (localStorage.getItem(SHOWN_KEY)) return    // already shown once
        localStorage.setItem(SHOWN_KEY, '1')
      } catch { /* private mode → still show */ }
      setVisible(true)
    }
    window.addEventListener('constructa:code-run', onRun)
    return () => window.removeEventListener('constructa:code-run', onRun)
  }, [])

  if (!visible) return null

  const joinDiscord = () => {
    // The event names stay `join_whatsapp` / `whatsapp_join`: they are the only
    // community-join names the collector's allowlist accepts, and renaming them
    // would silently drop the events until the Apps Script is redeployed. They
    // mean "joined the community" — which is now Discord.
    recordPopupAction('join_whatsapp')
    trackEvent('whatsapp_join')
    window.open(DISCORD_INVITE, '_blank', 'noopener,noreferrer')
    try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
    setVisible(false)
  }

  const later = () => {
    recordPopupAction('dismiss')
    setVisible(false)
  }

  return (
    <div style={{ position: 'fixed', top: 66, left: 200, zIndex: 60, width: 300, pointerEvents: 'none' }}>
      <div style={{
        pointerEvents: 'auto', borderRadius: 14, overflow: 'hidden',
        background: 'rgb(var(--g-900) / 0.98)', border: `1px solid ${DISCORD_BLURPLE}`,
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
            onClick={joinDiscord}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 800, color: '#fff', background: DISCORD_BLURPLE, border: 'none', cursor: 'pointer', boxShadow: '0 0 14px rgba(88,101,242,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
            </svg>
            Join our Discord
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
