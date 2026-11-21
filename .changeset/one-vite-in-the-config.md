---
'@mfeflow/vite': patch
'@mfeflow/bundler-shared': patch
'mfeflow': patch
---

`@mfeflow/vite` re-exports `mergeConfig` and the `Plugin`, `PluginOption` and `UserConfig` types, and the generated shell `vite.config.ts` imports them from there. A config file then sees one Vite even when `@mfeflow/vite` is linked from a checkout (`--local`), where two copies made `tsc` stop with TS2321. Remotes no longer load the dts type-hints client in dev: the shell never consumes types in dev, so it only opened a websocket that failed on Windows and logged console errors. A remote that wants the hints back sets `typeHints: true`.
