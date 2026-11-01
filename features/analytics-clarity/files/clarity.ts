import { addProvider } from '@mfeflow/analytics';
import { createClarityProvider } from '@mfeflow/analytics/clarity';
import { fetchRuntimeConfig } from '@mfeflow/runtime';

/**
 * Adds Clarity next to the other analytics providers, from the runtime config's `clarityId`. With no id it
 * does nothing. Even with one, Clarity requests nothing until the visitor grants analytics consent.
 */
export async function startClarity(): Promise<void> {
  const config = await fetchRuntimeConfig().catch((error: unknown) => {
    console.warn('[analytics] the runtime config did not load, so Clarity stays off', error);
    return undefined;
  });
  const clarityId = config?.clarityId;
  if (typeof clarityId !== 'string' || clarityId === '') return;
  try {
    addProvider(createClarityProvider({ projectId: clarityId }));
  } catch (error) {
    console.warn('[analytics] Clarity not started', error);
  }
}

/** The boot step: never holds up the first render. */
export function initClarityFromConfig(): void {
  void startClarity();
}
