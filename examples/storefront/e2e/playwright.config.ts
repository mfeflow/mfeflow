import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4300',
    // Locally `PW_CHANNEL=chrome` uses the installed Chrome instead of a downloaded Chromium.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node serve.ts',
    url: 'http://localhost:4300/registry/index.json',
    reuseExistingServer: !process.env.CI,
  },
});
