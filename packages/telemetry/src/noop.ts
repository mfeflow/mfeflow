import { trace } from '@opentelemetry/api';
import type { ErrorContext, TelemetryProvider, WebVitalMetric } from './types';

export const noopProvider: TelemetryProvider = {
  name: 'noop',
  init() {},
  getTracer: (mfeName) => trace.getTracer(mfeName),
  reportError() {},
  recordWebVitals() {},
};

export type RecordedTelemetry =
  | { type: 'error'; error: unknown; context: ErrorContext }
  | { type: 'web-vital'; metric: WebVitalMetric };

/** A provider for tests: it sends nothing and remembers errors and web vitals in order. */
export function createRecordingProvider(): TelemetryProvider & { calls: RecordedTelemetry[] } {
  const calls: RecordedTelemetry[] = [];
  return {
    name: 'recording',
    calls,
    init() {},
    getTracer: (mfeName) => trace.getTracer(mfeName),
    reportError(error, context) {
      calls.push({ type: 'error', error, context });
    },
    recordWebVitals(metric) {
      calls.push({ type: 'web-vital', metric });
    },
  };
}
