import type { Tracer } from '@opentelemetry/api';

export type { Attributes, Span, SpanOptions, Tracer } from '@opentelemetry/api';

export interface ErrorContext {
  /** The remote the error came from. */
  mfe: string;
  /** Where it failed, e.g. `render`, `load`, `registry`. */
  where?: string | undefined;
}

/** The fields of a web-vitals metric the platform records. */
export interface WebVitalMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  id: string;
}

export interface TelemetryProvider {
  readonly name: string;
  init(): void | Promise<void>;
  getTracer(mfeName: string): Tracer;
  reportError(error: unknown, context: ErrorContext): void;
  recordWebVitals(metric: WebVitalMetric): void;
  /** Sends what is buffered now. Tests call this instead of waiting for the batch timer. */
  flush?: () => Promise<void>;
}
