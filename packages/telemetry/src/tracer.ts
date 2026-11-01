import type { Attributes, Context, Span, SpanOptions, Tracer } from '@opentelemetry/api';

type SpanCallback = (span: Span) => unknown;

/**
 * A tracer that looks up the real one on every call, so a tracer a remote took at import time
 * starts recording once the provider is ready, and stamps `mfe.name` on every span it starts.
 */
export class MfeTracer implements Tracer {
  readonly #resolve: () => Tracer;
  readonly #tags: Attributes;

  constructor(resolve: () => Tracer, tags: Attributes) {
    this.#resolve = resolve;
    this.#tags = tags;
  }

  #tagged(options: SpanOptions | undefined): SpanOptions {
    return { ...options, attributes: { ...this.#tags, ...options?.attributes } };
  }

  startSpan(name: string, options?: SpanOptions, context?: Context): Span {
    return this.#resolve().startSpan(name, this.#tagged(options), context);
  }

  startActiveSpan<F extends (span: Span) => ReturnType<F>>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    options: SpanOptions,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan(
    name: string,
    a: SpanOptions | SpanCallback,
    b?: Context | SpanCallback,
    c?: SpanCallback,
  ): unknown {
    const tracer = this.#resolve();
    if (typeof a === 'function') return tracer.startActiveSpan(name, this.#tagged(undefined), a);
    if (typeof b === 'function') return tracer.startActiveSpan(name, this.#tagged(a), b);
    if (b === undefined || c === undefined) {
      throw new TypeError('startActiveSpan needs a function to run inside the span');
    }
    return tracer.startActiveSpan(name, this.#tagged(a), b, c);
  }
}
