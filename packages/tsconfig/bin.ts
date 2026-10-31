import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Absolute path to a package's bin script, resolved from `from`. Run it with
 * `process.execPath` so tests work on Windows, where node_modules/.bin holds
 * .cmd shims that spawnSync cannot start directly.
 */
export function binPath(pkg: string, name: string, from: string): string {
  const require = createRequire(path.join(from, 'package.json'));
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const parsed: unknown = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
  const bin: unknown =
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'bin') : undefined;
  const rel: unknown =
    typeof bin === 'string'
      ? bin
      : typeof bin === 'object' && bin !== null
        ? Reflect.get(bin, name)
        : undefined;
  if (typeof rel !== 'string') throw new Error(`${pkg} has no "${name}" bin`);
  return path.join(path.dirname(pkgJson), rel);
}
