---
'@mfeflow/rsbuild': minor
'@mfeflow/core': minor
'@mfeflow/contracts': minor
'mfeflow': minor
---

The shell's dev and preview servers answer `/config/runtime-config.json` with `runtime-config.<MFE_ENV>.json` (default `dev`), and a project no longer ships a stale `runtime-config.json`. The generated Playwright smoke test fails on console errors, failed requests and a runtime config that did not load. `add env-key --app` names exactly one app and `--group` takes `root`, `shell` or `remotes`; feature targets accept `app:<name>`. Doctor reports an `env.ts` it cannot read (E118), counts only the env that changes the `build` hash for E121, and reads key optionality from the schema call. The `tsconfig` feature alone owns the root `tsconfig.json`. Core exports `RUNTIME_CONFIG_FILE` and `runtimeConfigFiles`.
