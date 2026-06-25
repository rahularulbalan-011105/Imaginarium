import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves under /Imaginarium/; Netlify/Vercel serve at the domain
  // root, so they set VITE_BASE=/ at build time. Falls back to the GH Pages path.
  base: process.env.VITE_BASE ?? '/Imaginarium/',
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
})
