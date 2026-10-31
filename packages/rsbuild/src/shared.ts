import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Packages every mfeflow app shares as singletons, when the app depends on
 * them. Subpaths are listed on purpose: Module Federation shares each import
 * specifier separately, and `react-dom/client` bypassing the share was a real
 * React 19 bug (module-federation/core#4727).
 */
export const DEFAULT_SINGLETONS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-router',
  '@tanstack/react-query',
  'i18next',
  'react-i18next',
  '@mfeflow/runtime',
  '@mfeflow/storage',
  '@mfeflow/storage/react',
  '@mfeflow/theme',
  '@mfeflow/theme/react',
  '@mfeflow/i18n',
  '@mfeflow/i18n/react',
];

export interface SharedConfig {
  singleton: true;
}

/** Can `specifier` be resolved from the app in `cwd`? */
export function resolvableFrom(cwd: string): (specifier: string) => boolean {
  const require = createRequire(path.join(cwd, 'package.json'));
  return (specifier) => {
    try {
      require.resolve(specifier);
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * The `shared` map for an app: the default singletons it can resolve, plus
 * `extra`. Unresolvable defaults are skipped so a remote without i18n does not
 * fail to build; unresolvable extras throw, because they are a typo.
 */
export function sharedSingletons(
  canResolve: (specifier: string) => boolean,
  extra: readonly string[] = [],
): Record<string, SharedConfig> {
  const out: Record<string, SharedConfig> = {};
  for (const name of DEFAULT_SINGLETONS) if (canResolve(name)) out[name] = { singleton: true };
  for (const name of extra) {
    if (!canResolve(name))
      throw new Error(
        `@mfeflow/rsbuild: shared package "${name}" cannot be resolved; is it installed?`,
      );
    out[name] = { singleton: true };
  }
  return out;
}
