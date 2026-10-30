import { createRequire } from 'node:module';

interface PackageJson {
  name: string;
  version: string;
}

/** Name and version from this package's package.json (works from src/ and dist/). */
export function readPackageJson(): PackageJson {
  const require = createRequire(import.meta.url);
  return require('../package.json') as PackageJson;
}
