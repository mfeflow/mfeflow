# @mfeflow/oxlint-config

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

### Minor Changes

- [#32](https://github.com/mfeflow/mfeflow/pull/32) [`351ef12`](https://github.com/mfeflow/mfeflow/commit/351ef123ecd790872b7f1312c7fd06e37f35fdbe) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Allow `import './src/theme/head-script'` as a side-effect import, which the `theming` feature adds to the shell's `rsbuild.config.ts`.

## 0.2.0

No changes in this release.

## 0.1.0

### Minor Changes

- [#9](https://github.com/mfeflow/mfeflow/pull/9) [`c33204b`](https://github.com/mfeflow/mfeflow/commit/c33204b906d9c4e25e3b61f8259f35e15b46e409) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/tsconfig` (strict TypeScript 7 presets: base, react-app, react-library, node), `@mfeflow/oxlint-config` (shared type-aware oxlint config with React, hooks and jsx-a11y) and `@mfeflow/testing` (`renderWithPlatform`, `resetPlatform`).

- [#16](https://github.com/mfeflow/mfeflow/pull/16) [`f919bfe`](https://github.com/mfeflow/mfeflow/commit/f919bfed1978d0c86bff562d79a7986ff2f27a1a) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - New lint error: relative imports of code (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`) must not carry a file extension (`import/extensions`). Asset imports (images, fonts, styles, JSON) keep theirs, package imports are not checked, and the rule is off under `bin/` and `scripts/`, which Node runs directly. This needs bundler module resolution (`@mfeflow/tsconfig` presets already use it). If a project runs other TypeScript files directly with Node (type stripping needs the extension), turn the rule off for them with an `overrides` entry.

### Patch Changes

- [#26](https://github.com/mfeflow/mfeflow/pull/26) [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The docs live at https://mfeflow.github.io/mfeflow/ (GitHub Pages) instead of the unregistered mfeflow.dev. Every package's `homepage`, the error links the CLI prints (`https://mfeflow.github.io/mfeflow/errors/E102`) and the `$schema` URLs now use it. `@mfeflow/contracts` exports `DOCS_URL`, `errorDocsUrl` and `JSON_SCHEMAS`, the JSON Schemas the docs site publishes under `/schema/`.

- [#21](https://github.com/mfeflow/mfeflow/pull/21) [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - New features: `env-t3` (typed env with t3-env, runtime-config schema checked before deploy, default on), `testing` (Vitest, Testing Library, MSW and a Playwright smoke test, default on) and `ci-github` (pull request workflow with pinned actions, opt-in). `./env` is allowed as a side-effect import by the shared oxlint config.

- [#22](https://github.com/mfeflow/mfeflow/pull/22) [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Every package now ships its README and the MIT LICENSE, with keywords, homepage and bugs in its metadata. `@mfeflow/oxlint-config` and `@mfeflow/tsconfig` declare `engines.node`. Test files and fixtures are no longer published. `@mfeflow/testing` imports `@mfeflow/runtime/providers` (new subpath) instead of the runtime root, so Module Federation is not loaded in test runs, and declares `react-dom` as a peer. `@mfeflow/i18n` lists `react` as a required peer, as its root entry needs it.
