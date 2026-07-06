import { useOnboardingStore } from '../onboarding/onboardingStore.js'
import { useOverlay } from './ui/overlay.js'

// ─────────────────────────────────────────────────────────────────────────────
// OverlayBridge — a headless (renders null) adapter that mirrors the onboarding
// UI flags into the overlay-priority coordinator. This lets the View Cube defer
// to the Welcome card, Product Tour, Guided Coach and reference modals WITHOUT
// editing any of those tutorial components — it only READS onboardingStore
// (never mutates it) and registers matching overlay ids. Purely presentational.
// ─────────────────────────────────────────────────────────────────────────────
export default function OverlayBridge() {
  const welcomeOpen   = useOnboardingStore((s) => s.welcomeOpen)
  const tourActive    = useOnboardingStore((s) => s.tourActive)
  const coachActive   = useOnboardingStore((s) => s.coachActive)
  const shortcutsOpen = useOnboardingStore((s) => s.shortcutsOpen)
  const guideOpen     = useOnboardingStore((s) => s.guideOpen)

  useOverlay('onboarding-welcome',   welcomeOpen)
  useOverlay('onboarding-tour',      tourActive)
  useOverlay('onboarding-coach',     coachActive)
  useOverlay('onboarding-shortcuts', shortcutsOpen)
  useOverlay('onboarding-guide',     guideOpen)

  return null
}
