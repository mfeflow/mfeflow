import { context, propagation, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampRatio,
  clip,
  createOtelProvider,
  MAX_ERROR_TEXT,
  prefixPattern,
  scrubUrl,
  type OtelOptions,
} from './otel';

const base: OtelOptions = {
  serviceName: 'shell',
  version: '1.2.3',
  environment: 'test',
  otlpEndpoint: 'https://collector.example.com/v1/traces',
  webVitals: false,
};

let exporter: InMemorySpanExporter;
const finished = (): ReadableSpan[] => exporter.getFinishedSpans();

beforeEach(() => {
  exporter = new InMemorySpanExporter();
});
afterEach(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

async function start(extra: Partial<OtelOptions> = {}) {
  const provider = createOtelProvider({ ...base, exporter, exportDelayMs: 60_000, ...extra });
  await provider.init();
  return provider;
}

describe('createOtelProvider', () => {
  it('describes the service on every span', async () => {
    const provider = await start();
    provider.getTracer('cart').startSpan('work').end();
    await provider.flush?.();
    expect(finished()).toHaveLength(1);
    expect(finished()[0]?.resource.attributes).toMatchObject({
      'service.name': 'shell',
      'service.version': '1.2.3',
      'deployment.environment.name': 'test',
    });
  });

  it('registers itself globally, so remotes taking a tracer from the API record too', async () => {
    await start();
    expect(trace.getTracer('anything').startSpan('x').isRecording()).toBe(true);
  });

  it("gives a child span its parent's mfe.name when it has none", async () => {
    const provider = await start();
    const tracer = provider.getTracer('cart');
    const parent = tracer.startSpan('click', { attributes: { 'mfe.name': 'cart' } });
    context.with(trace.setSpan(context.active(), parent), () => {
      tracer.startSpan('fetch').end();
    });
    parent.end();
    await provider.flush?.();
    const child = finished().find((s) => s.name === 'fetch');
    expect(child?.attributes['mfe.name']).toBe('cart');
    expect(child?.spanContext().traceId).toBe(parent.spanContext().traceId);
  });

  it('records nothing at ratio 0 and everything at ratio 1', async () => {
    const off = await start({ sampleRatio: 0 });
    expect(off.getTracer('cart').startSpan('x').isRecording()).toBe(false);
    trace.disable();
    exporter.reset();
    const on = await start({ sampleRatio: 1 });
    on.getTracer('cart').startSpan('y').end();
    await on.flush?.();
    expect(finished()).toHaveLength(1);
  });

  it('turns an error report into a span with the exception and an error status', async () => {
    const provider = await start();
    provider.reportError(new Error('boom'), { mfe: 'cart', where: 'render' });
    provider.reportError('plain text', { mfe: 'catalog' });
    await provider.flush?.();
    const [first, second] = finished();
    expect(first?.name).toBe('mfe.error');
    expect(first?.attributes).toMatchObject({ 'mfe.name': 'cart', 'mfe.error.where': 'render' });
    expect(first?.status).toMatchObject({ code: 2, message: 'boom' });
    expect(first?.events[0]?.name).toBe('exception');
    expect(second?.attributes['mfe.name']).toBe('catalog');
    expect(second?.attributes['mfe.error.where']).toBeUndefined();
  });

  it('caps the message and stack of a reported error', async () => {
    const provider = await start();
    const error = new Error('m'.repeat(10_000));
    error.stack = 's'.repeat(10_000);
    provider.reportError(error, { mfe: 'cart' });
    await provider.flush?.();
    const span = finished()[0];
    const event = span?.events[0]?.attributes;
    expect(String(span?.status.message).length).toBeLessThan(MAX_ERROR_TEXT + 40);
    expect(String(event?.['exception.message']).length).toBeLessThan(MAX_ERROR_TEXT + 40);
    expect(String(event?.['exception.stacktrace']).length).toBeLessThan(MAX_ERROR_TEXT + 40);
    expect(String(event?.['exception.stacktrace'])).toContain('[truncated]');
  });

  it('records a web vital as a span tagged with the shell', async () => {
    const provider = await start();
    provider.recordWebVitals({ name: 'LCP', value: 1500, rating: 'good', id: 'v1-1' });
    await provider.flush?.();
    expect(finished()[0]?.name).toBe('web_vital.LCP');
    expect(finished()[0]?.attributes).toMatchObject({
      'mfe.name': 'shell',
      'web_vital.value': 1500,
      'web_vital.rating': 'good',
    });
  });

  it('starts watching web vitals unless turned off', async () => {
    const watching = vi.fn();
    vi.doMock('web-vitals', () => ({
      onCLS: watching,
      onFCP: watching,
      onINP: watching,
      onLCP: watching,
      onTTFB: watching,
    }));
    vi.resetModules();
    const { createOtelProvider: fresh } = await import('./otel');
    const provider = fresh({ ...base, exporter, webVitals: true });
    await provider.init();
    await vi.waitFor(() => {
      expect(watching).toHaveBeenCalledTimes(5);
    });
    vi.doUnmock('web-vitals');
  });

  it('logs, and does not throw, when web vitals fail to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('web-vitals', () => {
      throw new Error('no chunk');
    });
    vi.resetModules();
    const { createOtelProvider: fresh } = await import('./otel');
    await fresh({ ...base, exporter, webVitals: true }).init();
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled();
    });
    error.mockRestore();
    vi.doUnmock('web-vitals');
  });
});

