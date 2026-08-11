import { useState, useEffect } from 'react'
import ConstructaLogo from './ConstructaLogo.jsx'
import { recordPopupAction, trackEvent } from '../utils/utmTracking.js'
import { useOnboardingStore } from '../onboarding/onboardingStore.js'

// ─────────────────────────────────────────────────────────────────────────────
// WhatsAppGate — the "join our beta community" card.
//
// Appears ONCE — the first time the user runs their code (▶ Run) — not on load.
// Displays the WhatsApp Community invite link.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'whatsapp_joined_v1'        // set once they join
const SHOWN_KEY = 'whatsapp_prompt_shown_v1'  // set the first time we show it
const WHATSAPP_INVITE = 'https://chat.whatsapp.com/Kxikh3QnPIaHW92hssMTRK?s=cl&p=a&ilr=1&amv=0'

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

  const joinWhatsApp = () => {
    recordPopupAction('join_whatsapp')
    trackEvent('whatsapp_join')
    window.open(WHATSAPP_INVITE, '_blank', 'noopener,noreferrer')
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
        background: 'rgb(var(--g-900) / 0.98)', border: '1px solid #25D366',
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
            onClick={joinWhatsApp}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 800, color: '#fff', background: '#25D366', border: 'none', cursor: 'pointer', boxShadow: '0 0 14px rgba(37,211,102,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
            </svg>
            Join WhatsApp Community
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
