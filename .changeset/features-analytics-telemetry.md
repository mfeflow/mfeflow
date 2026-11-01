---
'mfeflow': minor
---

Add the `analytics-gtm` and `telemetry-otel` features. `analytics-gtm` starts Google Tag Manager with Consent Mode v2 from the runtime config's `gtmId`, wraps the shell for page views and a consent banner, and gives each remote a typed `analytics.ts`. `telemetry-otel` loads the OpenTelemetry SDK after first render when the runtime config has an `otlpEndpoint`, reports remote failures, and gives each remote a `telemetry.ts` tracer tagged with its name. Both put their keys in the env-t3 runtime config when env-t3 is installed, whichever was added first, and in `public/config/runtime-config.json` otherwise.
