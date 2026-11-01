import { combineProviders, partsOf } from './combine';
import { initAnalytics, joinProvider, runningProvider } from './core';
import type { AnalyticsProvider } from './types';

export { combineProviders };

/**
 * Starts analytics with a provider, or joins one that is already running: from then on both get every
 * call. Calls made before this one are not replayed to the newcomer. Returns false if a provider with
 * this name is already there. Use it where several features may start a provider in either order.
 *
 * This lives in its own entry point, for the shell only, so the shared `@mfeflow/analytics` module that
 * every remote loads stays as small as it was.
 */
export function addProvider(provider: AnalyticsProvider): boolean {
  const running = runningProvider();
  if (!running) return initAnalytics(provider);
  if (partsOf(running).some((p) => p.name === provider.name)) return false;
  joinProvider(combineProviders(running, provider), provider);
  return true;
}
