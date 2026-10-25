import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * Separate from `vite.config.ts` so the production build config stays free of
 * test concerns. Only the `@/` alias needs to be mirrored.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
