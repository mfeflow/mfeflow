---
'mfeflow': patch
'@mfeflow/rsbuild': patch
---

Projects from `mfeflow init` now run the browser singleton check, which the docs and README already promised. The shell loads `src/assert.ts` in development and on `?mfeflow-assert`, and reports a duplicated or missing React, runtime or other shared package in the console and the dev overlay. The list it checks comes from what the shell really shares: `createShellConfig` defines it as `__MFEFLOW_SINGLETONS__`.
