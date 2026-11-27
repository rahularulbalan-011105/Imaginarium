import { useEffect, useState } from 'react'
import { useOnboardingStore } from '../onboarding/onboardingStore.js'
import { useOverlay } from './ui/overlay.js'
import { PRESETS, presetThumb, openPreset } from '../utils/presets.js'
import { trackEvent } from '../utils/utmTracking.js'
import Icon from './ui/Icon.jsx'

// ─────────────────────────────────────────────────────────────────────────────
// Start screen — what you see on a first visit and after File → New project
// (Tinkercad's "create new design" moment). Three ways in, in order of how much
// help they give: a guided first robot, a starter project to change, or an
// empty workplane. Opening a starter project uses the normal project-load path.
// ─────────────────────────────────────────────────────────────────────────────

export default function WelcomeOverlay() {
  const open       = useOnboardingStore((s) => s.welcomeOpen)
  const close      = useOnboardingStore((s) => s.closeWelcome)
  const startTour  = useOnboardingStore((s) => s.startTour)
  const startCoach = useOnboardingStore((s) => s.startCoach)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  useOverlay('start-screen', open)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const pick = async (p) => {
    setBusy(p.file); setErr(null)
    try { await openPreset(p); trackEvent('preset_opened', { preset: p.file, from: 'start' }); close() }
    catch (e) { setErr(`Couldn’t open “${p.label}”: ${e.message}`) }
    setBusy(null)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={close} />

      <div role="dialog" aria-modal="true" aria-label="Start a project"
        className="relative w-full max-w-[920px] max-h-[90vh] flex flex-col rounded-xl overflow-hidden"
        style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 24px 60px rgb(0 0 0 / 0.25)' }}>

        <div className="flex items-center h-14 pl-6 pr-3 shrink-0" style={{ borderBottom: '1px solid rgb(var(--g-700))' }}>
          <h1 className="text-[16px] font-semibold" style={{ color: 'rgb(var(--g-50))' }}>What do you want to build?</h1>
          <button onClick={close} aria-label="Close" title="Close (Esc)" className="ml-auto w-8 h-8 flex items-center justify-center ui-icon-btn">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[260px_1fr]">
          {/* Left: ways to start */}
          <div className="p-5 flex flex-col gap-3" style={{ borderRight: '1px solid rgb(var(--g-700))' }}>
            <button onClick={() => { close(); startCoach() }}
              className="text-left rounded-lg p-4 transition-colors hover:brightness-105"
              style={{ background: 'rgb(var(--a-600))', color: '#fff' }}>
              <div className="text-[14px] font-semibold">Build my first robot</div>
              <div className="text-[12px] mt-1 opacity-90 leading-snug">Step-by-step: make a robot car, wire it, code it and drive it.</div>
            </button>
            <button onClick={close}
              className="text-left rounded-lg p-4 transition-colors"
              style={{ border: '1px solid rgb(var(--g-600))' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(var(--g-800))')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <div className="text-[14px] font-semibold" style={{ color: 'rgb(var(--g-50))' }}>Empty project</div>
              <div className="text-[12px] mt-1 leading-snug" style={{ color: 'rgb(var(--g-500))' }}>Start from a blank workplane.</div>
            </button>
            <div className="mt-auto pt-3 text-[12px] leading-relaxed" style={{ color: 'rgb(var(--g-500))' }}>
              New here?{' '}
              <button onClick={() => { close(); startTour() }} className="underline hover:no-underline" style={{ color: 'rgb(var(--g-200))' }}>Take a 1-minute tour</button>
              {' '}of the screen.
            </div>
          </div>

          {/* Right: starter projects */}
          <div className="p-5">
            <div className="text-[13px] font-semibold mb-3" style={{ color: 'rgb(var(--g-100))' }}>Or start from a ready-made project</div>
            {err && <div className="mb-3 text-[12px]" style={{ color: '#dc2626' }}>{err}</div>}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {PRESETS.map((p) => (
                <button key={p.file} onClick={() => pick(p)} disabled={busy !== null}
                  className="group text-left rounded-lg overflow-hidden transition-colors disabled:opacity-60"
                  style={{ border: '1px solid rgb(var(--g-700))' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgb(var(--a-600))')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgb(var(--g-700))')}>
                  <div className="aspect-[16/10]" style={{ background: '#ffffff' }}>
                    <img src={presetThumb(p.file)} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} />
                  </div>
                  <div className="px-3 py-2.5" style={{ borderTop: '1px solid rgb(var(--g-700))' }}>
                    <div className="text-[13px] font-medium" style={{ color: 'rgb(var(--g-50))' }}>{busy === p.file ? 'Opening…' : p.label}</div>
                    <div className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'rgb(var(--g-500))' }}>{p.blurb}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
