---
'@mfeflow/rsbuild': minor
'mfeflow': patch
---

`createShellConfig` defines `__MFEFLOW_APP_VERSION__` as the version in the shell's `package.json`. The generated telemetry init reads it instead of importing the whole `package.json` into the bundle.
