# @mfeflow/rsbuild

## 0.5.0

### Patch Changes

- [#50](https://github.com/mfeflow/mfeflow/pull/50) [`7e9aac2`](https://github.com/mfeflow/mfeflow/commit/7e9aac2bf5acbf7003ab8aaf4887771c92856d71) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Projects from `mfeflow init` now run the browser singleton check, which the docs and README already promised. The shell runs `src/assert.ts` in development, and production pays nothing. It reports a duplicated or missing React, runtime or other shared package in the console and the dev overlay. The list it checks comes from what the shell really shares: `createShellConfig` defines it as `__MFEFLOW_SINGLETONS__`.

## 0.4.0

No changes in this release.

## 0.3.0

### Minor Changes

- [#32](https://github.com/mfeflow/mfeflow/pull/32) [`351ef12`](https://github.com/mfeflow/mfeflow/commit/351ef123ecd790872b7f1312c7fd06e37f35fdbe) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `registerHeadScript(name, source)`: `createShellConfig` puts each registered script first in the shell's `<head>`, ahead of the bundles. A name registered again replaces its script, so a dev-server config reload does not add a second one. The `theming` feature uses it for the stored-theme script.

## 0.2.0

### Minor Changes

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Share `@mfeflow/event-bus` and `@mfeflow/event-bus/react` as singletons.

## 0.1.0

### Minor Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `createShellConfig` defines `__MFEFLOW_APP_VERSION__` as the version in the shell's `package.json`. The generated telemetry init reads it instead of importing the whole `package.json` into the bundle.

- [#13](https://github.com/mfeflow/mfeflow/pull/13) [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Performance defaults from the Phase 01 spike. `@mfeflow/rsbuild` swaps the CommonJS Module Federation runtime for its ESM build (`esmRuntime`, on by default; the build fails if a `.cjs` has no ESM twin), strips remote-loading code from remotes (`consumesRemotes` opts out), targets the web, and makes the shell ship eager shared singletons with no async bootstrap boundary and no snapshot loader in production builds (`eager`, `snapshot` options). `@mfeflow/runtime` reads the registry from `window.__MFE_REGISTRY__` (replaces `globalThis.mfeflowRegistry`) and falls back to a same-origin fetch of `/registry/index.json`, registers `remoteEntry` URLs in place of manifests, adds the dependency-free `@mfeflow/runtime/plugins/entry-retry` plugin (used by the shell preset), reports a `?mfe-override` that production ignores, and adds `assertRequested()` so the singleton check runs only on request. `@mfeflow/contracts` registry entries and indexes carry `remoteEntry` and per-expose files; new `assetsFromManifest` reads them from `mf-manifest.json` at publish time, and `registryInjection` / `injectIntoHead` build the HTML an edge adds to the shell (inlined registry plus `<link rel="preload">` hints).
  
  A production shell has no manifest loader, so it cannot load a registry entry that has only a manifest URL. Nothing writes `remoteEntry` at publish yet, so this fails loudly instead of silently: the shell build defines `__MFEFLOW_SNAPSHOT__`, and `registerRemotesFromIndex` skips such a remote and reports it (`where: 'registry'`, message starting `MFE_NO_REMOTE_ENTRY`, with `mfe` set to the remote's name). Build the shell with `snapshot: true` to keep the loader until publishing writes `remoteEntry`. Registry entries also carry the entry `type` (for example `module` for ESM) and `entryGlobalName`, and `assetsFromManifest` reads both from the manifest and joins paths the way Module Federation does.
  
  The shell preset throws if `eager: false` is set but the entry has no `import()` boundary. Registry validators and the runtime accept only Module Federation entry types and a valid `entryGlobalName`; `registryInjection` inlines version, owner and routes, uses `modulepreload` for ESM remotes and preloads the manifest of a manifest-only remote only when the new `snapshot: true` option says the shell can load it (default false, like the production shell preset).

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `@mfeflow/analytics`, `@mfeflow/analytics/react` and `@mfeflow/telemetry` are shared singletons, and `mfeflow doctor` checks their versions across apps.

- [#8](https://github.com/mfeflow/mfeflow/pull/8) [`b2a76f1`](https://github.com/mfeflow/mfeflow/commit/b2a76f10c5d129d5828489adc51d637946104b89) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/rsbuild`: `createRemoteConfig` and `createShellConfig` for Module Federation 2.0 on Rsbuild, with the default singleton list (including `react-dom/client` and the `@mfeflow/*/react` subpaths), external runtime, manifests, generated types, types-only shell builds (`MFEFLOW_TYPES=1`, `typesOnBuild`) and the report runtime plugin.

- [#21](https://github.com/mfeflow/mfeflow/pull/21) [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The shell's dev and preview servers answer `/config/runtime-config.json` with `runtime-config.<MFE_ENV>.json` (default `dev`), and a project no longer ships a stale `runtime-config.json`. The generated Playwright smoke test fails on console errors, failed requests and a runtime config that did not load. `add env-key --app` names exactly one app and `--group` takes `root`, `shell` or `remotes`; feature targets accept `app:<name>`. Doctor reports an `env.ts` it cannot read (E118), counts only the env that changes the `build` hash for E121, and reads key optionality from the schema call. The `tsconfig` feature alone owns the root `tsconfig.json`. Core exports `RUNTIME_CONFIG_FILE` and `runtimeConfigFiles`.

### Patch Changes

- [#26](https://github.com/mfeflow/mfeflow/pull/26) [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The docs live at https://mfeflow.github.io/mfeflow/ (GitHub Pages) instead of the unregistered mfeflow.dev. Every package's `homepage`, the error links the CLI prints (`https://mfeflow.github.io/mfeflow/errors/E102`) and the `$schema` URLs now use it. `@mfeflow/contracts` exports `DOCS_URL`, `errorDocsUrl` and `JSON_SCHEMAS`, the JSON Schemas the docs site publishes under `/schema/`.

- [#22](https://github.com/mfeflow/mfeflow/pull/22) [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Every package now ships its README and the MIT LICENSE, with keywords, homepage and bugs in its metadata. `@mfeflow/oxlint-config` and `@mfeflow/tsconfig` declare `engines.node`. Test files and fixtures are no longer published. `@mfeflow/testing` imports `@mfeflow/runtime/providers` (new subpath) instead of the runtime root, so Module Federation is not loaded in test runs, and declares `react-dom` as a peer. `@mfeflow/i18n` lists `react` as a required peer, as its root entry needs it.

- [#13](https://github.com/mfeflow/mfeflow/pull/13) [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The `eager: false` async-boundary check reads the entry with `es-module-lexer` instead of a hand-written tokenizer. It accepts any dynamic `import()` of a relative module, including a template literal without expressions, and ignores `import()` in comments, strings and type positions.

- [#13](https://github.com/mfeflow/mfeflow/pull/13) [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The Module Federation ESM runtime swap takes the twin's path literally, so a path containing `$&` or `$1` no longer corrupts the module request.

- [#11](https://github.com/mfeflow/mfeflow/pull/11) [`fcdc27e`](https://github.com/mfeflow/mfeflow/commit/fcdc27eb1e2d2f62f8563b11447a1210b0d46f9c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Fixes found by the storefront example: React packages now build with the automatic JSX runtime (no `React is not defined`); every package's `exports` has a `default` condition so `require.resolve` finds it and Module Federation shares it; `@mfeflow/rsbuild` pins each shared package's `requiredVersion` to the installed version instead of a `catalog:` or `workspace:*` spec.
