/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Accent palette — warm amber / orange ─────────────────────────────
        primary:   '#f59e0b',  // amber-500
        secondary: '#f97316',  // orange-500

        // ── Warm charcoal gray scale — rich dark neutrals, no blue tint ──────
        // Every bg-gray-* / text-gray-* / border-gray-* picks this up automatically.
        gray: {
          950: '#0c0b09',
          900: '#131210',   // main backgrounds
          800: '#1c1a17',   // panel / sidebar bg
          700: '#252320',   // card / input bg
          600: '#32302b',   // border / divider
          500: '#5c5750',   // muted / placeholder text
          400: '#918c83',   // secondary text
          300: '#c4bfb5',   // body text
          200: '#dedad4',   // emphasis text
          100: '#f0ece6',   // near-white
          50:  '#f8f5f0',   // whitest
        },
      },
    },
  },
  plugins: [],
}
