// Shared surface tokens so every floating panel/toolbar reads as one system
// (spec §10: consistent radius, elevation, blur, transition). Colour comes only
// from the theme CSS variables (--g-*, --a-*) — no hard-coded palette here.

// Glassmorphism: translucent panel surface + backdrop blur + rounded + soft
// shadow + a hairline accent-tinted border. ~200ms colour transitions.
export const GLASS =
  'rounded-lg border transition-[background-color,border-color] duration-150'

// Inline style companion to GLASS (translucent panel fill + subtle border).
export const glassStyle = {
  background: 'rgb(var(--g-900))',
  borderColor: 'rgb(var(--g-700))',
  boxShadow: '0 1px 3px rgb(0 0 0 / 0.08)',
}

// A single floating icon button — used across the toolbox, view cube and rail.
// `active` gives the solid accent state; otherwise a soft hover tint. 150–200ms.
export const ICON_BTN =
  'flex items-center justify-center rounded-md transition-colors duration-150'

export function iconBtnStyle(active) {
  return active
    ? { background: 'rgb(var(--a-600) / 0.12)', color: 'rgb(var(--a-700))' }
    : { background: 'transparent', color: 'rgb(var(--g-300))' }
}
