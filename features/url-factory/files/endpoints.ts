import { createUrlFactory, defineEndpoints } from '@mfeflow/url-factory';

export const endpoints = defineEndpoints({
  health: { service: 'api', path: '/health' },
});

const services: Record<string, string> = { api: '/api' };

export const apiUrl = createUrlFactory(endpoints, (service) => {
  const base = services[service];
  return base === undefined ? undefined : new URL(base, location.origin).toString();
});
