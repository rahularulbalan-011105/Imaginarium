import { useEffect } from 'react'
import { useOnboardingStore } from '../onboarding/onboardingStore.js'

// First-run welcome card. Offers three ways in: a guided product tour, a
// hands-on mission tutorial, or just exploring. 100% presentational — driven by
// the onboarding store; it never touches scene, electronics, physics or saves.

const STEPS = [
  { icon: '🧊', title: 'Add a shape',      text: 'Click a shape in the left toolbar (or press 1–0). It drops into the scene.' },
  { icon: '✛',  title: 'Move it',          text: 'Select an object, then drag the arrows. W = Move · E = Rotate · R = Scale.' },
  { icon: '🟢', title: 'Add electronics',  text: 'From the “Elec” group add an Arduino, Motor, Servo, or LED.' },
  { icon: '⚡', title: 'Connect parts',     text: 'In the Wiring tab, click two pins to run a wire between components.' },
  { icon: '{ }', title: 'Program it',      text: 'Use the Code tab (Arduino C++) or Blocks tab (drag-and-drop).' },
  { icon: '▶',  title: 'Run a simulation', text: 'Press Simulate (▶) to drive your robot with real physics.' },
]

export default function WelcomeOverlay() {
  const open       = useOnboardingStore((s) => s.welcomeOpen)
  const close      = useOnboardingStore((s) => s.closeWelcome)
  const startTour  = useOnboardingStore((s) => s.startTour)
  const startCoach = useOnboardingStore((s) => s.startCoach)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />

      <div className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500) / 0.3)' }}>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center"
          style={{ background: 'linear-gradient(180deg, rgb(var(--a-500) / 0.12), transparent)' }}>
          <div className="text-3xl mb-2">🧊🤖</div>
          <h1 className="text-lg font-bold"
            style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Welcome to the Robotics Builder
          </h1>
          <p className="text-xs text-gray-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
            Design 3D objects, wire up electronics, program them, and watch them move —
            all in your browser. Here's the whole idea in six steps.
          </p>
        </div>

        {/* Steps */}
        <div className="px-6 py-2 grid sm:grid-cols-2 gap-2.5">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg p-2.5"
              style={{ background: 'rgb(var(--g-800) / 0.4)', border: '1px solid rgb(var(--a-500) / 0.10)' }}>
              <div className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-sm"
                style={{ background: 'rgb(var(--a-500) / 0.12)' }}>
                {s.icon}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-indigo-800">
                  <span className="text-indigo-500/70 mr-1">{i + 1}.</span>{s.title}
                </div>
                <div className="text-[11px] text-gray-400 leading-snug mt-0.5">{s.text}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Choices */}
        <div className="px-6 pt-3 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            onClick={startCoach}
            className="px-3 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 text-center"
            style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))', boxShadow: '0 0 10px rgb(var(--a-500) / 0.3)' }}
          >
            🎓 Teach me<br /><span className="text-[10px] font-normal opacity-90">guided, step by step</span>
          </button>
          <button
            onClick={startTour}
            className="px-3 py-2.5 rounded-lg text-sm font-semibold text-indigo-800 transition-colors hover:bg-indigo-500/10 text-center"
            style={{ background: 'rgb(var(--a-500) / 0.06)', border: '1px solid rgb(var(--a-500) / 0.25)' }}
          >
            🧭 Tour<br /><span className="text-[10px] font-normal opacity-80">show me around</span>
          </button>
          <button
            onClick={close}
            className="px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700/40 text-center"
            style={{ background: 'rgb(var(--g-800) / 0.4)', border: '1px solid rgb(var(--g-600) / 0.4)' }}
          >
            🚀 Explore<br /><span className="text-[10px] font-normal opacity-70">on my own</span>
          </button>
        </div>

        <div className="px-6 pb-4 text-center">
          <span className="text-[10px] text-gray-600">You can reopen all of this anytime from the “?” in the top bar.</span>
        </div>
      </div>
    </div>
  )
}