const dirty = 'https://user:pass@api.example.com/v1/orders?token=abc&email=a%40b.com#frag';

async function spanWithUrls(extra: Partial<OtelOptions>): Promise<Record<string, unknown>> {
  const provider = await start(extra);
  provider
    .getTracer('cart')
    .startSpan('HTTP GET', {
      attributes: { 'url.full': dirty, 'http.url': dirty, 'url.query': 'token=abc' },
    })
    .end();
  await provider.flush?.();
  return { ...finished()[0]?.attributes };
}

describe('url scrubbing', () => {
  it('exports origin and path only by default', async () => {
    const attributes = await spanWithUrls({});
    expect(attributes['url.full']).toBe('https://api.example.com/v1/orders');
    expect(attributes['http.url']).toBe('https://api.example.com/v1/orders');
    expect(attributes['url.query']).toBeUndefined();
    expect(JSON.stringify(attributes)).not.toMatch(/token|email|pass|frag/);
  });

  it('keeps the query with recordQuery, but still drops userinfo and fragment', async () => {
    const attributes = await spanWithUrls({ recordQuery: true });
    expect(attributes['url.full']).toBe(
      'https://api.example.com/v1/orders?token=abc&email=a%40b.com',
    );
    expect(attributes['url.query']).toBe('token=abc');
  });

  it('scrubUrl survives a value that is not a URL', () => {
    expect(scrubUrl('/orders?token=abc#x', false)).toBe('/orders');
    expect(scrubUrl('/orders', false)).toBe('/orders');
    expect(clip('abc', 2)).toBe('ab...[truncated]');
  });
});

describe('helpers', () => {
  it('prefixPattern matches the prefix only at the start and escapes dots', () => {
    const pattern = prefixPattern('https://api.example.com');
    expect(pattern.test('https://api.example.com/v1/orders')).toBe(true);
    expect(pattern.test('https://apixexample.com/v1')).toBe(false);
    expect(pattern.test('https://evil.test/?u=https://api.example.com')).toBe(false);
  });

  it('prefixPattern does not let another host start with the same text', () => {
    const pattern = prefixPattern('https://api.example.com');
    expect(pattern.test('https://api.example.com')).toBe(true);
    expect(pattern.test('https://api.example.com?x=1')).toBe(true);
    expect(pattern.test('https://api.example.com.evil.test/v1')).toBe(false);
    expect(pattern.test('https://api.example.community')).toBe(false);
    expect(
      prefixPattern('https://api.example.com/v1/').test('https://api.example.com/v1/orders'),
    ).toBe(true);
    expect(
      prefixPattern('https://api.example.com/v1/').test('https://api.example.com/v2/orders'),
    ).toBe(false);
  });

  it('clampRatio keeps the ratio between 0 and 1 and defaults to everything', () => {
    expect([
      clampRatio(undefined),
      clampRatio(Number.NaN),
      clampRatio(-1),
      clampRatio(2),
      clampRatio(0.25),
    ]).toEqual([1, 1, 0, 1, 0.25]);
  });
});
