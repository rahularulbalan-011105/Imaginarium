import { useEffect } from 'react'
import { create } from 'zustand'

// ─────────────────────────────────────────────────────────────────────────────
// Overlay-priority coordinator — a small, REUSABLE registry that tracks which
// floating popups/menus/dialogs/modals/tutorial cards are currently open, so
// passive viewport widgets (the View Cube) can automatically step aside and let
// the overlay have visual + interaction priority.
//
// This is UI-only presentation infrastructure: it holds no app/scene/physics
// state, imports no manager, and is independent of every application store.
//
//   • An overlay owner calls  useOverlay('help-menu', isOpen)  while mounted.
//   • A passive widget calls   const hidden = useAnyOverlay()   and fades out.
//
// Any future dropdown / context menu / dialog / onboarding window opts in with a
// single useOverlay(id, open) line — no per-widget wiring required.
// ─────────────────────────────────────────────────────────────────────────────

const useOverlayStore = create((set) => ({
  overlays: {},                          // { [id]: true } for each open overlay
  setOverlay: (id, active) =>
    set((s) => {
      if (!!s.overlays[id] === !!active) return s     // no-op → no re-render
      const next = { ...s.overlays }
      if (active) next[id] = true
      else delete next[id]
      return { overlays: next }
    }),
}))

// Register `id` as an active overlay while `active` is truthy; auto-clears on
// change and on unmount so a closed/removed overlay never lingers.
export function useOverlay(id, active) {
  const setOverlay = useOverlayStore((s) => s.setOverlay)
  useEffect(() => {
    setOverlay(id, !!active)
    return () => setOverlay(id, false)
  }, [id, active, setOverlay])
}

// True whenever ANY overlay is currently registered as open.
export const useAnyOverlay = () =>
  useOverlayStore((s) => Object.keys(s.overlays).length > 0)
