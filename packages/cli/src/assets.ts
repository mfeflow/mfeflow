import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AssetRoots {
  /** Folder with one sub-folder per optional first-party feature. */
  features: string;
  /** Folder with the project templates; `monorepo` holds the `core` feature. */
  templates: string;
}

/**
 * Published, the features and templates are copied next to `dist` (`assets/`).
 * In a checkout they sit at the repository root, two levels above this package.
 * Code running from `src` (the tests) always reads the checkout, so an edit to a
 * template is seen without a build, and a stale `assets/` left by one never is.
 */
export function assetRoots(
  from: string = path.dirname(fileURLToPath(import.meta.url)),
  exists: (dir: string) => boolean = fs.existsSync,
): AssetRoots {
  const pkg = path.resolve(from, '..');
  const bundled = path.join(pkg, 'assets');
  const fromSource = path.basename(from) === 'src';
  const base =
    !fromSource && exists(path.join(bundled, 'features')) ? bundled : path.resolve(pkg, '../..');
  return { features: path.join(base, 'features'), templates: path.join(base, 'templates') };
}
