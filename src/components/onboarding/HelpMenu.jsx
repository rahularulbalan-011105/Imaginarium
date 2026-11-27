import { useEffect, useRef, useState } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'
import { useOverlay } from '../ui/overlay.js'
import Icon from '../ui/Icon.jsx'

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

  const Item = ({ label, sub, onClick, dataTour }) => (
    <button
      data-tour={dataTour}
      onClick={() => { onClick(); setOpen(false) }}
      className="w-full block px-3 py-2 text-left hover:bg-gray-800 transition-colors"
    >
      <span className="block text-[13px] text-gray-200">{label}</span>
      {sub && <span className="block text-[11px] text-gray-500 leading-tight mt-0.5">{sub}</span>}
    </button>
  )

  return (
    <div className="relative" ref={ref} data-tour="help">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Tutorials, guides & shortcuts"
        aria-expanded={open}
        className="ui-btn ui-btn-quiet"
      >
        <Icon name="help" size={15} />
        Learn
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-lg z-30 py-1 overflow-hidden"
          style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--g-700))', boxShadow: '0 8px 24px rgb(0 0 0 / 0.12)' }}
        >
          <Item label="Take the tour" sub="See what each part of the screen does" dataTour="menu-tour" onClick={startTour} />
          <Item label="Keyboard shortcuts" sub="Every shortcut on one page" onClick={openShortcuts} />
          <div className="my-1" style={{ borderTop: '1px solid rgb(var(--g-700))' }} />
          <Item label="Join our Discord" sub="Ask makers and the team" onClick={() => window.open('https://discord.gg/QzEJ4Vrgn', '_blank', 'noopener,noreferrer')} />
        </div>
      )}
    </div>
  )
}
