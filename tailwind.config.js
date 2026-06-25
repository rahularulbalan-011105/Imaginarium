/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Accent palette — orange primary (both themes) ────────────────────
        // Driven by --a-* so it stays consistent in light & dark.
        primary:   'rgb(var(--a-600) / <alpha-value>)',  // #F97316
        secondary: 'rgb(var(--a-500) / <alpha-value>)',  // #FB923C

        // ── NEUTRAL ramp ─────────────────────────────────────────────────────
        // The codebase uses bg-gray-900/950 for surfaces and text-gray-300/400/500
        // for text. These now resolve to CSS custom properties (--g-*) so the
        // whole UI flips between light & dark themes WITHOUT touching component
        // markup. The `rgb(... / <alpha-value>)` form preserves Tailwind opacity
        // modifiers (e.g. bg-gray-900/50). Token values live in globals.css.
        gray: {
          950: 'rgb(var(--g-950) / <alpha-value>)',
          900: 'rgb(var(--g-900) / <alpha-value>)',
          800: 'rgb(var(--g-800) / <alpha-value>)',
          700: 'rgb(var(--g-700) / <alpha-value>)',
          600: 'rgb(var(--g-600) / <alpha-value>)',
          500: 'rgb(var(--g-500) / <alpha-value>)',
          400: 'rgb(var(--g-400) / <alpha-value>)',
          300: 'rgb(var(--g-300) / <alpha-value>)',
          200: 'rgb(var(--g-200) / <alpha-value>)',
          100: 'rgb(var(--g-100) / <alpha-value>)',
          50:  'rgb(var(--g-50) / <alpha-value>)',
        },

        // ── ACCENT ramp ──────────────────────────────────────────────────────
        // The existing accent is written as `indigo-*` throughout. We remap that
        // ramp to the orange accent (--a-*) so all accents become orange in both
        // themes, with no markup changes. Tint/text shades adapt per theme.
        indigo: {
          950: 'rgb(var(--a-950) / <alpha-value>)',
          900: 'rgb(var(--a-900) / <alpha-value>)',
          800: 'rgb(var(--a-800) / <alpha-value>)',
          700: 'rgb(var(--a-700) / <alpha-value>)',
          600: 'rgb(var(--a-600) / <alpha-value>)',
          500: 'rgb(var(--a-500) / <alpha-value>)',
          400: 'rgb(var(--a-400) / <alpha-value>)',
          300: 'rgb(var(--a-300) / <alpha-value>)',
          200: 'rgb(var(--a-200) / <alpha-value>)',
          100: 'rgb(var(--a-100) / <alpha-value>)',
          50:  'rgb(var(--a-50) / <alpha-value>)',
        },

        // ── `slate` = theme-aware dark/light TEXT ─────────────────────────────
        // Used as "strong text" on panels (which flip with the theme). Mapped to
        // the neutral text channels so it inverts in dark mode. In light mode the
        // values equal default Tailwind slate (no visual change). The few labels
        // drawn directly on the always-white 3D canvas use fixed hex instead.
        slate: {
          900: 'rgb(var(--g-50) / <alpha-value>)',   // light: #0F172A
          800: 'rgb(var(--g-100) / <alpha-value>)',  // light: #1E293B
          700: 'rgb(var(--g-300) / <alpha-value>)',  // light: #334155
          600: 'rgb(var(--g-400) / <alpha-value>)',  // light: #475569
        },
      },
    },
  },
  plugins: [],
}
