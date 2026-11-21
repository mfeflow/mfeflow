---
'@mfeflow/bundler-shared': minor
'@mfeflow/rsbuild': minor
'@mfeflow/vite': minor
'@mfeflow/runtime': minor
'@mfeflow/route-factory': minor
'mfeflow': minor
---

A shell can be served under a base path, such as `/demo/` for a GitHub Pages project site. `createShellConfig({ basePath: '/demo/' })`, or `MFEFLOW_BASE_PATH=/demo/` at build time, sets the asset prefix (Rsbuild) or `base` (Vite), and the shell looks for `config/runtime-config.json` and the registry index under the base. With `MFE_ENV=prod` set at build time the default registry is `<base>envs/prod/index.json`, the file `mfeflow deploy` writes. `@mfeflow/runtime` exports `basePath`, `withBase`, `stripBase`, `defaultRegistryUrl` and `runtimeConfigUrl`; `createLinks` uses the base by default; the generated shell router and nav use it. Without a base nothing changes.
