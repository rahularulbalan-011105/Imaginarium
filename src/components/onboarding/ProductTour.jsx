import { useEffect, useState } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'
import { useUiStore } from '../../stores/uiStore.js'
import { TOUR_STEPS } from '../../onboarding/tourSteps.js'

// Guided product tour. Highlights real DOM elements (found by their data-tour
// attribute) with a spotlight + an explanatory card. Switching the visible
// panel uses the same setActivePanel action a normal tab click uses — it does
// not alter any panel logic. Purely presentational.

const CARD_W = 320

export default function ProductTour() {
  const active = useOnboardingStore((s) => s.tourActive)
  const step   = useOnboardingStore((s) => s.tourStep)
  const next   = useOnboardingStore((s) => s.nextTourStep)
  const prev   = useOnboardingStore((s) => s.prevTourStep)
  const end    = useOnboardingStore((s) => s.endTour)
  const setActivePanel = useUiStore((s) => s.setActivePanel)

  const [rect, setRect] = useState(null)
  const total = TOUR_STEPS.length
  const current = TOUR_STEPS[step]

  // Make the target panel visible before measuring it.
  useEffect(() => {
    if (!active || !current) return
    if (current.panel) setActivePanel(current.panel)
  }, [active, step, current, setActivePanel])

  // Measure the highlighted element (re-measure on resize / scroll).
  useEffect(() => {
    if (!active || !current) return
    let raf1 = 0, raf2 = 0, timer = 0
    const measure = (doScroll) => {
      const el = document.querySelector(`[data-tour="${current.selector}"]`)
      if (el && doScroll) { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* noop */ } }
      setRect(el ? el.getBoundingClientRect() : null)
    }
    const track = () => measure(false)
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => measure(true)) })
    timer = setTimeout(() => measure(true), 140)   // allow the panel switch to settle, then scroll into view
    window.addEventListener('resize', track)
    window.addEventListener('scroll', track, true)
    return () => {
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(timer)
      window.removeEventListener('resize', track)
      window.removeEventListener('scroll', track, true)
    }
  }, [active, step, current])

  // Keyboard: Esc exits, arrows navigate.
  useEffect(() => {
    if (!active) return
    const onKey = (e) => {
      if (e.key === 'Escape')      { e.preventDefault(); end() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step + 1 >= total ? end() : next() }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, step, total, next, prev, end])

  if (!active || !current) return null

  const isLast = step >= total - 1

  // Position the card next to the target, clamped on-screen.
  let cardStyle
  if (rect) {
    const wide = rect.width > window.innerWidth * 0.6
    let top, left
    if (wide) {
      // Big targets (header, viewport) → place card below.
      top  = rect.bottom + 16
      left = rect.left
    } else {
      const spaceRight = window.innerWidth - rect.right
      const placeLeft  = spaceRight < CARD_W + 24 && rect.left > CARD_W + 24
      left = placeLeft ? rect.left - CARD_W - 16 : rect.right + 16
      top  = rect.top
    }
    top  = Math.min(Math.max(16, top), window.innerHeight - 300)
    left = Math.min(Math.max(16, left), window.innerWidth - CARD_W - 16)
    cardStyle = { top, left, width: CARD_W }
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: CARD_W }
  }

  return (
    <div className="fixed inset-0 z-[120]">
      {/* Spotlight + dimmer (box-shadow makes everything outside the hole dark) */}
      {rect ? (
        <div
          className="absolute rounded-lg pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.66)',
            border: '2px solid rgb(var(--a-500) / 0.9)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/66 pointer-events-none" />
      )}

      {/* Explanation card */}
      <div
        className="absolute rounded-xl shadow-2xl p-4"
        style={{ ...cardStyle, background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500) / 0.3)' }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-indigo-500/80 font-semibold">
            Product Tour · {step + 1}/{total}
          </span>
          <button onClick={end} className="text-gray-500 hover:text-slate-900 text-xs leading-none">✕ Skip</button>
        </div>

        <h3 className="text-sm font-bold text-slate-900 mb-2">{current.title}</h3>

        <div className="space-y-1.5 text-[11px] leading-snug">
          <p className="text-gray-300"><span className="text-indigo-400 font-semibold">What it is: </span>{current.what}</p>
          <p className="text-gray-300"><span className="text-indigo-400 font-semibold">What it does: </span>{current.does}</p>
          <p className="text-gray-300"><span className="text-indigo-400 font-semibold">When to use it: </span>{current.when}</p>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1 mt-3 mb-3 flex-wrap">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-indigo-500' : 'w-1.5 bg-gray-600'}`} />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            disabled={step === 0}
            className="px-3 py-1.5 rounded text-xs text-gray-300 bg-gray-700/60 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Back
          </button>
          <div className="flex-1" />
          <button
            onClick={() => (isLast ? end() : next())}
            className="px-4 py-1.5 rounded text-xs font-semibold text-white transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))' }}
          >
            {isLast ? 'Finish ✓' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
