---
'@mfeflow/telemetry': minor
---

Add `@mfeflow/telemetry`: a provider interface (`getTracer`, `reportError`, `recordWebVitals`), a tracer per remote that stamps `mfe.name`, a small queue for calls made before the provider is ready, and remote failures reported by `@mfeflow/runtime` forwarded through the `window` event channel. `@mfeflow/telemetry/otel` is the OpenTelemetry web provider (OTLP/HTTP batch export, `fetch` tracing with `propagateTraceHeaderCorsUrls`, Core Web Vitals, sampling ratio), meant to be loaded after first render with a dynamic `import()`.
