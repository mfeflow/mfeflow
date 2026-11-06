---
'mfeflow': minor
'create-mfeflow': minor
'@mfeflow/core': minor
'@mfeflow/contracts': minor
'@mfeflow/rsbuild': minor
'@mfeflow/vite': minor
'@mfeflow/bundler-shared': minor
---

Vite as an alternative to Rsbuild. `mfeflow init --bundler vite` (or `"bundler": "vite"` in a preset) builds every app with Vite and `@module-federation/vite`, through the new `@mfeflow/vite` presets, which take the same options as `@mfeflow/rsbuild`. Both presets now build on `@mfeflow/bundler-shared`, so a Vite app shares the same singletons, manifest and runtime plugins; `@mfeflow/rsbuild`'s API is unchanged. `mfeflow.json` records the choice in an optional `bundler` field (absent means Rsbuild), and feature manifests can test it with a `project:bundler` condition. The theming, env-t3, tsconfig, storybook, deploy-docker and deploy-cloudflare features write the Vite variant of their files. `mfeflow upgrade --bundler vite` moves an existing project and removes the Rsbuild config, dependencies and scripts you did not change. `mfeflow adopt` reads Vite configs that use `@module-federation/vite`, the runtime-plugin check reads `vite.config.ts`, and `mfeflow budget` counts the modules a Vite shell preloads.
