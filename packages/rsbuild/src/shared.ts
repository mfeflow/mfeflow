import fs from 'node:fs';
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
  /** `^<installed version>`. Set explicitly because Module Federation otherwise reads the raw spec from package.json, which is `catalog:` or `workspace:*` in pnpm workspaces. */
  requiredVersion?: string;
}

/** `react-dom/client` → `react-dom`, `@mfeflow/theme/react` → `@mfeflow/theme`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
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

/** Installed version of the package behind `specifier`, found by walking up from its entry file. */
export function installedVersionFrom(cwd: string): (specifier: string) => string | undefined {
  const require = createRequire(path.join(cwd, 'package.json'));
  return (specifier) => {
    const name = packageNameOf(specifier);
    let file: string;
    try {
      file = require.resolve(name);
    } catch {
      return undefined;
    }
    let dir = path.dirname(file);
    for (;;) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const pkg: unknown = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (typeof pkg === 'object' && pkg !== null && Reflect.get(pkg, 'name') === name) {
          const version: unknown = Reflect.get(pkg, 'version');
          return typeof version === 'string' ? version : undefined;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
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
  versionOf: (specifier: string) => string | undefined = () => undefined,
): Record<string, SharedConfig> {
  const out: Record<string, SharedConfig> = {};
  const add = (name: string) => {
    const version = versionOf(name);
    out[name] =
      version === undefined
        ? { singleton: true }
        : { singleton: true, requiredVersion: `^${version}` };
  };
  for (const name of DEFAULT_SINGLETONS) if (canResolve(name)) add(name);
  for (const name of extra) {
    if (!canResolve(name))
      throw new Error(
        `@mfeflow/rsbuild: shared package "${name}" cannot be resolved; is it installed?`,
      );
    add(name);
  }
  return out;
}
