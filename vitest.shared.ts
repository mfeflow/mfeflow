import path from 'node:path';

const root = import.meta.dirname;

/**
 * Tests import workspace packages from source, so `pnpm test` needs no build
 * and coverage maps to the real files. Builds and typecheck still use `dist`.
 */
export const workspaceAliases = [
  { find: /^@mfeflow\/([a-z-]+)\/react$/, replacement: path.join(root, 'packages/$1/src/react') },
  { find: /^@mfeflow\/([a-z-]+)$/, replacement: path.join(root, 'packages/$1/src/index') },
];
