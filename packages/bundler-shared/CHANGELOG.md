# @mfeflow/bundler-shared

## 0.10.0

### Minor Changes

- [#123](https://github.com/mfeflow/mfeflow/pull/123) [`d56b242`](https://github.com/mfeflow/mfeflow/commit/d56b242828281a73ff7d4a03fc8d92fb4903b51c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - A shell can be served under a base path, such as `/demo/` for a GitHub Pages project site. `createShellConfig({ basePath: '/demo/' })`, or `MFEFLOW_BASE_PATH=/demo/` at build time, sets the asset prefix (Rsbuild) or `base` (Vite), and the shell looks for `config/runtime-config.json` and the registry index under the base. The default registry is `<base>registry/index.json`; `registryUrl` or `MFEFLOW_REGISTRY_URL` at build time points it elsewhere, such as `envs/prod/index.json`, the file `mfeflow deploy` writes (a value without a leading slash is under the base; `MFE_ENV` is not read). A base path may only use URL-safe characters, and the head script that carries it is escaped for inline use and removed when a reloaded config has no base. `@mfeflow/runtime` exports `basePath`, `withBase`, `stripBase`, `defaultRegistryUrl` and `runtimeConfigUrl`; `createLinks` uses the base by default; the generated shell router and nav use it. Without a base nothing changes.

### Patch Changes

- [#117](https://github.com/mfeflow/mfeflow/pull/117) [`e3b708d`](https://github.com/mfeflow/mfeflow/commit/e3b708d9bd6157f0864a0ad1ffee26707ac8441e) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `@mfeflow/vite` re-exports `mergeConfig` and the `Plugin`, `PluginOption` and `UserConfig` types, and the generated shell `vite.config.ts` imports them from there. A config file then sees one Vite even when `@mfeflow/vite` is linked from a checkout (`--local`), where two copies made `tsc` stop with TS2321. Remotes no longer load the dts type-hints client in dev: the shell never consumes types in dev, so it only opened a websocket that failed on Windows and logged console errors. A remote that wants the hints back sets `typeHints: true`.

## 0.9.0

No changes in this release.

## 0.8.0

### Minor Changes

- [#76](https://github.com/mfeflow/mfeflow/pull/76) [`cc9b8d2`](https://github.com/mfeflow/mfeflow/commit/cc9b8d2ffb44c6f4ff28db3cc67fb8e876a97114) Thanks [@gioboa](https://github.com/gioboa)! - Vite as an alternative to Rsbuild. `mfeflow init --bundler vite` (or `"bundler": "vite"` in a preset) builds every app with Vite and `@module-federation/vite`, through the new `@mfeflow/vite` presets, which take the same options as `@mfeflow/rsbuild`. Both presets now build on `@mfeflow/bundler-shared`, so a Vite app shares the same singletons, manifest and runtime plugins; `@mfeflow/rsbuild`'s API is unchanged. `mfeflow.json` records the choice in an optional `bundler` field (absent means Rsbuild), and feature manifests can test it with a `project:bundler` condition. The theming, env-t3, tsconfig, storybook, deploy-docker and deploy-cloudflare features write the Vite variant of their files. `mfeflow upgrade --bundler vite` moves an existing project and removes the Rsbuild config, dependencies and scripts you did not change. `mfeflow adopt` reads Vite configs that use `@module-federation/vite`, the runtime-plugin check reads `vite.config.ts`, and `mfeflow budget` counts the modules a Vite shell preloads.
