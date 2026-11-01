import { createHttpClient } from '@mfeflow/http';
import { getTracer } from '@mfeflow/telemetry';
import { createUrlFactory, defineEndpoints } from '@mfeflow/url-factory';

// Spans started with this tracer carry mfe.name = catalog.
const tracer = getTracer('catalog');

const endpoints = defineEndpoints({ stock: { service: 'api', path: '/stock/:sku' } });

function apiOrigin(): string {
  const config: unknown = Reflect.get(globalThis, '__MFE_RUNTIME_CONFIG__');
  const origin: unknown =
    typeof config === 'object' && config !== null ? Reflect.get(config, 'apiOrigin') : undefined;
  return typeof origin === 'string' && origin !== '' ? origin : location.origin;
}

const api = createHttpClient<typeof endpoints>({
  url: createUrlFactory(endpoints, apiOrigin),
});

function toCount(body: unknown): number {
  const count: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'count') : 0;
  return typeof count === 'number' ? count : 0;
}

/**
 * How many are in stock. The request starts inside the span's callback, in the same tick, which is
 * how the trace headers know their parent: the context follows synchronous calls only.
 */
export function checkStock(sku: string): Promise<number> {
  return tracer.startActiveSpan('catalog.check_stock', { attributes: { sku } }, (span) =>
    api.get('stock', { params: { sku }, parse: toCount }).finally(() => {
      span.end();
    }),
  );
}
