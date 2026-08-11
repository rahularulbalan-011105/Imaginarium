import { useEffect, useRef, useState } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'
import { useOverlay } from '../ui/overlay.js'

// The "?" Help button + dropdown menu in the header.
export default function HelpMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // While the dropdown is open, register it as an overlay so the View Cube (and
  // any other passive viewport widget) steps aside.
  useOverlay('help-menu', open)

  const startTour      = useOnboardingStore((s) => s.startTour)
  const openShortcuts  = useOnboardingStore((s) => s.openShortcuts)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // The guided mission opens this menu at its final step to point at Product Tour.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('constructa:open-learn', onOpen)
    return () => window.removeEventListener('constructa:open-learn', onOpen)
  }, [])

  const Item = ({ icon, label, sub, onClick, dataTour }) => (
    <button
      data-tour={dataTour}
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
        title="Tutorials, guides & shortcuts"
        className="h-7 px-2.5 flex items-center gap-1 text-xs font-semibold text-indigo-300/90 hover:text-slate-900 rounded-full transition-colors"
        style={{ background: 'rgb(var(--a-500) / 0.1)', border: '1px solid rgb(var(--a-500) / 0.25)' }}
      >
        <span className="text-sm leading-none">🎓</span>
        Learn
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-60 rounded-lg shadow-2xl z-30 py-1 overflow-hidden"
          style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500) / 0.25)' }}
        >
          <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-gray-500">Learn</div>
          <Item icon="🧭" label="Show Product Tour" sub="Quick highlight of every panel" dataTour="menu-tour" onClick={startTour} />
          <Item icon="⌨" label="Keyboard Shortcuts" sub="Every shortcut, at a glance"             onClick={openShortcuts} />

          <div className="my-1 border-t border-indigo-500/10" />

          <div className="px-3 py-1.5 text-[9px] uppercase tracking-wider text-gray-500">Community</div>
          <Item icon="💬" label="Join WhatsApp Community" sub="Connect with makers & team" onClick={() => window.open('https://chat.whatsapp.com/Kxikh3QnPIaHW92hssMTRK?s=cl&p=a&ilr=1&amv=0', '_blank', 'noopener,noreferrer')} />
        </div>
      )}
    </div>
  )
}
