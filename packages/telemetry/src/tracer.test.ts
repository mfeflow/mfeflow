import {
  context,
  trace,
  type Context,
  type Span,
  type SpanOptions,
  type Tracer,
} from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { MfeTracer } from './tracer';

interface Seen {
  name: string;
  options?: SpanOptions | undefined;
  context?: Context | undefined;
}

function fakeTracer(seen: Seen[]): Tracer {
  const span = trace.wrapSpanContext({
    traceId: '1'.repeat(32),
    spanId: '2'.repeat(16),
    traceFlags: 1,
  });
  return {
    startSpan(name, options, ctx) {
      seen.push({ name, options, context: ctx });
      return span;
    },
    startActiveSpan(name: string, ...rest: unknown[]) {
      const fn = rest.at(-1) as (s: Span) => unknown;
      const options = rest.length > 1 ? (rest[0] as SpanOptions) : undefined;
      const ctx = rest.length > 2 ? (rest[1] as Context) : undefined;
      seen.push({ name, options, context: ctx });
      return fn(span);
    },
  };
}

describe('MfeTracer', () => {
  it('stamps mfe.name on startSpan and keeps the caller attributes', () => {
    const seen: Seen[] = [];
    const tracer = new MfeTracer(() => fakeTracer(seen), { 'mfe.name': 'cart' });
    tracer.startSpan('a');
    tracer.startSpan('b', { attributes: { sku: 'x' }, root: true });
    expect(seen[0]?.options?.attributes).toEqual({ 'mfe.name': 'cart' });
    expect(seen[1]?.options?.attributes).toEqual({ 'mfe.name': 'cart', sku: 'x' });
    expect(seen[1]?.options?.root).toBe(true);
  });

  it('lets a caller attribute win over the stamp', () => {
    const seen: Seen[] = [];
    new MfeTracer(() => fakeTracer(seen), { 'mfe.name': 'cart' }).startSpan('a', {
      attributes: { 'mfe.name': 'other' },
    });
    expect(seen[0]?.options?.attributes?.['mfe.name']).toBe('other');
  });

  it('handles all three startActiveSpan forms and returns the callback result', () => {
    const seen: Seen[] = [];
    const tracer = new MfeTracer(() => fakeTracer(seen), {
      'mfe.name': 'cart',
      'mfe.version': '1',
    });
    expect(tracer.startActiveSpan('one', () => 1)).toBe(1);
    expect(tracer.startActiveSpan('two', { attributes: { a: 1 } }, () => 2)).toBe(2);
    const ctx = context.active();
    expect(tracer.startActiveSpan('three', {}, ctx, () => 3)).toBe(3);
    expect(seen.map((s) => s.name)).toEqual(['one', 'two', 'three']);
    expect(seen[0]?.options?.attributes).toEqual({ 'mfe.name': 'cart', 'mfe.version': '1' });
    expect(seen[1]?.options?.attributes).toEqual({ 'mfe.name': 'cart', 'mfe.version': '1', a: 1 });
    expect(seen[2]?.context).toBe(ctx);
  });

  it('refuses a call with no function', () => {
    const tracer = new MfeTracer(() => fakeTracer([]), {});
    expect(() =>
      (tracer.startActiveSpan as (...a: unknown[]) => unknown)('x', {}, context.active()),
    ).toThrow('needs a function');
  });

  it('asks for the real tracer on every call, so it follows the provider', () => {
    let calls = 0;
    const tracer = new MfeTracer(() => {
      calls++;
      return fakeTracer([]);
    }, {});
    tracer.startSpan('a');
    tracer.startSpan('b');
    expect(calls).toBe(2);
  });
});
