# @mfeflow/telemetry

## 0.5.0

### Minor Changes

- [#41](https://github.com/mfeflow/mfeflow/pull/41) [`791ea6d`](https://github.com/mfeflow/mfeflow/commit/791ea6d760f0cced6b74c5b5c30bed5afd18905f) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The shell can now fall back to a second registry. `loadRegistryIndex` takes one URL or an ordered list: the primary gets 1.5 s by default, and the last URL gets what is left of the budget. A 5xx, a network error, a timeout, a body that is not JSON or an invalid envelope moves on to the next URL, and the fallback is reported once as `MFE_REGISTRY_FALLBACK`. Every URL must be on the page's origin or in the new `allowedOrigins` option.
  
  The monorepo template reads `registryUrls` and `registryOrigins` from `runtime-config.json`, so a CDN-hosted registry and its remotes are no longer rejected in production. Without them it still loads `/registry/index.json` from the same origin.
  
  Error reports now carry the remote's `version`, so the console, the dev overlay and telemetry (`mfe.version`) say `cart@1.2.3`.
  
  The entry retry no longer replaces a load that another caller started right after a failed attempt.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.0

### Minor Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/telemetry`: a provider interface (`getTracer`, `reportError`, `recordWebVitals`), a tracer per remote that stamps `mfe.name`, a small queue for calls made before the provider is ready, and remote failures reported by `@mfeflow/runtime` forwarded through the `window` event channel. `@mfeflow/telemetry/otel` is the OpenTelemetry web provider (OTLP/HTTP batch export, `fetch` tracing with `propagateTraceHeaderCorsUrls`, Core Web Vitals, sampling ratio), meant to be loaded after first render with a dynamic `import()`.

### Patch Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The OpenTelemetry provider no longer exports query strings, fragments or `user:pass@` in `url.full` and `http.url`; pass `recordQuery: true` to keep the query. Reported error messages and stacks are capped at 4 KB each.
