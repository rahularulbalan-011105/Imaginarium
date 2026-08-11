import { useState, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// CreditDialog — shown once the "repair the puppy" template session is over
// (GuidedCoach fires constructa:template-done when the debug mission ends).
// Credits the robot's creator and links to their LinkedIn.
// ─────────────────────────────────────────────────────────────────────────────

const LINKEDIN = 'https://www.linkedin.com/in/zabir-z-8311602a4?utm_source=share_via&utm_content=profile&utm_medium=member_android'

export default function CreditDialog() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onDone = () => setVisible(true)
    window.addEventListener('constructa:template-done', onDone)
    return () => window.removeEventListener('constructa:template-done', onDone)
  }, [])

  if (!visible) return null

  // Closing the credit lets the guided coach continue to the Product Tour pointer.
  const close = () => { setVisible(false); window.dispatchEvent(new Event('constructa:credit-closed')) }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={close} />

      <div className="relative w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden text-center"
        style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500) / 0.35)' }}>

        <div className="px-8 pt-8 pb-2"
          style={{ background: 'linear-gradient(180deg, rgb(var(--a-500) / 0.14), transparent)' }}>
          <div className="text-4xl mb-3">🤖</div>
          <h1 className="text-base font-bold text-gray-200">
            This robot was created by{' '}
            <span style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Mr Zabir
            </span>
          </h1>
          <p className="text-xs text-gray-400 mt-2">Connect with the creator 👇</p>
        </div>

        <div className="px-8 pt-4 pb-8">
          <a
            href={LINKEDIN}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
            style={{ background: '#0A66C2', boxShadow: '0 0 14px rgba(10,102,194,0.4)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.44-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
            </svg>
            Zabir Z. on LinkedIn
          </a>

          <button
            onClick={close}
            className="mt-3 w-full text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  )
}
