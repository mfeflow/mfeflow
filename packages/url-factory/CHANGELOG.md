# @mfeflow/url-factory

## 0.1.0

### Minor Changes

- [#6](https://github.com/mfeflow/mfeflow/pull/6) [`646d33e`](https://github.com/mfeflow/mfeflow/commit/646d33e18443be71673108ec4c212f5189b2d632) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/url-factory`: `defineEndpoints` and `createUrlFactory` build absolute API URLs from path templates, with params checked at compile time and base URLs read from runtime config at call time.

### Patch Changes

- [#26](https://github.com/mfeflow/mfeflow/pull/26) [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The docs live at https://mfeflow.github.io/mfeflow/ (GitHub Pages) instead of the unregistered mfeflow.dev. Every package's `homepage`, the error links the CLI prints (`https://mfeflow.github.io/mfeflow/errors/E102`) and the `$schema` URLs now use it. `@mfeflow/contracts` exports `DOCS_URL`, `errorDocsUrl` and `JSON_SCHEMAS`, the JSON Schemas the docs site publishes under `/schema/`.

- [#22](https://github.com/mfeflow/mfeflow/pull/22) [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Every package now ships its README and the MIT LICENSE, with keywords, homepage and bugs in its metadata. `@mfeflow/oxlint-config` and `@mfeflow/tsconfig` declare `engines.node`. Test files and fixtures are no longer published. `@mfeflow/testing` imports `@mfeflow/runtime/providers` (new subpath) instead of the runtime root, so Module Federation is not loaded in test runs, and declares `react-dom` as a peer. `@mfeflow/i18n` lists `react` as a required peer, as its root entry needs it.

- [#11](https://github.com/mfeflow/mfeflow/pull/11) [`fcdc27e`](https://github.com/mfeflow/mfeflow/commit/fcdc27eb1e2d2f62f8563b11447a1210b0d46f9c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Fixes found by the storefront example: React packages now build with the automatic JSX runtime (no `React is not defined`); every package's `exports` has a `default` condition so `require.resolve` finds it and Module Federation shares it; `@mfeflow/rsbuild` pins each shared package's `requiredVersion` to the installed version instead of a `catalog:` or `workspace:*` spec.
