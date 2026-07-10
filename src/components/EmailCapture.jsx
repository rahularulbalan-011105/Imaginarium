import { useState, useEffect } from 'react'
import { submitEmail } from '../utils/utmTracking.js'

// ─────────────────────────────────────────────────────────────────────────────
// EmailCapture — a soft, dismissible email prompt with a real value exchange.
//
// Appears the FIRST time the user saves a project (listens for the
// 'constructa:saved' event Header fires) — not a hard gate. On submit the email
// is logged to the analytics Sheet (email_submitted event). Shown once; a
// captured/dismissed choice is remembered in localStorage so it never nags.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'email_status_v1'   // 'captured' | 'dismissed'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EmailCapture() {
  const [done, setDone] = useState(() => {
    try { return !!localStorage.getItem(KEY) } catch { return false }
  })
  const [visible, setVisible] = useState(false)
  const [email, setEmail] = useState('')
  const [thanks, setThanks] = useState(false)
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (done) return
    const onSaved = () => setVisible(true)
    window.addEventListener('constructa:saved', onSaved)
    return () => window.removeEventListener('constructa:saved', onSaved)
  }, [done])

  if (done || !visible) return null

  const set = (v) => { try { localStorage.setItem(KEY, v) } catch { /* private mode */ } }

  const subscribe = () => {
    if (!EMAIL_RE.test(email.trim())) { setErr(true); return }
    submitEmail(email.trim(), 'save')
    set('captured'); setThanks(true)
    setTimeout(() => { setVisible(false); setDone(true) }, 1800)
  }
  const skip = () => { set('dismissed'); setVisible(false); setDone(true) }

  return (
    <div style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 70, width: 300 }}>
      <div style={{
        borderRadius: 14, overflow: 'hidden',
        background: 'rgb(var(--g-900) / 0.98)', border: '1px solid rgb(var(--a-500))',
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
      }}>
        {thanks ? (
          <div style={{ padding: 18, textAlign: 'center' }}>
            <div style={{ fontSize: 22 }}>🎉</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--g-100))', marginTop: 4 }}>You're on the list!</div>
          </div>
        ) : (
          <div style={{ padding: '14px 15px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'rgb(var(--g-100))' }}>💾 Project saved!</div>
            <p style={{ margin: '6px 0 10px', fontSize: 11, lineHeight: 1.45, color: 'rgb(var(--g-400))' }}>
              Get build tips + new features (weapons, arenas, more). Optional — no spam.
            </p>
            <input
              type="email" value={email} placeholder="you@email.com"
              onChange={(e) => { setEmail(e.target.value); setErr(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') subscribe() }}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12,
                background: 'rgb(var(--g-800))', color: 'rgb(var(--g-100))',
                border: `1px solid ${err ? '#ef4444' : 'rgb(var(--g-600))'}`, outline: 'none',
              }}
            />
            <button
              onClick={subscribe}
              style={{ width: '100%', marginTop: 9, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 800, color: '#fff', background: 'rgb(var(--a-500))', border: 'none', cursor: 'pointer' }}
            >
              Get updates
            </button>
            <button
              onClick={skip}
              style={{ display: 'block', width: '100%', marginTop: 7, fontSize: 11, color: 'rgb(var(--g-500))', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              No thanks
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
