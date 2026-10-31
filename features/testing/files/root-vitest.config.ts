import { defineConfig } from 'vitest/config';

// `pnpm test` runs every app's own vitest config in one go.
export default defineConfig({
  test: { projects: ['apps/*'] },
});
