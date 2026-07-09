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
  build: {
    // Multi-page: the app (index.html) + the standalone UTM analytics dashboard.
    // Declaring both as inputs is the supported way to emit a second HTML page
    // (a public/*.html with inline <style> collides with Vite's inline-css proxy).
    rollupOptions: {
      input: {
        main: 'index.html',
        utm:  'utm-dashboard.html',
      },
    },
  },
})
