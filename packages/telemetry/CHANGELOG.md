# @mfeflow/telemetry

## 0.1.0

### Minor Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/telemetry`: a provider interface (`getTracer`, `reportError`, `recordWebVitals`), a tracer per remote that stamps `mfe.name`, a small queue for calls made before the provider is ready, and remote failures reported by `@mfeflow/runtime` forwarded through the `window` event channel. `@mfeflow/telemetry/otel` is the OpenTelemetry web provider (OTLP/HTTP batch export, `fetch` tracing with `propagateTraceHeaderCorsUrls`, Core Web Vitals, sampling ratio), meant to be loaded after first render with a dynamic `import()`.

### Patch Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The OpenTelemetry provider no longer exports query strings, fragments or `user:pass@` in `url.full` and `http.url`; pass `recordQuery: true` to keep the query. Reported error messages and stacks are capped at 4 KB each.
