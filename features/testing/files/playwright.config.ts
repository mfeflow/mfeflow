import { defineConfig, devices } from '@playwright/test';

// Set BASE_URL to test a deployed shell (a preview, staging); otherwise `pnpm dev` is started here.
const baseURL = process.env.BASE_URL ?? 'http://localhost:4300';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'node_modules/.cache/playwright/results',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'node_modules/.cache/playwright/report' }],
      ]
    : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
          timeout: 120_000,
        },
      }),
});
