# @mfeflow/core

## 0.4.0

### Minor Changes

- [#34](https://github.com/mfeflow/mfeflow/pull/34) [`8e84838`](https://github.com/mfeflow/mfeflow/commit/8e84838a66a726ed790e5cd4ced7c2ab42ce3033) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Third-party feature registries, end to end. `mfeflow registry add @ns <url-template>`, `registry list` and `registry remove @ns` manage `registries` in `mfeflow.json` (https only, with `{name}` and optional `{version}`; plain http is accepted for `127.0.0.1`, `localhost` and `[::1]` only, and a redirect can never step down to http or reach a loopback address from an https registry). `mfeflow features [search]` now also searches every configured registry's `index.json`, fetched in parallel, with a per-registry error that leaves the others listed; `--json` has `features[].source` and `registries`. `mfeflow registry build <dir>` checks each `feature.json` with the same third-party rules the loader applies, reports every failure at once, and writes `index.json`, `<name>.json`, `<name>/<version>.json` and `<name>/latest.json` for any static host. `@mfeflow/contracts` adds the feature registry index (types, validator, JSON Schema at `/schema/feature-registry-index.json`), `registryTemplateProblem` and `registryIndexUrl`, and `feature.json` accepts `keywords`. `@mfeflow/core` adds `fetchFeatureIndex` and `buildRegistry`. New errors `MFEFLOW_E403` (bad registry index) and `MFEFLOW_E404` (a feature cannot be published).
  
  Stricter for third-party authors: a third-party feature's script names must now start with the feature's own name (`segment:check` for `@acme/segment`), so `build`, `lint:*` and similar runners never pick them up. Registry templates are now checked when `mfeflow.json` loads, so a template with a placeholder in the host or no path before `{name}` is an E104; move the placeholder into the path. An index `version` must be a plain version like `1.2.0`, and E403 messages never carry control characters from the response.

### Patch Changes

- Updated dependencies [[`8e84838`](https://github.com/mfeflow/mfeflow/commit/8e84838a66a726ed790e5cd4ced7c2ab42ce3033)]:
  - @mfeflow/contracts@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/contracts@0.3.0

## 0.2.0

### Minor Changes

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Features that ship with mfeflow can name a dependency in the project's scope (`{{scope}}/contracts`), fill `{{app.name}}` into a file destination, and write a file relative to the project root with `atRoot`. Third-party features are refused all three (E203).

### Patch Changes

- Updated dependencies [[`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61)]:
  - @mfeflow/contracts@0.2.0

## 0.1.0

### Minor Changes

- [#19](https://github.com/mfeflow/mfeflow/pull/19) [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow init`, `add remote`, `add shell`, `add <feature>` and `features`, and `npm create mfeflow@latest`, which runs `init`.
  
  `init` writes a pnpm 12 workspace with Turborepo, a shell and remotes (default `catalog` and `cart`) as thin configs over `@mfeflow/rsbuild`, a registry per environment, and the first-party features `core`, `tsconfig`, `lint-oxlint`, `url-factory` and `git-hooks`. `pnpm dev` in the result starts the shell and every remote, with a dev registry pointing at their dev servers. Every command takes `--yes`, `--preset`, `--json` (schema-checked output), `--dry-run` (summary and diff, nothing written), `--cwd`, `--no-install` and `--verbose`; errors print `MFEFLOW_Exxx`, a fix and a docs link, with stable exit codes. `--local <checkout>` links `@mfeflow/*` from a built clone so a project can be generated and run before anything is on npm.
  
  `@mfeflow/core` exports `inOrder`, `hasErrno` and `messageOf`, gives templates `app.port`, lets a `PlanBuilder` rewrite dependency ranges (`rewriteRange`), and adds the error codes `E107` to `E110` and `E215`. `@mfeflow/contracts` accepts an optional `port` on each app in `mfeflow.json`.
  
  Migration: app and remote names (`MFE_NAME` in `@mfeflow/contracts`) are now lowercase words of letters and digits joined by single underscores, such as `order_history`. A name that ends in `_`, has `__`, or has `_` before a digit (`cart_`, `a__b`, `a_1`) is refused, because it would produce the same route component as another name; rename the app and its `mfe.json` and `registry` entry. `@mfeflow/core` also exports `readCappedText`, the size-capped body reader `fetchRemoteText` uses.
  
  Registry URL templates may contain `{version}`; `add shell` and `add remote` use it to fetch each installed registry feature at the version `mfeflow.json` recorded, refuse when the registry serves another one, and ask for the same confirmation as `add <feature>`.

- [#20](https://github.com/mfeflow/mfeflow/pull/20) [`b7b08a6`](https://github.com/mfeflow/mfeflow/commit/b7b08a65f341097ee3a4d7676ad5cc732fd333f1) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Error codes for `mfeflow doctor`, `budget` and `dev`: `E111` to `E117` (workspace package without a version, app missing on disk, invalid `mfe.json`, registry entry, shared port, route or name clash, copied file changed) and `E301` to `E306` (singleton versions, remote not compatible, runtime plugin imports a shared module, bundle over budget, no build output, dev server could not start). Each has a docs page.

- [#15](https://github.com/mfeflow/mfeflow/pull/15) [`900580a`](https://github.com/mfeflow/mfeflow/commit/900580a82f2a77d64597728090a1cbd4cbd1e943) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Harden the feature engine. Third-party features now pass allowlists instead of denylists: write locations (`src/`, `public/`, `docs/`), script names, dependency ranges (semver or dist-tag), module specifiers and `add-env-key` schema text, and cannot edit CI. Path checks fold case and Unicode, apply refuses targets that resolve outside the project through symlinks, rollback no longer writes through links and restores the lockfiles and `package.json` an install changed, `mfeflow.json` edits made after planning are an E211, and an existing script or dependency range is never overwritten. The transforms handle `#!` files, one-line bodies and closers on the last item's line, refuse `await` in a non-async function, and edit workflow YAML in place. Registry answers are size-capped on streamed bytes. Third-party changes are refused when any existing part of their path is a symlink, dependency ranges named like a tarball are rejected, and test-named files and folders are off limits to third-party writes.

- [#15](https://github.com/mfeflow/mfeflow/pull/15) [`900580a`](https://github.com/mfeflow/mfeflow/commit/900580a82f2a77d64597728090a1cbd4cbd1e943) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add the feature engine to `@mfeflow/core`: `mfeflow.json` load and save with copied-file hashes, plans as plain data with a summary and unified diff, atomic apply with rollback and an injectable install step, the seven built-in transform ops (`add-import`, `wrap-provider`, `add-shared`, `add-boot-step`, `add-env-key`, `add-route`, `add-workflow-step`), eta and `{{option}}` templates, the `MFEFLOW_Exxx` error catalogue, and a feature loader and resolver for local folders and namespaced registries. Features from a registry are declarative only.
  
  `@mfeflow/contracts` gains the `feature.json` types and validator and validates `files` and `registries` in `mfeflow.json`.

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - A feature part can be conditional on another feature (`"when": { "feature:env-t3": true }`). `add-env-key` takes a schema per validator (the one matching what the schema file imports is written), a list as the placeholder value, and creates `public/config/runtime-config.json` for the first runtime key in a project without env-t3.

- [#21](https://github.com/mfeflow/mfeflow/pull/21) [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `add-env-key` rejects schema text that does not parse, lists a `server` key under `globalEnv` in `turbo.json` (Turborepo hides unlisted variables and replays cached builds without running `env.ts`), and core exports `schemaKeys` and `dotenvKeys` for the doctor checks. New error codes E118 to E121.

- [#21](https://github.com/mfeflow/mfeflow/pull/21) [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - A feature's files, dependencies, scripts and transforms can carry `when: { option: value }`, so an option such as a validator library decides which parts apply.

- [#21](https://github.com/mfeflow/mfeflow/pull/21) [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The shell's dev and preview servers answer `/config/runtime-config.json` with `runtime-config.<MFE_ENV>.json` (default `dev`), and a project no longer ships a stale `runtime-config.json`. The generated Playwright smoke test fails on console errors, failed requests and a runtime config that did not load. `add env-key --app` names exactly one app and `--group` takes `root`, `shell` or `remotes`; feature targets accept `app:<name>`. Doctor reports an `env.ts` it cannot read (E118), counts only the env that changes the `build` hash for E121, and reads key optionality from the schema call. The `tsconfig` feature alone owns the root `tsconfig.json`. Core exports `RUNTIME_CONFIG_FILE` and `runtimeConfigFiles`.

### Patch Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - A third-party `add-env-key` with a per-validator schema map can give the arktype entry as a plain string literal (`'string.url'`), re-emitted safely. The zod and valibot entries must still be calls.

- [#26](https://github.com/mfeflow/mfeflow/pull/26) [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The docs live at https://mfeflow.github.io/mfeflow/ (GitHub Pages) instead of the unregistered mfeflow.dev. Every package's `homepage`, the error links the CLI prints (`https://mfeflow.github.io/mfeflow/errors/E102`) and the `$schema` URLs now use it. `@mfeflow/contracts` exports `DOCS_URL`, `errorDocsUrl` and `JSON_SCHEMAS`, the JSON Schemas the docs site publishes under `/schema/`.

- [#22](https://github.com/mfeflow/mfeflow/pull/22) [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Every package now ships its README and the MIT LICENSE, with keywords, homepage and bugs in its metadata. `@mfeflow/oxlint-config` and `@mfeflow/tsconfig` declare `engines.node`. Test files and fixtures are no longer published. `@mfeflow/testing` imports `@mfeflow/runtime/providers` (new subpath) instead of the runtime root, so Module Federation is not loaded in test runs, and declares `react-dom` as a peer. `@mfeflow/i18n` lists `react` as a required peer, as its root entry needs it.

- [#19](https://github.com/mfeflow/mfeflow/pull/19) [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Registry feature downloads follow redirects by hand like presets do, and refuse any redirect that leaves https before requesting it. `@mfeflow/core` exports `getHttps`, the walk both use.
- Updated dependencies [[`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`b7b08a6`](https://github.com/mfeflow/mfeflow/commit/b7b08a65f341097ee3a4d7676ad5cc732fd333f1), [`b7b08a6`](https://github.com/mfeflow/mfeflow/commit/b7b08a65f341097ee3a4d7676ad5cc732fd333f1), [`d6bceec`](https://github.com/mfeflow/mfeflow/commit/d6bceece680c4e0ae21dfcfe1b3c61698b9ee75c), [`900580a`](https://github.com/mfeflow/mfeflow/commit/900580a82f2a77d64597728090a1cbd4cbd1e943), [`260562d`](https://github.com/mfeflow/mfeflow/commit/260562d20b5fd978c687592837bc012ba8d7cae7), [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7), [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1), [`965be7e`](https://github.com/mfeflow/mfeflow/commit/965be7e6b97de4f6920f568c1fb525ea538a782d), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c), [`c4a5a2b`](https://github.com/mfeflow/mfeflow/commit/c4a5a2bceba5c22413923dafc956abc00432438c), [`3fb82a3`](https://github.com/mfeflow/mfeflow/commit/3fb82a3ae0c2fb6d3ecb610a252ad8a659066458), [`aaf6524`](https://github.com/mfeflow/mfeflow/commit/aaf65244bf7f025d56f262d534208c3f4786a1f1), [`fcdc27e`](https://github.com/mfeflow/mfeflow/commit/fcdc27eb1e2d2f62f8563b11447a1210b0d46f9c)]:
  - @mfeflow/contracts@0.1.0
