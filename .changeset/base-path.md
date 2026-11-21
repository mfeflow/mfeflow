---
'@mfeflow/bundler-shared': minor
'@mfeflow/rsbuild': minor
'@mfeflow/vite': minor
'@mfeflow/runtime': minor
'@mfeflow/route-factory': minor
'mfeflow': minor
---

A shell can be served under a base path, such as `/demo/` for a GitHub Pages project site. `createShellConfig({ basePath: '/demo/' })`, or `MFEFLOW_BASE_PATH=/demo/` at build time, sets the asset prefix (Rsbuild) or `base` (Vite), and the shell looks for `config/runtime-config.json` and the registry index under the base. The default registry is `<base>registry/index.json`; `registryUrl` or `MFEFLOW_REGISTRY_URL` at build time points it elsewhere, such as `envs/prod/index.json`, the file `mfeflow deploy` writes (a value without a leading slash is under the base; `MFE_ENV` is not read). A base path may only use URL-safe characters, and the head script that carries it is escaped for inline use and removed when a reloaded config has no base. `@mfeflow/runtime` exports `basePath`, `withBase`, `stripBase`, `defaultRegistryUrl` and `runtimeConfigUrl`; `createLinks` uses the base by default; the generated shell router and nav use it. Without a base nothing changes.
