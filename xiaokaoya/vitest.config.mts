import { defineConfig } from 'vitest/config'

// Explicit ESM configuration; the Electron main-process package remains CommonJS.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
  },
})
