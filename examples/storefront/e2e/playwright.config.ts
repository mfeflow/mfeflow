import { defineConfig } from '@playwright/test';
import { ROLLBACK_HOST, ROLLBACK_PORT } from './rollback-support';

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
  webServer: [
    {
      command: 'node serve.ts',
      url: 'http://localhost:4300/registry/index.json',
      reuseExistingServer: !process.env.CI,
    },
    {
      // The development build of the shell, for the StrictMode test; the remotes are the production ones.
      command: 'node serve.ts',
      env: { SHELL_PORT: '4320', MONOLITH_PORT: '4321', SHELL_DIST: 'dist-dev' },
      url: 'http://localhost:4320/registry/index.json',
      reuseExistingServer: !process.env.CI,
    },
    {
      // Serves the registry from a folder that rollback.spec.ts fills with `mfeflow deploy`. The shell reads
      // /registry/index.json itself (no edge injection), so the 60 s index header is what a browser sees.
      command: 'node serve.ts',
      env: {
        SHELL_PORT: String(ROLLBACK_PORT),
        MONOLITH_PORT: String(ROLLBACK_PORT + 1),
        SERVE_REGISTRY_DIR: ROLLBACK_HOST,
        SERVE_INJECT: '0',
      },
      port: ROLLBACK_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
