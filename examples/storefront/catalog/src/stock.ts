import { getTracer } from '@mfeflow/telemetry';

// Spans started with this tracer carry mfe.name = catalog.
const tracer = getTracer('catalog');

function apiOrigin(): string {
  const config: unknown = Reflect.get(globalThis, '__MFE_RUNTIME_CONFIG__');
  const origin: unknown =
    typeof config === 'object' && config !== null ? Reflect.get(config, 'apiOrigin') : undefined;
  return typeof origin === 'string' ? origin : '';
}

async function read(response: Promise<Response>): Promise<number> {
  const body: unknown = await (await response).json();
  const count: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'count') : 0;
  return typeof count === 'number' ? count : 0;
}

/**
 * How many are in stock. The `fetch` starts inside the span's callback, before any await, which is
 * how the trace headers know their parent: the context follows synchronous calls only.
 */
export function checkStock(sku: string): Promise<number> {
  return tracer.startActiveSpan('catalog.check_stock', { attributes: { sku } }, (span) =>
    read(fetch(`${apiOrigin()}/stock/${sku}`)).finally(() => {
      span.end();
    }),
  );
}
