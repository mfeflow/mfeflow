import { readPackageJson } from './version.js';

/** Name and version of this package. */
export function packageInfo(): { name: string; version: string } {
  const { name, version } = readPackageJson();
  return { name, version };
}
