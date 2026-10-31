import fs from 'node:fs/promises';

/**
 * `runtime-config.json` or `runtime-config.<env>.json`; the capture is the env. The generated
 * `scripts/check-runtime-config.ts` cannot import this (generated projects do not depend on
 * core), so it carries the same pattern and a test keeps the two equal.
 */
export const RUNTIME_CONFIG_FILE = /^runtime-config(?:\.([a-z0-9-]+))?\.json$/;

/** The runtime-config file names in `folder` (`public/config`), sorted; none when the folder is missing. */
export async function runtimeConfigFiles(folder: string): Promise<string[]> {
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  return names
    .filter((name) => RUNTIME_CONFIG_FILE.test(name))
    .toSorted((a, b) => a.localeCompare(b));
}
