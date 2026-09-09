import { useEffect, useState } from 'react'
import { isCloudMode, backToDashboard, retrySave } from '../managers/CloudProjectManager.js'

// A slim top-center bar shown only when the editor was opened from the dashboard
// (?project=…) or a share link (?share=…). Shows Back-to-Dashboard + live save
// status, or a read-only badge for shared robots.
export default function CloudSaveBar() {
  const [cloud] = useState(() => isCloudMode())
  const [st, setSt] = useState({ status: 'loading', title: '', readOnly: false })

  useEffect(() => {
    if (!cloud) return
    const on = (e) => setSt((prev) => ({ ...prev, ...e.detail }))
    window.addEventListener('constructa:cloud-status', on)
    return () => window.removeEventListener('constructa:cloud-status', on)
  }, [cloud])

  if (!cloud) return null

  const { status, title, readOnly } = st

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-2 py-1.5 rounded-full shadow-lg text-xs"
      style={{ background: 'rgb(var(--g-900) / 0.92)', border: '1px solid rgb(var(--g-700))', backdropFilter: 'blur(8px)' }}
    >
      {!readOnly && (
        <button
          onClick={backToDashboard}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold text-white transition-all hover:brightness-110"
          style={{ background: 'rgb(var(--a-500))' }}
          title="Save and return to your dashboard"
        >
          <span aria-hidden>←</span> Dashboard
        </button>
      )}

      {readOnly && (
        <span className="flex items-center gap-1 px-2 py-1 rounded-full font-semibold"
          style={{ background: 'rgb(var(--g-800))', color: 'rgb(var(--g-200))' }}>
          👁 Read-only
        </span>
      )}

      {title && (
        <span className="max-w-[180px] truncate font-medium" style={{ color: 'rgb(var(--g-200))' }}>
          {title}
        </span>
      )}

      {!readOnly && <StatusPill status={status} />}
    </div>
  )
}

function StatusPill({ status }) {
  const map = {
    loading: { label: 'Opening…', color: 'var(--g-400)', dot: 'var(--g-400)', spin: true },
    dirty: { label: 'Saving…', color: 'var(--g-300)', dot: 'var(--a-500)', spin: true },
    saving: { label: 'Saving…', color: 'var(--g-300)', dot: 'var(--a-500)', spin: true },
    saved: { label: 'Saved', color: 'var(--g-300)', dot: '34 197 94', check: true },
    error: { label: 'Unable to save', color: '248 113 113', dot: '248 113 113' },
    auth: { label: 'Session expired', color: '248 113 113', dot: '248 113 113' },
  }
  const s = map[status] || map.loading

  return (
    <span className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ color: `rgb(${cssVar(s.color)})` }}>
      {s.check ? (
        <span style={{ color: 'rgb(34 197 94)' }}>✓</span>
      ) : (
        <span
          className={s.spin ? 'inline-block w-2 h-2 rounded-full animate-pulse' : 'inline-block w-2 h-2 rounded-full'}
          style={{ background: `rgb(${cssVar(s.dot)})` }}
        />
      )}
      <span className="font-medium">{s.label}</span>
      {(status === 'error') && (
        <button onClick={retrySave} className="ml-1 underline font-semibold hover:no-underline">
          Retry
        </button>
      )}
      {status === 'auth' && (
        <button onClick={backToDashboard} className="ml-1 underline font-semibold hover:no-underline">
          Reopen
        </button>
      )}
    </span>
  )
}

// Accepts either a CSS var name ("var(--g-400)") or a raw "r g b" triple.
function cssVar(v) {
  if (typeof v === 'string' && v.startsWith('var(')) return `var(${v.slice(4, -1)})`
  return v
}
