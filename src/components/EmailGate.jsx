import { useEffect, useState } from 'react'
import ConstructaLogo from './ConstructaLogo.jsx'
import { getKnownEmail, onEmailChange, setGateEmail, isValidEmail } from '../utils/utmTracking.js'
import { isCloudMode } from '../managers/CloudProjectManager.js'
import { useOverlay } from './ui/overlay.js'

// ─────────────────────────────────────────────────────────────────────────────
// EmailGate — nobody uses Constructa without an email.
//
// Logged-in users (opened from the dashboard) already have one from their
// Supabase session, so they never see this. Anyone else (direct ?app=1 links,
// share links, community links) must enter an email before the workshop
// unlocks. The email is remembered on this browser and attached to every
// analytics event (utmTracking). Skipped on localhost (dev / benchmarks).
// ─────────────────────────────────────────────────────────────────────────────

const LOGIN_URL = 'https://constructa-page.atumx.in/login'
const CLOUD_GRACE_MS = 6000   // let a dashboard session hand its email over first
const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)

export default function EmailGate() {
  const [email, setEmail] = useState(getKnownEmail)
  const [armed, setArmed] = useState(() => !isCloudMode())
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => onEmailChange(setEmail), [])
  useEffect(() => {
    if (armed) return
    const t = setTimeout(() => setArmed(true), CLOUD_GRACE_MS)
    return () => clearTimeout(t)
  }, [armed])

  const open = !isLocal() && armed && !email
  useOverlay('email-gate', open)
  if (!open) return null

  const submit = (e) => {
    e.preventDefault()
    const v = value.trim()
    if (!isValidEmail(v)) { setErr('Enter a valid email address.'); return }
    setGateEmail(v)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 190, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgb(var(--g-950) / 0.82)', backdropFilter: 'blur(6px)', padding: 16 }}>
      <form onSubmit={submit} noValidate style={{ width: '100%', maxWidth: 380, borderRadius: 16, padding: '22px 22px 18px',
        background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500))', boxShadow: '0 20px 50px rgba(0,0,0,0.45)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><ConstructaLogo width={160} /></div>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'rgb(var(--g-100))', textAlign: 'center' }}>Enter your email to start building</div>
        <p style={{ margin: '6px 0 14px', fontSize: 12, lineHeight: 1.5, color: 'rgb(var(--g-400))', textAlign: 'center' }}>
          We use it to keep track of your progress and send you Constructa updates. No spam.
        </p>
        <input
          type="email" autoFocus value={value} placeholder="you@email.com" autoComplete="email"
          onChange={(e) => { setValue(e.target.value); setErr('') }}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 9, fontSize: 14,
            background: 'rgb(var(--g-800))', color: 'rgb(var(--g-100))',
            border: `1px solid ${err ? '#ef4444' : 'rgb(var(--g-600))'}`, outline: 'none' }}
        />
        {err && <div style={{ marginTop: 6, fontSize: 11, color: '#ef4444' }}>{err}</div>}
        <button type="submit" style={{ width: '100%', marginTop: 12, padding: '10px 12px', borderRadius: 9, fontSize: 14,
          fontWeight: 800, color: '#fff', background: 'rgb(var(--a-500))', border: 'none', cursor: 'pointer' }}>
          Start building →
        </button>
        <div style={{ marginTop: 12, fontSize: 11, color: 'rgb(var(--g-500))', textAlign: 'center' }}>
          Have an account? <a href={LOGIN_URL} style={{ color: 'rgb(var(--a-500))', fontWeight: 700 }}>Log in</a> to open your saved robots.
        </div>
      </form>
    </div>
  )
}
