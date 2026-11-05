import { loadRegistryIndex, type LoadRegistryOptions, type RegistryIndex } from '@mfeflow/runtime';
import { registryUrls, type Environment } from './defaults';

export * from '@mfeflow/runtime';
export { registryUrls, ENVIRONMENTS, type Environment } from './defaults';

/**
 * The options for `loadRegistryIndex` in an environment: the origins of the registry addresses are allowed, with
 * whatever you pass on top. A same-origin address needs no entry.
 */
export function registryOptions(
  env: Environment,
  overrides: LoadRegistryOptions = {},
): LoadRegistryOptions {
  const allowedOrigins = registryUrls[env].flatMap((url) =>
    URL.canParse(url) ? [new URL(url).origin] : [],
  );
  return { allowedOrigins, ...overrides };
}

/** The registry index of an environment, from the addresses in `src/defaults.ts`. Throws if there are none. */
export function loadRegistry(
  env: Environment,
  overrides: LoadRegistryOptions = {},
): Promise<RegistryIndex> {
  const urls = registryUrls[env];
  if (urls.length === 0) {
    return Promise.reject(
      new Error(`runtime: no registry address for "${env}"; set it in src/defaults.ts`),
    );
  }
  return loadRegistryIndex(urls, registryOptions(env, overrides));
}
