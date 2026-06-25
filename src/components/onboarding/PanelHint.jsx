import { useOnboardingStore } from '../../onboarding/onboardingStore.js'

// A small, one-time explanation shown the first time a user opens a given panel.
// Dismissible; the dismissed state is remembered in the onboarding store
// (localStorage). Purely informational — renders nothing once dismissed.

const HINTS = {
  properties: { icon: '🛠', text: 'Edit the selected object here — size, color, position, material and more. Click an object to begin.' },
  objects:    { icon: '📋', text: 'Everything in your scene is listed here. Click to select, use 👁 to hide, ✕ to delete.' },
  wiring:     { icon: '⚡', text: 'Connect electronics together. Click a pin on one component, then a pin on another, to run a wire.' },
  joints:     { icon: '⚙', text: 'Joints link two parts so they move together — hinges, sliders, and pivots. Shift-click a 2nd object to start.' },
  blocks:     { icon: '🧩', text: 'Program visually using drag-and-drop blocks. No typing — it generates Arduino code for you.' },
  code:       { icon: '{ }', text: 'Write Arduino code here, then press Run. Use the Templates menu for a quick start.' },
  battle:     { icon: '⚔', text: 'Drive your robot in a head-to-head robo-sumo match — same PC or online.' },
  library:    { icon: '📦', text: 'Add more shapes, import your own 3D models (GLB/GLTF/STL), or reuse parts you saved.' },
  boolean:    { icon: '⊕', text: 'Combine the two selected shapes — union, subtract, or intersect.' },
}

export default function PanelHint({ panelId }) {
  const dismissed   = useOnboardingStore((s) => s.dismissedHints)
  const dismissHint = useOnboardingStore((s) => s.dismissHint)

  const hint = HINTS[panelId]
  if (!hint || dismissed[panelId]) return null

  return (
    <div className="flex items-start gap-2 mx-2 mt-2 px-2.5 py-2 rounded-lg"
      style={{ background: 'rgb(var(--a-500) / 0.08)', border: '1px solid rgb(var(--a-500) / 0.2)' }}>
      <span className="text-sm mt-0.5 shrink-0">{hint.icon}</span>
      <span className="text-[10px] text-indigo-800 leading-snug flex-1">{hint.text}</span>
      <button
        onClick={() => dismissHint(panelId)}
        title="Got it — don't show again"
        className="shrink-0 text-indigo-400/60 hover:text-slate-900 text-xs leading-none"
      >
        ✕
      </button>
    </div>
  )
}
