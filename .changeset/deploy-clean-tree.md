---
'mfeflow': minor
---

`mfeflow deploy` no longer uploads `mf-stats.json`, the remote's `index.html` or the generated `@mf-types` to the host, and lists what it left out (`leftOut` in `--json`, and in the dry-run plan). New flags: `--no-local-entry` deploys without writing `registry/envs/<env>/<remote>.json`, so CI's working tree stays clean, and `--include-types` uploads `@mf-types` for teams that need it. The deploy guide now says how the version in the URL is picked.
