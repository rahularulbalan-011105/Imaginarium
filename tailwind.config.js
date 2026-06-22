/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Accent palette — indigo primary (light theme) ────────────────────
        primary:   '#4F46E5',  // indigo-600
        secondary: '#6366f1',  // indigo-500

        // ── LIGHT THEME neutral ramp ─────────────────────────────────────────
        // The codebase uses bg-gray-900/950 for surfaces and text-gray-300/400/500
        // for text. We remap the SAME class names to light values so the whole UI
        // flips to a professional light theme without touching component markup:
        //   • high numbers (700–950)  → light surfaces / borders
        //   • low numbers  (50–500)   → dark, readable text
        gray: {
          950: '#F7F9FC',   // app background (primary)
          900: '#FFFFFF',   // panels / sidebar / header
          800: '#F1F5F9',   // cards / inputs / secondary surfaces
          700: '#E2E8F0',   // hover surfaces / light borders
          600: '#94A3B8',   // strong borders / disabled text
          500: '#64748B',   // muted text
          400: '#475569',   // secondary text
          300: '#334155',   // body text
          200: '#1E293B',   // emphasis text
          100: '#1E293B',   // near-black text
          50:  '#0F172A',   // darkest text
        },
      },
    },
  },
  plugins: [],
}
