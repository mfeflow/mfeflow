export {
  flushTelemetry,
  getTracer,
  initTelemetry,
  isTelemetryReady,
  recordWebVitals,
  reportError,
  resetTelemetryForTests,
  telemetryReady,
  type InitOptions,
  type ProviderSource,
} from './core';
export { connectRemoteErrors } from './errors';
export { createRecordingProvider, noopProvider, type RecordedTelemetry } from './noop';
export { MfeTracer } from './tracer';
export type {
  Attributes,
  ErrorContext,
  Span,
  SpanOptions,
  TelemetryProvider,
  Tracer,
  WebVitalMetric,
} from './types';
