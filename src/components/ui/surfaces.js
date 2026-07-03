// Shared surface tokens so every floating panel/toolbar reads as one system
// (spec §10: consistent radius, elevation, blur, transition). Colour comes only
// from the theme CSS variables (--g-*, --a-*) — no hard-coded palette here.

// Glassmorphism: translucent panel surface + backdrop blur + rounded + soft
// shadow + a hairline accent-tinted border. ~200ms colour transitions.
export const GLASS =
  'rounded-2xl border shadow-xl backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-200'

// Inline style companion to GLASS (translucent panel fill + subtle border).
export const glassStyle = {
  background: 'rgb(var(--g-900) / 0.72)',
  borderColor: 'rgb(var(--g-600) / 0.55)',
  boxShadow: '0 8px 24px -6px rgba(0,0,0,0.45), 0 0 0 1px rgb(var(--a-600) / 0.06)',
}

// A single floating icon button — used across the toolbox, view cube and rail.
// `active` gives the solid accent state; otherwise a soft hover tint. 150–200ms.
export const ICON_BTN =
  'flex items-center justify-center rounded-xl transition-all duration-200 ' +
  'hover:-translate-y-px active:translate-y-0'

export function iconBtnStyle(active) {
  return active
    ? { background: 'rgb(var(--a-600))', color: '#fff', boxShadow: '0 2px 8px rgb(var(--a-600) / 0.4)' }
    : { background: 'transparent', color: 'rgb(var(--g-300))' }
}
