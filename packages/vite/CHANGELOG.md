# @mfeflow/vite

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/bundler-shared@0.9.0

## 0.8.0

### Minor Changes

- [#76](https://github.com/mfeflow/mfeflow/pull/76) [`cc9b8d2`](https://github.com/mfeflow/mfeflow/commit/cc9b8d2ffb44c6f4ff28db3cc67fb8e876a97114) Thanks [@gioboa](https://github.com/gioboa)! - Vite as an alternative to Rsbuild. `mfeflow init --bundler vite` (or `"bundler": "vite"` in a preset) builds every app with Vite and `@module-federation/vite`, through the new `@mfeflow/vite` presets, which take the same options as `@mfeflow/rsbuild`. Both presets now build on `@mfeflow/bundler-shared`, so a Vite app shares the same singletons, manifest and runtime plugins; `@mfeflow/rsbuild`'s API is unchanged. `mfeflow.json` records the choice in an optional `bundler` field (absent means Rsbuild), and feature manifests can test it with a `project:bundler` condition. The theming, env-t3, tsconfig, storybook, deploy-docker and deploy-cloudflare features write the Vite variant of their files. `mfeflow upgrade --bundler vite` moves an existing project and removes the Rsbuild config, dependencies and scripts you did not change. `mfeflow adopt` reads Vite configs that use `@module-federation/vite`, the runtime-plugin check reads `vite.config.ts`, and `mfeflow budget` counts the modules a Vite shell preloads.

### Patch Changes

- Updated dependencies [[`cc9b8d2`](https://github.com/mfeflow/mfeflow/commit/cc9b8d2ffb44c6f4ff28db3cc67fb8e876a97114)]:
  - @mfeflow/bundler-shared@0.8.0
