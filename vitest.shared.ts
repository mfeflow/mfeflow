import path from 'node:path';

const root = import.meta.dirname;

/**
 * Tests import workspace packages from source, so `pnpm test` needs no build
 * and coverage maps to the real files. Builds and typecheck still use `dist`.
 */
export const workspaceAliases = [
  { find: /^mfeflow$/, replacement: path.join(root, 'packages/cli/src/index') },
  {
    find: /^@mfeflow\/([a-z-]+)\/(react|gtm|otel|standard-schema|static|s3)$/,
    replacement: path.join(root, 'packages/$1/src/$2'),
  },
  { find: /^@mfeflow\/([a-z-]+)$/, replacement: path.join(root, 'packages/$1/src/index') },
];

/**
 * Windows CI runners start processes and fsync far slower than Linux or macOS, so tests that
 * spawn git, run installs or write SQLite pass there only with more room. Elsewhere the default
 * stays, so a real hang still fails fast.
 */
export const testTimeout = process.platform === 'win32' ? 20_000 : 5000;
