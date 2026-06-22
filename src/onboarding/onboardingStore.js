import { create } from 'zustand'

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding store — 100% UI/presentation state. It is INTENTIONALLY separate
// from every application store (scene, electronics, physics, joints, …) and
// never imports a manager. Nothing here touches simulation, physics, Arduino,
// Blockly, serialization, or save/load. It only tracks which onboarding UI is
// open and what the user has already seen (persisted to localStorage, which is
// independent of the IndexedDB project save system).
// ─────────────────────────────────────────────────────────────────────────────

const LS = {
  welcome: 'tinkerbot.welcomeSeen.v1',
  hints:   'tinkerbot.panelHints.v1',
}

const safeGet = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const safeSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

const loadHints = () => {
  try { return JSON.parse(safeGet(LS.hints) || '{}') } catch { return {} }
}

export const useOnboardingStore = create((set) => ({
  // First-run welcome card
  welcomeOpen: !safeGet(LS.welcome),

  // Product tour
  tourActive: false,
  tourStep: 0,

  // Learn-by-doing missions (legacy passive checklist — kept, unused by default)
  missionsActive: false,
  missionIndex: 0,
  missionFlash: null,   // transient "✓ done!" feedback text

  // Guided interactive coach (the active "teacher" tutorial)
  coachActive: false,
  coachStep: 0,
  coachSuccess: false,  // current step's action has been detected

  // Reference modals
  shortcutsOpen: false,
  guideOpen: false,

  // Contextual per-panel hints already dismissed
  dismissedHints: loadHints(),

  // ── Welcome ────────────────────────────────────────────────────────────────
  openWelcome:  () => set({ welcomeOpen: true }),
  closeWelcome: () => { safeSet(LS.welcome, '1'); set({ welcomeOpen: false }) },

  // ── Guided interactive coach ─────────────────────────────────────────────
  startCoach:       () => set({ coachActive: true, coachStep: 0, coachSuccess: false, welcomeOpen: false, tourActive: false, missionsActive: false }),
  restartCoach:     () => set({ coachActive: true, coachStep: 0, coachSuccess: false, welcomeOpen: false, tourActive: false, missionsActive: false }),
  markCoachSuccess: () => set({ coachSuccess: true }),
  nextCoachStep:    () => set((s) => ({ coachStep: s.coachStep + 1, coachSuccess: false })),
  endCoach:         () => set({ coachActive: false, coachSuccess: false }),

  // ── Product tour ─────────────────────────────────────────────────────────
  startTour:     () => set({ tourActive: true, tourStep: 0, welcomeOpen: false, missionsActive: false, coachActive: false }),
  nextTourStep:  () => set((s) => ({ tourStep: s.tourStep + 1 })),
  prevTourStep:  () => set((s) => ({ tourStep: Math.max(0, s.tourStep - 1) })),
  goToTourStep:  (i) => set({ tourStep: i }),
  endTour:       () => set({ tourActive: false }),

  // ── Missions ─────────────────────────────────────────────────────────────
  startMissions:   () => set({ missionsActive: true, missionIndex: 0, missionFlash: null, welcomeOpen: false, tourActive: false }),
  restartMissions: () => set({ missionsActive: true, missionIndex: 0, missionFlash: null, welcomeOpen: false, tourActive: false }),
  advanceMission:  (flash) => set((s) => ({ missionIndex: s.missionIndex + 1, missionFlash: flash || null })),
  clearMissionFlash: () => set({ missionFlash: null }),
  endMissions:     () => set({ missionsActive: false, missionFlash: null }),

  // ── Reference modals ─────────────────────────────────────────────────────
  openShortcuts:  () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  openGuide:      () => set({ guideOpen: true }),
  closeGuide:     () => set({ guideOpen: false }),

  // ── Contextual hints ─────────────────────────────────────────────────────
  dismissHint: (key) => set((s) => {
    const next = { ...s.dismissedHints, [key]: true }
    safeSet(LS.hints, JSON.stringify(next))
    return { dismissedHints: next }
  }),
}))
