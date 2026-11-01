---
'@mfeflow/runtime': minor
'@mfeflow/telemetry': minor
'mfeflow': minor
---

The shell can now fall back to a second registry. `loadRegistryIndex` takes one URL or an ordered list: the primary gets 1.5 s by default, and the last URL gets what is left of the budget. A 5xx, a network error, a timeout, a body that is not JSON or an invalid envelope moves on to the next URL, and the fallback is reported once as `MFE_REGISTRY_FALLBACK`. Every URL must be on the page's origin or in the new `allowedOrigins` option.

The monorepo template reads `registryUrls` and `registryOrigins` from `runtime-config.json`, so a CDN-hosted registry and its remotes are no longer rejected in production. Without them it still loads `/registry/index.json` from the same origin.

Error reports now carry the remote's `version`, so the console, the dev overlay and telemetry (`mfe.version`) say `cart@1.2.3`.

The entry retry no longer replaces a load that another caller started right after a failed attempt.
