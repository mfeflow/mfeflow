import { combineProviders, partsOf } from './combine';
import { initAnalytics, joinProvider, keepCallsForJoiners, runningProvider } from './core';
import type { AnalyticsProvider } from './types';

export { combineProviders };

// Loading this entry point means a provider may join later, so the early calls (the first page view) are kept for it.
keepCallsForJoiners();

/**
 * Starts analytics with a provider, or joins one that is already running: from then on both get every
 * call, and the newcomer first gets the calls made in the first ten seconds (at most 100), so the first page view reaches it
 * whichever provider started first. A provider drops what it must, by its own rule (Clarity drops events from before consent). Returns false if a provider with
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
