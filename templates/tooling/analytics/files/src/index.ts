import { createGtmProvider } from '@mfeflow/analytics/gtm';
import type { AnalyticsProvider } from '@mfeflow/analytics';
import { consentDefaults, containerIds, type Environment } from './defaults';

export * from '@mfeflow/analytics';
export { consentDefaults, containerIds, ENVIRONMENTS, type Environment } from './defaults';

export type GtmOptions = Parameters<typeof createGtmProvider>[0];

/** The Tag Manager options for an environment, with the company defaults under whatever you pass. */
export function analyticsOptions(
  env: Environment,
  overrides: Partial<GtmOptions> = {},
): GtmOptions {
  return { containerId: containerIds[env], consentDefaults, ...overrides };
}

/** A Tag Manager provider for an environment: `initAnalytics(createAnalytics('prod'))`. */
export function createAnalytics(
  env: Environment,
  overrides: Partial<GtmOptions> = {},
): AnalyticsProvider {
  const options = analyticsOptions(env, overrides);
  if (options.containerId === '') {
    throw new Error(`analytics: no container id for "${env}"; set it in src/defaults.ts`);
  }
  return createGtmProvider(options);
}
