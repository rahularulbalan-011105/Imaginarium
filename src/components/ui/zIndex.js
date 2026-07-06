// ─────────────────────────────────────────────────────────────────────────────
// Global stacking hierarchy — one source of truth so every floating layer stays
// consistently ordered. Higher number = painted on top. Import Z and use it
// (inline style zIndex) for any new floating layer instead of ad-hoc z-* classes.
//
//   L1 viewport    the 3D canvas (implicit 0)
//   L2 toolbox     floating tool toolbox        (top-left)
//   L3 viewCube    passive View-Cube widget     (top-right) — yields to overlays
//   L4 dropdown    header menus / context menus
//   L5 dialog      modeless dialogs (Open project)
//   L6 coach       guided tutorial coach overlay
//   L7 modal       blocking modal windows (shortcuts, beginner guide)
//   L8 toast       global notifications
//
// Existing components already use matching numeric z values (coach 120, modals
// 130, dialogs 50); this table documents and centralizes them.
// ─────────────────────────────────────────────────────────────────────────────
export const Z = {
  viewport:  0,
  toolbox:   20,
  viewCube:  30,
  dropdown:  40,
  dialog:    50,
  coach:     120,
  modal:     130,
  toast:     200,
}
