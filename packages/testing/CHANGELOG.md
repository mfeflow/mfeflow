# @mfeflow/testing

## 0.7.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/runtime@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`8169ac3`](https://github.com/mfeflow/mfeflow/commit/8169ac3a6b14fcc1b3327011dcdab3407aaf0afc)]:
  - @mfeflow/runtime@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`3c5bb1c`](https://github.com/mfeflow/mfeflow/commit/3c5bb1c7c329dad7e68832a2acfde1171786bc43), [`791ea6d`](https://github.com/mfeflow/mfeflow/commit/791ea6d760f0cced6b74c5b5c30bed5afd18905f)]:
  - @mfeflow/runtime@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/runtime@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/runtime@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/runtime@0.2.0

## 0.1.0

### Minor Changes

- [#9](https://github.com/mfeflow/mfeflow/pull/9) [`c33204b`](https://github.com/mfeflow/mfeflow/commit/c33204b906d9c4e25e3b61f8259f35e15b46e409) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/tsconfig` (strict TypeScript 7 presets: base, react-app, react-library, node), `@mfeflow/oxlint-config` (shared type-aware oxlint config with React, hooks and jsx-a11y) and `@mfeflow/testing` (`renderWithPlatform`, `resetPlatform`).

### Patch Changes

- [#26](https://github.com/mfeflow/mfeflow/pull/26) [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The docs live at https://mfeflow.github.io/mfeflow/ (GitHub Pages) instead of the unregistered mfeflow.dev. Every package's `homepage`, the error links the CLI prints (`https://mfeflow.github.io/mfeflow/errors/E102`) and the `$schema` URLs now use it. `@mfeflow/contracts` exports `DOCS_URL`, `errorDocsUrl` and `JSON_SCHEMAS`, the JSON Schemas the docs site publishes under `/schema/`.

- [#22](https://github.com/mfeflow/mfeflow/pull/22) [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Every package now ships its README and the MIT LICENSE, with keywords, homepage and bugs in its metadata. `@mfeflow/oxlint-config` and `@mfeflow/tsconfig` declare `engines.node`. Test files and fixtures are no longer published. `@mfeflow/testing` imports `@mfeflow/runtime/providers` (new subpath) instead of the runtime root, so Module Federation is not loaded in test runs, and declares `react-dom` as a peer. `@mfeflow/i18n` lists `react` as a required peer, as its root entry needs it.

- [#11](https://github.com/mfeflow/mfeflow/pull/11) [`fcdc27e`](https://github.com/mfeflow/mfeflow/commit/fcdc27eb1e2d2f62f8563b11447a1210b0d46f9c) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Fixes found by the storefront example: React packages now build with the automatic JSX runtime (no `React is not defined`); every package's `exports` has a `default` condition so `require.resolve` finds it and Module Federation shares it; `@mfeflow/rsbuild` pins each shared package's `requiredVersion` to the installed version instead of a `catalog:` or `workspace:*` spec.
- Updated dependencies [[`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7), [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d), [`9c62f67`](https://github.com/mfeflow/mfeflow/commit/9c62f67437267d9dab49dbb952d1135adaac73ed), [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c), [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c), [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c), [`a817bea`](https://github.com/mfeflow/mfeflow/commit/a817beae06c36526ed796832766cd4075b33a8f8), [`e731384`](https://github.com/mfeflow/mfeflow/commit/e731384340a23266b07c2eb3045465d72f329de6), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`fcdc27e`](https://github.com/mfeflow/mfeflow/commit/fcdc27eb1e2d2f62f8563b11447a1210b0d46f9c)]:
  - @mfeflow/runtime@0.1.0
