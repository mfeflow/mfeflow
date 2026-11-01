import type { RegistrySources } from '@mfeflow/runtime';

/**
 * The index URLs for the shell. With `registryBeacon: true` in the runtime config this adds the
 * browser's id to the registry server's URLs (so a percentage rollout reaches the same people every
 * time) and starts the reporter that lets the server halt a bad rollout. Otherwise it is
 * `registrySources()` as it was. Use it in `bootstrap.tsx` in place of `registrySources()`.
 */
export async function registrySources(): Promise<RegistrySources> {
  const { registrySourcesWithBeacon } = await import('@mfeflow/runtime/beacon');
  return registrySourcesWithBeacon();
}
