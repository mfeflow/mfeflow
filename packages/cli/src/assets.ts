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
 */
export function assetRoots(
  from: string = path.dirname(fileURLToPath(import.meta.url)),
  exists: (dir: string) => boolean = fs.existsSync,
): AssetRoots {
  const pkg = path.resolve(from, '..');
  const bundled = path.join(pkg, 'assets');
  const base = exists(path.join(bundled, 'features')) ? bundled : path.resolve(pkg, '../..');
  return { features: path.join(base, 'features'), templates: path.join(base, 'templates') };
}
