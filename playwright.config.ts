import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'auth-tests',
      testMatch: '**/auth.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'client-tests',
      testMatch: 'tests/e2e/client/**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/client.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'operator-tests',
      testMatch: 'tests/e2e/operator/**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/operator.json',
      },
      dependencies: ['setup'],
    },
  ],
})
