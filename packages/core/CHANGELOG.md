# @mfeflow/core

## 0.7.0

### Minor Changes

- [#73](https://github.com/mfeflow/mfeflow/pull/73) [`e5aa337`](https://github.com/mfeflow/mfeflow/commit/e5aa3372e72ec44db15ea62320ccf5fdc765d2f5) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - New optional feature, `mfeflow add deploy-docker`. It writes a Dockerfile you can build for the shell or any remote (`--build-arg APP=<name>`), nginx configs with the cache and CORS rules, a start script that picks `runtime-config.$MFE_ENV.json` so one image runs in every environment, a Kubernetes example, a compose file and a `.dockerignore`. Both base images are pinned by digest and the image runs as a non-root user on a read-only filesystem. The files are yours to edit or delete; nothing in mfeflow builds or runs them. To write `compose.yaml`, feature templates can now read the list of apps as `it.apps`.

- [#71](https://github.com/mfeflow/mfeflow/pull/71) [`3533f50`](https://github.com/mfeflow/mfeflow/commit/3533f50aba4932f4d20b3320c1b502c03f170b72) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow add env-key` now records the keys it adds in `envKeys` in `mfeflow.json`. When a newer mfeflow ships another value for one of those keys, `mfeflow upgrade` stops and asks instead of only warning: `--accept` takes the new value and `--keep` keeps yours. Projects made before this keep the warning. The new field is optional, so existing `mfeflow.json` files stay valid.

### Patch Changes

- Updated dependencies [[`3533f50`](https://github.com/mfeflow/mfeflow/commit/3533f50aba4932f4d20b3320c1b502c03f170b72)]:
  - @mfeflow/contracts@0.7.0

## 0.6.0

### Minor Changes

- [#68](https://github.com/mfeflow/mfeflow/pull/68) [`0debd97`](https://github.com/mfeflow/mfeflow/commit/0debd9770ec669475f6160b828e0c6bc437aecba) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow adopt` sets up mfeflow in a project that already uses Module Federation. Run it in the folder with your shell (or a workspace root) and it writes `mfeflow.json`, an `mfeflow.app.json` for each app, a dev, staging and prod registry entry for each remote, and adds `@mfeflow/runtime` to the shell's `package.json`. It reads your Rsbuild, Rspack or webpack config as text and never edits it. Instead it prints the one line to paste into your shared list.
  
  `--dry-run` shows every file and diff first. In a terminal it asks before writing. Without a terminal you must pass `--yes`, or it exits with code 2 and writes nothing. Parts of the config it could not read, or that have no place in mfeflow's files, are printed under "not carried over" with the reason, and the command still exits 0. Owners and routes are left as placeholders for you to fill in.
  
  New errors: E123 when the folder already has an `mfeflow.json`, and E124 when adopt finds no shell it can set up. Core gains `planAdoption`, which turns what `detectFederation` found into the files to write.

- [#61](https://github.com/mfeflow/mfeflow/pull/61) [`ee86273`](https://github.com/mfeflow/mfeflow/commit/ee862733990cb039da832beb91e318274c6a5bae) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - New `detectFederation(dir)` works out the Module Federation setup of an existing project that was not made with mfeflow. It reads `rsbuild.config.*` with `pluginModuleFederation`, `module-federation.config.*` with `createModuleFederationConfig`, and rspack or webpack configs with `ModuleFederationPlugin`. For each app it finds (the folder itself, or each package in a pnpm or npm workspace) it returns the name, whether it is a shell or a remote, the build tool, the config file, its remotes, exposes, shared packages and dev port.
  
  Config files are parsed as source and never imported or run. Only values written out in the file count. Anything else, like a function call, an env variable or a spread of an imported object, is listed in `notAdopted` with the reason, so nothing is guessed. This is the first step of the upcoming `mfeflow adopt` command.

- [#62](https://github.com/mfeflow/mfeflow/pull/62) [`fedc8c5`](https://github.com/mfeflow/mfeflow/commit/fedc8c5f79a0b0e66d32728b18a561f995efa651) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Each app now keeps its owner, routes and budgets in `mfeflow.app.json`, next to the project's `mfeflow.json`. The old name `mfe.json` still works: mfeflow reads it and prints one notice per command asking you to rename it. If an app has both files, mfeflow stops with the new error E122, because it cannot tell which one you meant.
  
  New projects and the templates use the new name. The schema is published at `/schema/mfeflow-app.json`, and the old `/schema/mfe.json` address keeps working, so existing `$schema` lines still resolve. `mfeflow upgrade` renames the file for you.

- [#64](https://github.com/mfeflow/mfeflow/pull/64) [`ee68b81`](https://github.com/mfeflow/mfeflow/commit/ee68b81d8b6324df99c06654b2a29382b0b0e6a4) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow check-compat` can now check against a shell that lives in another repository. Pass `--against` a registry index, a deployed shell `mf-manifest.json`, or a file of either, and every remote in the repo is checked against the versions that shell shares. Before, a polyrepo project passed this check without anything being compared. Now it warns and tells you to pass `--against`. A source that cannot be read is the new error E307.

- [#56](https://github.com/mfeflow/mfeflow/pull/56) [`e7a9ede`](https://github.com/mfeflow/mfeflow/commit/e7a9edeacac7ad3f55edc9abca14519a4ce15665) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow upgrade` is here. It moves a project to the version of mfeflow you are running, so `pnpm dlx mfeflow@latest upgrade` is the whole command and nothing asks npm for a newer version. It prints what it replaced, created and edited, which files you changed, which you deleted, and which migrations ran. `--dry-run` shows every diff and writes nothing. A file you changed is never overwritten unless you pass `--accept <path|all>`; `--keep <path|all>` leaves your version and stops asking until the new version of that file changes again, which `mfeflow.json` now records in a new `kept` field. In a terminal it asks once before writing. Without one, a file you changed and did not decide on stops the run with the new error E604, before anything is written. Files are written all or nothing, with the install inside the same step, so a failed install puts every file back.
  
  Files that `add env-key` adds keys to (`env.ts`, the config schema, `.env.example`, the runtime-config files) are now replaced when every key in them is still in the new version. When you have keys of your own, the file is listed with those keys, and accepting it drops them. Exit code 8 is for upgrade problems and E604. Exit code 7 is now named deploy, and E601 to E603 exit with 8 instead of 1. `--json` gains an `upgrade` result.

- [#54](https://github.com/mfeflow/mfeflow/pull/54) [`938c7fb`](https://github.com/mfeflow/mfeflow/commit/938c7fb2ec537d18ef2263ff319268a5323956dd) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The engine behind `mfeflow upgrade` is in. `planUpgrade` rebuilds what the new version would generate for your project, using the features and options recorded in `mfeflow.json`, and compares it with what is on disk. A generated file you have not touched is replaced. A file you edited is left exactly as it is and comes back with a diff. New files are created. Files the new version no longer makes are listed, never deleted. `package.json`, `pnpm-workspace.yaml` and `turbo.json` only get small edits: `@mfeflow/*` ranges move to the new version, and new dependencies, scripts, catalog entries, `allowBuilds` rules and turbo tasks are added. Everything else in those files stays.
  
  Projects made before `mfeflow.json` recorded `cli` (0.1) are detected from the shell's `@mfeflow/runtime` range. First-party features can now ship a migration, a small script that runs when an upgrade crosses its version and adds its changes to the same plan, so dry runs and rollback cover it. The command itself comes next. This release adds the errors E601 (cannot tell which version made the project), E602 (project is newer than the target) and E603 (a migration failed).

### Patch Changes

- [#67](https://github.com/mfeflow/mfeflow/pull/67) [`642910b`](https://github.com/mfeflow/mfeflow/commit/642910bdb3ed5ecbed9829ffcac02196f2f485f5) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow upgrade` now refuses to write a file that sits under a symlinked folder, not only a file that is itself a symlink. `--accept-changed-content` can name the registry features to take (`--accept-changed-content @acme/hello`); on its own it still takes all of them, and the new hash is saved even when no file changes. A registry feature with no recorded hash is shown as first seen, in the plan and in `--json`. An env file you never edited takes the new template when only a value changed upstream, and the message says whether keys or values would be lost. Dependencies from a registry feature are marked as such in an upgrade plan.
- Updated dependencies [[`fedc8c5`](https://github.com/mfeflow/mfeflow/commit/fedc8c5f79a0b0e66d32728b18a561f995efa651), [`2fc1be2`](https://github.com/mfeflow/mfeflow/commit/2fc1be21fd211e04e5301d04deb218832b0fbab5), [`e7a9ede`](https://github.com/mfeflow/mfeflow/commit/e7a9edeacac7ad3f55edc9abca14519a4ce15665)]:
  - @mfeflow/contracts@0.6.0

## 0.5.0

### Minor Changes

- [#51](https://github.com/mfeflow/mfeflow/pull/51) [`fe74360`](https://github.com/mfeflow/mfeflow/commit/fe74360bdec93b458bc6211aeb5b1c7cf06a43e0) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - New commands `mfeflow deploy`, `promote`, `rollback` and `status` publish remotes to a static registry. `deploy` uploads a remote's build and points an environment at it, `promote` copies the pointer from one environment to another, `rollback` goes back to the previous version (or `--to`) without a rebuild, and `status` shows what each environment serves and any drift. Hosts are `file:<dir>` or `s3://<bucket>[/prefix]`, with S3 settings and credentials read from environment variables only. All four take `--json`, `--dry-run`, `--cwd` and `--yes`. Gate failures exit with 7 and the new `MFEFLOW_E501` to `E512` codes; exit code 7 is now the deploy range (it was reserved for upgrade), and the `EXIT.upgrade` key of the exported `EXIT` table is now `EXIT.deploy`; the number is unchanged.
  
  `mfeflow.json` gains `registry.host` and `registry.baseUrl`, validated and in the published JSON schema. `@mfeflow/core` lists the new error codes.

- [#53](https://github.com/mfeflow/mfeflow/pull/53) [`e2b7c0d`](https://github.com/mfeflow/mfeflow/commit/e2b7c0d0ce2de97936e0385e28d68ebf882eb67e) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `mfeflow.json` now records which version of the CLI last wrote it (`cli`) and, for projects split across repos, which kind of repo it is (`repo`: `platform`, `shell` or `remote`). Both are optional, so existing projects keep working; a project without `repo` is a platform monorepo. A remote repo may have no shell in its `apps`.
  
  `init`, `add` and `registry add` fill in `cli` when they save the file. The plan builder can now replace a file's content and move an existing dependency to a new range, following `catalog:` into `pnpm-workspace.yaml`. These are the building blocks for `mfeflow upgrade`.
  
  Features and the monorepo template that changed since 0.1.0 have a new version.

- [#52](https://github.com/mfeflow/mfeflow/pull/52) [`8c7570f`](https://github.com/mfeflow/mfeflow/commit/8c7570fdbeadac7b5a18f5fb6b1e8b8f0721ab83) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Third-party registries are now opt-in on your machine. `mfeflow features` no longer asks a registry that only appears in a cloned `mfeflow.json`; it says "not trusted yet" and tells you to run `mfeflow registry trust @namespace`. `registry add` trusts what it adds, `registry untrust` takes it back, and `MFEFLOW_TRUST_REGISTRIES=@a,@b` trusts namespaces for one CI run, for public addresses only; pin a template (`@a=https://…/{name}.json`) to allow a private one. The choice lives in `trusted-registries.json` in your user config folder, per namespace and exact URL template. Loopback and private addresses (localhost, 127/8, ::1, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, fc00::/7 and more) are only requested from a trusted registry, and a redirect from a public address can never lead there (`MFEFLOW_E405`). An explicit `mfeflow add @ns/name` on a public https registry still works without trust; `add remote` and `add shell`, which fetch installed registry features again, need it.
  
  `mfeflow add` records the sha256 of a registry feature's `feature.json` as `integrity` in `mfeflow.json`. When `add remote` or `add shell` fetch it again and the bytes differ, the command stops with `MFEFLOW_E406`; pass `--accept-changed-content` to take the new content on purpose. An index `version` that differs from the `feature.json` version is an error (`MFEFLOW_E402`).
  
  The add plan lists the packages a registry feature brings under NEW PACKAGES, with a note that npm and yarn run install scripts and pnpm 10+ blocks them. Tokens in registry URLs (token, key, sig, auth, password, secret, X-Amz-*) are shown as `***` in `registry add/list`, `features` and error messages.
  
  `@mfeflow/contracts` adds `isPrivateHost`, `redactUrl` and `redactUrlsIn`, and `integrity` on `mfeflow.json` features. `@mfeflow/core` adds the trust-file helpers, `checkIntegrity`, `integrityOf` and `indexedVersion`, and `fetchRemoteText`, `fetchFeatureIndex` and `getHttps` refuse private addresses unless told they are trusted.

### Patch Changes

- Updated dependencies [[`fe74360`](https://github.com/mfeflow/mfeflow/commit/fe74360bdec93b458bc6211aeb5b1c7cf06a43e0), [`3c5bb1c`](https://github.com/mfeflow/mfeflow/commit/3c5bb1c7c329dad7e68832a2acfde1171786bc43), [`e2b7c0d`](https://github.com/mfeflow/mfeflow/commit/e2b7c0d0ce2de97936e0385e28d68ebf882eb67e), [`8c7570f`](https://github.com/mfeflow/mfeflow/commit/8c7570fdbeadac7b5a18f5fb6b1e8b8f0721ab83), [`7c20bf9`](https://github.com/mfeflow/mfeflow/commit/7c20bf9be1ffceed50bf7dd4ca71ed4472b85215)]:
  - @mfeflow/contracts@0.5.0

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
