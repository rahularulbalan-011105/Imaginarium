import { useEffect } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'

const GROUPS = [
  {
    title: 'Create shapes',
    rows: [
      ['1', 'Cylinder'], ['2', 'Cone'], ['3', 'Cube'], ['4', 'Sphere'], ['5', 'Tetrahedron'],
      ['6', 'Square pyramid'], ['7', 'Pentagonal pyramid'], ['8', 'Octahedron'],
      ['9', 'Dodecahedron'], ['0', 'Rectangular prism'],
    ],
  },
  {
    title: 'Transform',
    rows: [
      ['W', 'Move (translate)'], ['E', 'Rotate'], ['R', 'Scale'],
      ['Shift + S', 'Snap rotation to nearest axis'],
    ],
  },
  {
    title: 'Edit',
    rows: [
      ['Ctrl + Z', 'Undo'], ['Ctrl + Y', 'Redo'],
      ['Ctrl + C', 'Copy selected'], ['Ctrl + V', 'Paste'],
      ['Ctrl + D', 'Duplicate selected'], ['Delete', 'Delete selected'],
    ],
  },
  {
    title: 'View & selection',
    rows: [
      ['G', 'Toggle grid'], ['A', 'Toggle axes'], ['F', 'Frame / fit selection'],
      ['Shift + Click', 'Select a 2nd object (Boolean / joints)'], ['Esc', 'Deselect / cancel'],
    ],
  },
  {
    title: 'Camera (mouse)',
    rows: [
      ['Scroll', 'Zoom'], ['Middle-drag', 'Orbit'], ['Right-drag', 'Pan'],
    ],
  },
]

export default function KeyboardShortcutsModal() {
  const open  = useOnboardingStore((s) => s.shortcutsOpen)
  const close = useOnboardingStore((s) => s.closeShortcuts)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500) / 0.3)' }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid rgb(var(--a-500) / 0.15)' }}>
          <h2 className="text-sm font-semibold text-slate-900">⌨ Keyboard Shortcuts</h2>
          <button onClick={close} className="text-gray-500 hover:text-slate-900 text-lg leading-none">✕</button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto grid sm:grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="text-[10px] uppercase tracking-wider text-indigo-500/80 font-semibold mb-2">{g.title}</div>
              <div className="space-y-1">
                {g.rows.map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-gray-400">{desc}</span>
                    <kbd className="shrink-0 text-[10px] font-mono text-indigo-700 px-1.5 py-0.5 rounded"
                      style={{ background: 'rgb(var(--a-500) / 0.12)', border: '1px solid rgb(var(--a-500) / 0.25)' }}>
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
