import type { RsbuildConfig } from '@rsbuild/core';

export const DEV_BUILD = 'dev-build';

/**
 * `rsbuild build --mode development --env-mode dev-build` writes dist-dev: the React development
 * build the StrictMode test serves. It is served as a build, so it has no hot reload and no React
 * Refresh runtime; `rsbuild dev` and the production build keep their defaults.
 */
export function buildModeConfig(envMode: string | undefined): RsbuildConfig {
  const devBuild = envMode === DEV_BUILD;
  return {
    output: { distPath: { root: devBuild ? 'dist-dev' : 'dist' } },
    ...(devBuild ? { dev: { hmr: false } } : {}),
  };
}
