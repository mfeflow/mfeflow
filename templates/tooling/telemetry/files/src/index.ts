import type { OtelOptions } from '@mfeflow/telemetry/otel';
import { otlpEndpoints, SERVICE_PREFIX, type Environment } from './defaults';

export * from '@mfeflow/telemetry';
export { otlpEndpoints, ENVIRONMENTS, SERVICE_PREFIX, type Environment } from './defaults';

export type { OtelOptions };

/**
 * The options for `createOtelProvider` in an environment: the prefixed service name, the environment name and
 * the collector address, with whatever you pass on top. It only builds options, so the OpenTelemetry code stays
 * in `/otel`, which the shell loads after first render.
 */
export function telemetryOptions(
  env: Environment,
  service: string,
  version: string,
  overrides: Partial<OtelOptions> = {},
): OtelOptions {
  const options: OtelOptions = {
    serviceName: `${SERVICE_PREFIX}-${service}`,
    version,
    environment: env,
    otlpEndpoint: otlpEndpoints[env],
    ...overrides,
  };
  if (options.exporter === undefined && options.otlpEndpoint === '') {
    throw new Error(`telemetry: no collector address for "${env}"; set it in src/defaults.ts`);
  }
  return options;
}
