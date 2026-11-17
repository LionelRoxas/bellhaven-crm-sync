import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Set once in the runner process; workers inherit the same values through the environment.
process.env.E2E_DB_PATH ??= join(tmpdir(), `bellhaven-e2e-${Date.now()}`, 'sync.db')
process.env.E2E_CRM_PORT ??= '3101'

const PORT = 3100

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './test/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DB_PATH: process.env.E2E_DB_PATH,
      CRM_API_BASE: `http://127.0.0.1:${process.env.E2E_CRM_PORT}`,
      CRM_TOKEN: 'test',
    },
  },
})
