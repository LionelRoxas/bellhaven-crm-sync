import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      'server-only': r('./test/empty.ts'),
      '@': r('./src'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'node_modules/**'],
  },
})
