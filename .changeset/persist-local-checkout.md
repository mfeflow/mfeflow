---
'mfeflow': patch
'@mfeflow/contracts': patch
---

`--local` is recorded in `mfeflow.json` as `local` (a path relative to the project), so `mfeflow add` keeps linking `@mfeflow/*` without the flag and one project never mixes `link:` and published versions. `--local none` clears it. Only the flag sets it; presets and registries cannot.
