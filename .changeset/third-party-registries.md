---
'mfeflow': minor
'@mfeflow/core': minor
'@mfeflow/contracts': minor
---

Third-party feature registries, end to end. `mfeflow registry add @ns <url-template>`, `registry list` and `registry remove @ns` manage `registries` in `mfeflow.json` (https only, with `{name}` and optional `{version}`; plain http is accepted for `127.0.0.1`, `localhost` and `[::1]` only, and a redirect can never step down to http or reach a loopback address from an https registry). `mfeflow features [search]` now also searches every configured registry's `index.json`, fetched in parallel, with a per-registry error that leaves the others listed; `--json` has `features[].source` and `registries`. `mfeflow registry build <dir>` checks each `feature.json` with the same third-party rules the loader applies, reports every failure at once, and writes `index.json`, `<name>.json`, `<name>/<version>.json` and `<name>/latest.json` for any static host. `@mfeflow/contracts` adds the feature registry index (types, validator, JSON Schema at `/schema/feature-registry-index.json`), `registryTemplateProblem` and `registryIndexUrl`, and `feature.json` accepts `keywords`. `@mfeflow/core` adds `fetchFeatureIndex` and `buildRegistry`. New errors `MFEFLOW_E403` (bad registry index) and `MFEFLOW_E404` (a feature cannot be published).
