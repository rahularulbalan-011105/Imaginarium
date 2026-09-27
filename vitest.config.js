import { defineConfig } from 'vitest/config'

// Headless tests for the physics/robotics core. Rapier's -compat build embeds its
// WASM, so the real physics engine runs under Node — no browser needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
