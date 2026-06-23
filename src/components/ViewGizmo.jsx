import { useEffect, useRef, useState } from 'react'
import { sceneManager } from '../managers/SceneManager.js'

// Standard views laid out as a compact cross + corner home button.
const VIEWS = [
  { key: 'top',    label: 'Top',    short: 'TOP' },
  { key: 'front',  label: 'Front',  short: 'FRT' },
  { key: 'right',  label: 'Right',  short: 'RGT' },
  { key: 'back',   label: 'Back',   short: 'BCK' },
  { key: 'left',   label: 'Left',   short: 'LFT' },
  { key: 'bottom', label: 'Bottom', short: 'BOT' },
]

export default function ViewGizmo() {
  const [label, setLabel] = useState('Perspective')
  const [open, setOpen] = useState(false)
  const rafRef = useRef(null)

  // Poll the camera orientation each frame so the badge reflects orbiting.
  useEffect(() => {
    let mounted = true
    const tick = () => {
      if (!mounted) return
      const l = sceneManager.getViewLabel?.()
      if (l) setLabel(prev => (prev === l ? prev : l))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { mounted = false; if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const go = (key) => { sceneManager.setView(key); setOpen(false) }

  return (
    <div className="absolute top-3 right-3 z-20 select-none flex flex-col items-end gap-1.5">
      {/* Current-view badge — click to toggle the quick-view menu */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Current view — click to switch"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-900/85 border border-gray-600/60 shadow-lg backdrop-blur-sm hover:border-indigo-500/70 transition-colors pointer-events-auto"
      >
        <span className="text-indigo-400 text-xs">◳</span>
        <span className="text-[11px] font-semibold text-white tracking-wide">{label}</span>
        <span className="text-gray-500 text-[9px]">{open ? '▲' : '▼'}</span>
      </button>

      {/* Quick-view grid */}
      {open && (
        <div className="p-2 rounded-lg bg-gray-900/90 border border-gray-600/60 shadow-2xl backdrop-blur-sm pointer-events-auto">
          <div className="grid grid-cols-3 gap-1 mb-1">
            {VIEWS.map(v => (
              <button
                key={v.key}
                onClick={() => go(v.key)}
                className={`px-2 py-1.5 rounded text-[10px] font-semibold border transition-colors ${
                  label === v.label
                    ? 'bg-indigo-600 border-indigo-400 text-white'
                    : 'bg-gray-800 border-gray-600/50 text-gray-300 hover:bg-gray-700 hover:text-slate-900'
                }`}
                title={`${v.label} view`}
              >
                {v.short}
              </button>
            ))}
          </div>
          <button
            onClick={() => go('home')}
            className={`w-full px-2 py-1.5 rounded text-[10px] font-semibold border transition-colors ${
              label === 'Perspective'
                ? 'bg-indigo-600 border-indigo-400 text-white'
                : 'bg-gray-800 border-gray-600/50 text-gray-300 hover:bg-gray-700 hover:text-slate-900'
            }`}
            title="Home / isometric view"
          >
            ⌂ Home (Iso)
          </button>
        </div>
      )}
    </div>
  )
}
