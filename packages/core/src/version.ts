import { createRequire } from 'node:module';

export interface PackageJson {
  name: string;
  version: string;
}

/** True when `value` has a string `name` and `version`. */
export function isPackageJson(value: unknown): value is PackageJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'version' in value &&
    typeof value.name === 'string' &&
    typeof value.version === 'string'
  );
}

/** Name and version from this package's package.json (works from src/ and dist/). */
export function readPackageJson(): PackageJson {
  const require = createRequire(import.meta.url);
  const pkg: unknown = require('../package.json');
  if (!isPackageJson(pkg)) throw new Error('package.json is missing a name or version');
  return pkg;
}
