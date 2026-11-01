import { createUrlFactory, defineEndpoints } from '@mfeflow/url-factory';

export const endpoints = defineEndpoints({
  health: { service: 'api', path: '/health' },
});

const defaults: Record<string, string> = { api: '/api' };

// A service's base is `<service>Url` in the runtime config (apiUrl for api) when the shell loaded
// one, so a build runs in every environment; the default above is for tests and standalone runs.
function configured(service: string): string | undefined {
  const config: unknown = Reflect.get(globalThis, '__MFE_RUNTIME_CONFIG__');
  const value: unknown =
    typeof config === 'object' && config !== null
      ? Reflect.get(config, `${service}Url`)
      : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export const apiUrl = createUrlFactory(endpoints, (service) => {
  const base = configured(service) ?? defaults[service];
  return base === undefined ? undefined : new URL(base, location.origin).toString();
});
