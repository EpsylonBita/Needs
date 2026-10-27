import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const projectDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx,mjs}'],
    // These exercise executable Node scripts using node:test, not jsdom/Vitest.
    exclude: ['tests/scripts/payments-reconciliation-worker.test.mjs', 'tests/scripts/verify-stripe-test-payments.test.mjs'],
    environment: 'jsdom',
    setupFiles: [path.resolve(projectDir, 'tests/setup.ts')],
    globals: true,
    maxWorkers: 2,
    clearMocks: true,
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'react' },
  },
  resolve: {
    alias: {
      '@': projectDir,
    }
  }
})
