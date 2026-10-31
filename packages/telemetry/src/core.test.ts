import { trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRecordingProvider,
  flushTelemetry,
  getTracer,
  initTelemetry,
  isTelemetryReady,
  recordWebVitals,
  reportError,
  resetTelemetryForTests,
  telemetryReady,
  type TelemetryProvider,
} from '.';

const vital = { name: 'LCP', value: 1200, rating: 'good', id: 'v1' } as const;

beforeEach(() => {
  resetTelemetryForTests();
  Reflect.deleteProperty(globalThis, 'mfeflowReports');
});
afterEach(() => {
  resetTelemetryForTests();
  vi.useRealTimers();
});

describe('initTelemetry', () => {
  it('starts a provider given as an object, and only the first call counts', async () => {
    const first = createRecordingProvider();
    const second = createRecordingProvider();
    expect(initTelemetry(first)).toBe(true);
    expect(initTelemetry(second)).toBe(false);
    await telemetryReady();
    expect(isTelemetryReady()).toBe(true);
    reportError(new Error('x'), { mfe: 'cart' });
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toEqual([]);
  });

  it('keeps early calls and replays them in order once a lazy provider is ready', async () => {
    const provider = createRecordingProvider();
    initTelemetry(() => Promise.resolve(provider), { when: 'now' });
    reportError(new Error('early'), { mfe: 'cart', where: 'load' });
    recordWebVitals(vital);
    expect(provider.calls).toEqual([]);
    await telemetryReady();
    expect(provider.calls.map((c) => c.type)).toEqual(['error', 'web-vital']);
  });

  it('keeps calls made before init too', async () => {
    reportError(new Error('before'), { mfe: 'cart' });
    const provider = createRecordingProvider();
    initTelemetry(provider);
    await telemetryReady();
    expect(provider.calls).toHaveLength(1);
  });

  it('keeps only the last 50 early calls', async () => {
    for (let i = 0; i < 80; i++) reportError(new Error(String(i)), { mfe: 'cart' });
    const provider = createRecordingProvider();
    initTelemetry(provider);
    await telemetryReady();
    expect(provider.calls).toHaveLength(50);
    const first = provider.calls[0];
    expect(first?.type === 'error' && (first.error as Error).message).toBe('30');
  });

  it('waits for the page to load and the browser to be idle before loading', async () => {
    const load = vi.fn(() => Promise.resolve(createRecordingProvider()));
    const idle = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', idle);
    const ready = Object.getOwnPropertyDescriptor(document, 'readyState');
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      initTelemetry(load);
      await Promise.resolve();
      expect(load).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('load'));
      await telemetryReady();
      expect(idle).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      if (ready) Object.defineProperty(document, 'readyState', ready);
      else Reflect.deleteProperty(document, 'readyState');
      vi.unstubAllGlobals();
    }
  });

  it('falls back to a short timer where requestIdleCallback is missing', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const load = vi.fn(() => Promise.resolve(createRecordingProvider()));
    try {
      initTelemetry(load);
      await telemetryReady();
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stays on the noop provider and says why when the provider fails to load', async () => {
    const onError = vi.fn();
    initTelemetry(() => Promise.reject(new Error('chunk 404')), { when: 'now', onError });
    reportError(new Error('x'), { mfe: 'cart' });
    await telemetryReady();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'chunk 404' }));
    expect(isTelemetryReady()).toBe(false);
    expect(() => {
      reportError(new Error('later'), { mfe: 'cart' });
    }).not.toThrow();
  });

  it('stays on the noop provider when init throws', async () => {
    const broken: TelemetryProvider = {
      ...createRecordingProvider(),
      init: () => {
        throw new Error('bad endpoint');
      },
    };
    const onError = vi.fn();
    initTelemetry(broken, { onError });
    await telemetryReady();
    expect(onError).toHaveBeenCalled();
    expect(isTelemetryReady()).toBe(false);
  });

  it('reports the remote failures the runtime recorded, then the ones that follow', async () => {
    Reflect.set(globalThis, 'mfeflowReports', [
      { mfe: 'cart', where: 'registry', message: 'down', time: 1 },
    ]);
    const provider = createRecordingProvider();
    initTelemetry(provider);
    await telemetryReady();
    window.dispatchEvent(
      new CustomEvent('mfeflow:remote-error', {
        detail: { mfe: 'catalog', where: 'render', message: 'boom', time: 2 },
      }),
    );
    expect(provider.calls.map((c) => c.type === 'error' && c.context.mfe)).toEqual([
      'cart',
      'catalog',
    ]);
  });
});

describe('getTracer', () => {
  it('stamps mfe.name and mfe.version on the spans it starts', async () => {
    const started: { name: string; attributes?: unknown }[] = [];
    const provider: TelemetryProvider = {
      ...createRecordingProvider(),
      getTracer: () =>
        ({
          startSpan: (name: string, options?: { attributes?: unknown }) => {
            started.push({ name, attributes: options?.attributes });
            return trace.wrapSpanContext({
              traceId: '1'.repeat(32),
              spanId: '2'.repeat(16),
              traceFlags: 1,
            });
          },
        }) as never,
    };
    const tracer = getTracer('cart', '1.2.0');
    tracer.startSpan('before').end();
    expect(started).toEqual([]);
    initTelemetry(provider);
    await telemetryReady();
    tracer.startSpan('after').end();
    expect(started).toEqual([
      { name: 'after', attributes: { 'mfe.name': 'cart', 'mfe.version': '1.2.0' } },
    ]);
  });

  it('records nothing and does not throw before telemetry starts', () => {
    const span = getTracer('cart').startSpan('x');
    expect(span.isRecording()).toBe(false);
    span.end();
  });
});

describe('flushTelemetry', () => {
  it('asks the provider to send what it holds, and is fine without one', async () => {
    await expect(flushTelemetry()).resolves.toBeUndefined();
    const flush = vi.fn(() => Promise.resolve());
    initTelemetry({ ...createRecordingProvider(), flush });
    await telemetryReady();
    await flushTelemetry();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
