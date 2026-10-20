import { defineConfig } from 'vitest/config'

// Headless tests for the physics/robotics core. Rapier's -compat build embeds its
// WASM, so the real physics engine runs under Node — no browser needed.
export default defineConfig({
  // Some tests import a component module for its pure helpers (e.g. the
  // workbench board shapes); the automatic JSX runtime keeps that working
  // without pulling a React global into scope.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
