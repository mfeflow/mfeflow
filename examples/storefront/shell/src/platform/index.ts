import { initAnalytics } from '@mfeflow/analytics';
import { createGtmProvider } from '@mfeflow/analytics/gtm';
import { initTelemetry } from '@mfeflow/telemetry';
import { fetchRuntimeConfig } from '@mfeflow/runtime';

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Starts analytics and telemetry from the runtime config, the way a project made with
 * `analytics-gtm` and `telemetry-otel` does. Both stay off without their config key. The shell and
 * the one-app baseline call this same function, so the cost comparison stays fair.
 */
export async function startPlatform(): Promise<void> {
  const config = await fetchRuntimeConfig().catch((error: unknown) => {
    console.warn(
      '[platform] the runtime config did not load, so analytics and telemetry stay off',
      error,
    );
    return {};
  });
  const { gtmId, otlpEndpoint, traceSampleRatio, environment } = config;
  if (typeof gtmId === 'string' && gtmId !== '') {
    try {
      initAnalytics(createGtmProvider({ containerId: gtmId, scriptUrl: scriptUrl(config) }));
    } catch (error) {
      console.warn('[analytics] not started', error);
    }
  }
  if (typeof otlpEndpoint === 'string' && otlpEndpoint !== '') {
    try {
      initTelemetry(
        async () => {
          const { createOtelProvider } = await import('@mfeflow/telemetry/otel');
          return createOtelProvider({
            serviceName: 'storefront',
            version: '0.0.0',
            environment: typeof environment === 'string' ? environment : 'unknown',
            otlpEndpoint,
            sampleRatio: typeof traceSampleRatio === 'number' ? traceSampleRatio : undefined,
            propagateTraceHeaderCorsUrls: strings(config.propagateTraceHeaderCorsUrls),
          });
        },
        {
          onError: (error) => {
            console.warn('[telemetry] not started', error);
          },
        },
      );
    } catch (error) {
      console.warn('[telemetry] not started', error);
    }
  }
}

/** Tests point `gtm.js` somewhere they can intercept; a real container uses Google's. */
function scriptUrl(config: Record<string, unknown>): string | undefined {
  return typeof config.gtmScriptUrl === 'string' ? config.gtmScriptUrl : undefined;
}
