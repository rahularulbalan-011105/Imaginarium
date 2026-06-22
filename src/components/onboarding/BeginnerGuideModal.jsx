import { useEffect } from 'react'
import { useOnboardingStore } from '../../onboarding/onboardingStore.js'

const SECTIONS = [
  {
    icon: '🧊', title: '1 · Create an object',
    body: [
      'Click any shape in the left Toolbar — a Cube is a good start (or press 3).',
      'It appears in the 3D Viewport. Click it to select it; the colored arrows are the Move gizmo.',
      'Press W to Move, E to Rotate, R to Scale. Fine-tune exact values in the Properties panel on the right.',
    ],
  },
  {
    icon: '🔌', title: '2 · Add electronics',
    body: [
      'In the Toolbar’s “Elec” group, add a controller (Arduino or SUBO) plus a part to control — a Motor, Servo, or LED.',
      'Position them in the scene like any other object.',
      'Tip: drag an object near a motor’s shaft and the app offers to attach it so it spins with the motor.',
    ],
  },
  {
    icon: '⚡', title: '3 · Connect components',
    body: [
      'Open the Wiring tab. Click a pin on the Arduino, then a pin on your component, to draw a wire.',
      'Power parts usually need GND and 5V; signal pins (like D3, D9) carry the control.',
      'Your wires also appear in 3D and in the Objects list.',
    ],
  },
  {
    icon: '🧠', title: '4 · Write the logic',
    body: [
      'Beginners: use the Blocks tab — drag blocks together, no typing. It writes the C++ for you.',
      'Or use the Code tab to write Arduino C++ directly. The Templates menu has ready examples (motor ramp, servo sweep, LED blink).',
      'Press Run to execute. Watch motor/servo bars and the Serial Monitor for output.',
    ],
  },
  {
    icon: '🤖', title: '5 · Run a simulation',
    body: [
      'Press Simulate (▶) in the Toolbar to enter simulation mode with real physics.',
      'Drive wheeled robots with the on-screen controls; gravity, friction, and wind all apply.',
      'Press Stop (⏹) to return to editing. Nothing you built is lost.',
    ],
  },
]

export default function BeginnerGuideModal() {
  const open  = useOnboardingStore((s) => s.guideOpen)
  const close = useOnboardingStore((s) => s.closeGuide)
  const startCoach = useOnboardingStore((s) => s.startCoach)

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
      <div className="relative w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: '#FFFFFF', border: '1px solid rgba(99,102,241,0.3)', maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
          <h2 className="text-sm font-semibold text-slate-900">📖 Beginner Guide</h2>
          <button onClick={close} className="text-gray-500 hover:text-slate-900 text-lg leading-none">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            This app lets you design 3D parts, wire up electronics, program them, and watch them move —
            no installs, no account. Here is the whole workflow from empty scene to running robot.
          </p>
          {SECTIONS.map((s) => (
            <div key={s.title} className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(99,102,241,0.10)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-base">{s.icon}</span>
                <h3 className="text-xs font-bold text-indigo-800">{s.title}</h3>
              </div>
              <ul className="space-y-1 pl-1">
                {s.body.map((line, i) => (
                  <li key={i} className="text-[11px] text-gray-400 leading-snug flex gap-1.5">
                    <span className="text-indigo-500/60">•</span><span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 shrink-0 flex items-center justify-between gap-3" style={{ borderTop: '1px solid rgba(99,102,241,0.15)' }}>
          <span className="text-[10px] text-gray-600">Prefer learning by doing?</span>
          <button onClick={() => { close(); startCoach() }}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(90deg,#6366f1,#4f46e5)' }}>
            🎓 Start guided tutorial
          </button>
        </div>
      </div>
    </div>
  )
}
