import { initAnalytics } from '@mfeflow/analytics';
import { createGtmProvider } from '@mfeflow/analytics/gtm';
import { fetchRuntimeConfig } from '@mfeflow/runtime';

/**
 * Starts analytics from the runtime config's `gtmId`. With no id, analytics stays off and every
 * tracker call is dropped. Safe to call twice: the first start wins.
 */
export async function startAnalytics(): Promise<void> {
  const config = await fetchRuntimeConfig().catch((error: unknown) => {
    console.warn('[analytics] the runtime config did not load, so analytics stays off', error);
    return undefined;
  });
  const gtmId = config?.gtmId;
  if (typeof gtmId !== 'string' || gtmId === '') return;
  try {
    initAnalytics(createGtmProvider({ containerId: gtmId }));
  } catch (error) {
    console.warn('[analytics] not started', error);
  }
}

/** The boot step: starts analytics without holding up first render. */
export function initAnalyticsFromConfig(): void {
  void startAnalytics();
}
