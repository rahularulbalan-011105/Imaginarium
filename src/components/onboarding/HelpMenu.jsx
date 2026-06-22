import { useEffect, useRef, useState } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'

// The "?" Help button + dropdown menu in the header.
export default function HelpMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const startCoach      = useOnboardingStore((s) => s.startCoach)
  const restartCoach    = useOnboardingStore((s) => s.restartCoach)
  const startTour       = useOnboardingStore((s) => s.startTour)
  const openShortcuts   = useOnboardingStore((s) => s.openShortcuts)
  const openGuide       = useOnboardingStore((s) => s.openGuide)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const Item = ({ icon, label, sub, onClick }) => (
    <button
      onClick={() => { onClick(); setOpen(false) }}
      className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-indigo-500/10 transition-colors"
    >
      <span className="text-sm mt-0.5 w-4 text-center shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-gray-200">{label}</span>
        {sub && <span className="block text-[10px] text-gray-500 leading-tight">{sub}</span>}
      </span>
    </button>
  )

  return (
    <div className="relative" ref={ref} data-tour="help">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Help, tutorials & shortcuts"
        className="w-7 h-7 flex items-center justify-center text-sm text-indigo-300/80 hover:text-slate-900 rounded-full transition-colors"
        style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}
      >
        ?
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-60 rounded-lg shadow-2xl z-30 py-1 overflow-hidden"
          style={{ background: '#FFFFFF', border: '1px solid rgba(99,102,241,0.25)' }}
        >
          <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-gray-500">Learn</div>
          <Item icon="🎓" label="Start Tutorial"    sub="Guided, hands-on — it teaches as you go" onClick={startCoach} />
          <Item icon="↻"  label="Restart Tutorial"  sub="Begin the guided lesson from the top"    onClick={restartCoach} />
          <Item icon="🧭" label="Show Product Tour" sub="Quick highlight of every panel"          onClick={startTour} />

          <div className="my-1 border-t border-indigo-500/10" />

          <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-gray-500">Reference</div>
          <Item icon="⌨" label="Keyboard Shortcuts" onClick={openShortcuts} />
          <Item icon="📖" label="Beginner Guide"     onClick={openGuide} />
        </div>
      )}
    </div>
  )
}
