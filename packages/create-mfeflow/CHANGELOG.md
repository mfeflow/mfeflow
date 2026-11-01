# create-mfeflow

## 0.3.0

### Patch Changes

- Updated dependencies [[`351ef12`](https://github.com/mfeflow/mfeflow/commit/351ef123ecd790872b7f1312c7fd06e37f35fdbe)]:
  - mfeflow@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61), [`a568277`](https://github.com/mfeflow/mfeflow/commit/a5682779728d0a372714f36d4f5050c1a4ecbb5b)]:
  - mfeflow@0.2.0

## 0.1.0

### Minor Changes

- [#19](https://github.com/mfeflow/mfeflow/pull/19) [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow init`, `add remote`, `add shell`, `add <feature>` and `features`, and `npm create mfeflow@latest`, which runs `init`.
  
  `init` writes a pnpm 12 workspace with Turborepo, a shell and remotes (default `catalog` and `cart`) as thin configs over `@mfeflow/rsbuild`, a registry per environment, and the first-party features `core`, `tsconfig`, `lint-oxlint`, `url-factory` and `git-hooks`. `pnpm dev` in the result starts the shell and every remote, with a dev registry pointing at their dev servers. Every command takes `--yes`, `--preset`, `--json` (schema-checked output), `--dry-run` (summary and diff, nothing written), `--cwd`, `--no-install` and `--verbose`; errors print `MFEFLOW_Exxx`, a fix and a docs link, with stable exit codes. `--local <checkout>` links `@mfeflow/*` from a built clone so a project can be generated and run before anything is on npm.
  
  `@mfeflow/core` exports `inOrder`, `hasErrno` and `messageOf`, gives templates `app.port`, lets a `PlanBuilder` rewrite dependency ranges (`rewriteRange`), and adds the error codes `E107` to `E110` and `E215`. `@mfeflow/contracts` accepts an optional `port` on each app in `mfeflow.json`.
  
  Migration: app and remote names (`MFE_NAME` in `@mfeflow/contracts`) are now lowercase words of letters and digits joined by single underscores, such as `order_history`. A name that ends in `_`, has `__`, or has `_` before a digit (`cart_`, `a__b`, `a_1`) is refused, because it would produce the same route component as another name; rename the app and its `mfe.json` and `registry` entry. `@mfeflow/core` also exports `readCappedText`, the size-capped body reader `fetchRemoteText` uses.
  
  Registry URL templates may contain `{version}`; `add shell` and `add remote` use it to fetch each installed registry feature at the version `mfeflow.json` recorded, refuse when the registry serves another one, and ask for the same confirmation as `add <feature>`.

### Patch Changes

- [#26](https://github.com/mfeflow/mfeflow/pull/26) [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The docs live at https://mfeflow.github.io/mfeflow/ (GitHub Pages) instead of the unregistered mfeflow.dev. Every package's `homepage`, the error links the CLI prints (`https://mfeflow.github.io/mfeflow/errors/E102`) and the `$schema` URLs now use it. `@mfeflow/contracts` exports `DOCS_URL`, `errorDocsUrl` and `JSON_SCHEMAS`, the JSON Schemas the docs site publishes under `/schema/`.

- [#22](https://github.com/mfeflow/mfeflow/pull/22) [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Every package now ships its README and the MIT LICENSE, with keywords, homepage and bugs in its metadata. `@mfeflow/oxlint-config` and `@mfeflow/tsconfig` declare `engines.node`. Test files and fixtures are no longer published. `@mfeflow/testing` imports `@mfeflow/runtime/providers` (new subpath) instead of the runtime root, so Module Federation is not loaded in test runs, and declares `react-dom` as a peer. `@mfeflow/i18n` lists `react` as a required peer, as its root entry needs it.
- Updated dependencies [[`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1), [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`b7b08a6`](https://github.com/mfeflow/mfeflow/commit/b7b08a65f341097ee3a4d7676ad5cc732fd333f1), [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1), [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`396866c`](https://github.com/mfeflow/mfeflow/commit/396866cdcfdb7a1c5932d7047b3173c8561dfafe), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`b7b08a6`](https://github.com/mfeflow/mfeflow/commit/b7b08a65f341097ee3a4d7676ad5cc732fd333f1)]:
  - mfeflow@0.1.0
