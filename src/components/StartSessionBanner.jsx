import { useState } from 'react'
import ConstructaLogo from './ConstructaLogo.jsx'
import { useOnboardingStore } from '../onboarding/onboardingStore.js'
import { isCloudMode } from '../managers/CloudProjectManager.js'

// ─────────────────────────────────────────────────────────────────────────────
// StartSessionBanner — the first thing shown on load.
//
// The puppy template + tutorial no longer auto-start. Instead this banner asks
// the user to start the session; when they do, the banner is removed and it
// launches the "repair the puppy" mission (which loads the template and begins
// the guided walkthrough).
// ─────────────────────────────────────────────────────────────────────────────

export default function StartSessionBanner() {
  // Opened from the dashboard/share? Skip the puppy tutorial — go straight to the
  // user's own project.
  const [visible, setVisible] = useState(() => !isCloudMode())
  const startDebugMission = useOnboardingStore((s) => s.startDebugMission)

  if (!visible) return null

  const start = () => {
    setVisible(false)          // remove the banner…
    startDebugMission()        // …then load the template + start the tutorial
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      <div className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden text-center"
        style={{ background: 'rgb(var(--g-900))', border: '1px solid rgb(var(--a-500) / 0.35)' }}>

        <div className="px-8 pt-8 pb-2"
          style={{ background: 'linear-gradient(180deg, rgb(var(--a-500) / 0.14), transparent)' }}>
          <div className="flex justify-center mb-4">
            <ConstructaLogo width={170} />
          </div>
          <h1 className="text-lg font-bold"
            style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Ready to build?
          </h1>
          <p className="text-xs text-gray-400 mt-2 leading-relaxed max-w-xs mx-auto">
            Start your session and we'll kick off with a quick hands-on mission —
            meet a little robot that needs your help. 🐶🔧
          </p>
        </div>

        <div className="px-8 pt-4 pb-8">
          <button
            onClick={start}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(90deg,rgb(var(--a-500)),rgb(var(--a-600)))', boxShadow: '0 0 16px rgb(var(--a-500) / 0.35)' }}
          >
            Okay, let's start! 🚀
          </button>
        </div>
      </div>
    </div>
  )
}
