// ──────────────────────────────────────────────────────────────────────────
// Centralized light/dark THEME controller — presentation only.
//
// Sets `data-theme` on <html>; the actual colors live in CSS custom properties
// (src/styles/globals.css) which Tailwind consumes via the gray/indigo ramps.
// This module owns nothing but the *selected theme name* and its persistence.
//
// Default theme: dark. Persisted to localStorage under `app-theme`.
// This file never imports a store, manager, or any app logic.
// ──────────────────────────────────────────────────────────────────────────

const KEY = 'app-theme'
const VALID = ['dark', 'light']

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY)
    if (VALID.includes(t)) return t
  } catch (_) { /* private mode / no storage */ }
  return 'dark'
}

// Apply a theme to <html>. When `animate` is true, briefly enable a CSS
// colour-only transition (~200ms) so the switch fades instead of flashing.
export function applyTheme(theme, { animate = false } = {}) {
  const t = VALID.includes(theme) ? theme : 'dark'
  const root = document.documentElement

  if (animate) {
    root.classList.add('theme-anim')
    clearTimeout(applyTheme._t)
    applyTheme._t = setTimeout(() => root.classList.remove('theme-anim'), 240)
  }

  root.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch (_) { /* ignore */ }
  return t
}

export function toggleTheme() {
  return applyTheme(getTheme() === 'dark' ? 'light' : 'dark', { animate: true })
}

// Idempotent restore on load (the inline script in index.html already does this
// before first paint; this is a safe fallback for any code path that imports it).
export function initTheme() {
  return applyTheme(getTheme())
}
