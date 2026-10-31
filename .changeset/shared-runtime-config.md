---
'@mfeflow/runtime': minor
'mfeflow': patch
---

Add `fetchRuntimeConfig()` to `@mfeflow/runtime`: one fetch of `/config/runtime-config.json` shared by every caller. The generated `analytics-gtm` and `telemetry-otel` inits and env-t3's `loadRuntimeConfig` use it, and the per-feature `runtime-config.ts` copies are gone.
