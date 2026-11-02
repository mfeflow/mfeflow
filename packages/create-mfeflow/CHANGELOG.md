# create-mfeflow

## 0.7.0

### Patch Changes

- Updated dependencies [[`11b32ad`](https://github.com/mfeflow/mfeflow/commit/11b32adb1a1628b2658cf528dc951dcaefadff07), [`e5aa337`](https://github.com/mfeflow/mfeflow/commit/e5aa3372e72ec44db15ea62320ccf5fdc765d2f5), [`3533f50`](https://github.com/mfeflow/mfeflow/commit/3533f50aba4932f4d20b3320c1b502c03f170b72), [`3533f50`](https://github.com/mfeflow/mfeflow/commit/3533f50aba4932f4d20b3320c1b502c03f170b72), [`3533f50`](https://github.com/mfeflow/mfeflow/commit/3533f50aba4932f4d20b3320c1b502c03f170b72)]:
  - mfeflow@0.7.0

## 0.6.0

### Minor Changes

- [#65](https://github.com/mfeflow/mfeflow/pull/65) [`2fc1be2`](https://github.com/mfeflow/mfeflow/commit/2fc1be21fd211e04e5301d04deb218832b0fbab5) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - You can now give each team its own repo. `mfeflow init my-org --topology polyrepo --remotes catalog,cart` creates a folder with a platform repo, a shell repo and a repo for each remote. Each one is a separate git repo with its own `mfeflow.json`.
  
  The platform repo holds two shared packages, published with Changesets, a reusable GitHub Actions workflow that every other repo calls, and a Renovate preset. The shell and the remotes install those packages from `link:` paths, so a first run needs no registry. The docs list the options for publishing them (npm, GitHub Packages, a private registry). mfeflow writes the repos on your machine and never calls GitHub; creating them there is your job.
  
  `mfeflow add team-repo checkout`, run in the shell repo, adds one more remote repo next to the others and registers it in the shell. The shell finds its remotes in `devRemotes` in `public/config/runtime-config.dev.json`, so `mfeflow dev` in the shell repo works with remotes that run from other repos. `mfeflow validate` and `doctor` know which repo they are in, and a platform repo may have no shell in `mfeflow.json`.
  
  `--org` sets the GitHub owner the generated CI and Renovate files point at; it defaults to the scope without the `@`. If `git init` cannot run in a repo, `init` warns and names it instead of failing.
  
  The `core` template moved to 0.5.0 because the shell's `rsbuild.config.ts` reads its dev remotes from config in a polyrepo. A monorepo gets the same file as before. `ci-github` and `env-t3` cannot be used in a polyrepo yet. `hybrid` is still not available.

### Patch Changes

- Updated dependencies [[`0debd97`](https://github.com/mfeflow/mfeflow/commit/0debd9770ec669475f6160b828e0c6bc437aecba), [`fedc8c5`](https://github.com/mfeflow/mfeflow/commit/fedc8c5f79a0b0e66d32728b18a561f995efa651), [`ee68b81`](https://github.com/mfeflow/mfeflow/commit/ee68b81d8b6324df99c06654b2a29382b0b0e6a4), [`2fc1be2`](https://github.com/mfeflow/mfeflow/commit/2fc1be21fd211e04e5301d04deb218832b0fbab5), [`dd290f1`](https://github.com/mfeflow/mfeflow/commit/dd290f11ebef6dc53bac930954cecab59ec148bf), [`315720e`](https://github.com/mfeflow/mfeflow/commit/315720e8c7688c64ac3d541cb9f6cf9df9fc801c), [`e7a9ede`](https://github.com/mfeflow/mfeflow/commit/e7a9edeacac7ad3f55edc9abca14519a4ce15665), [`938c7fb`](https://github.com/mfeflow/mfeflow/commit/938c7fb2ec537d18ef2263ff319268a5323956dd), [`642910b`](https://github.com/mfeflow/mfeflow/commit/642910bdb3ed5ecbed9829ffcac02196f2f485f5)]:
  - mfeflow@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`fe74360`](https://github.com/mfeflow/mfeflow/commit/fe74360bdec93b458bc6211aeb5b1c7cf06a43e0), [`3c5bb1c`](https://github.com/mfeflow/mfeflow/commit/3c5bb1c7c329dad7e68832a2acfde1171786bc43), [`e2b7c0d`](https://github.com/mfeflow/mfeflow/commit/e2b7c0d0ce2de97936e0385e28d68ebf882eb67e), [`791ea6d`](https://github.com/mfeflow/mfeflow/commit/791ea6d760f0cced6b74c5b5c30bed5afd18905f), [`8c7570f`](https://github.com/mfeflow/mfeflow/commit/8c7570fdbeadac7b5a18f5fb6b1e8b8f0721ab83), [`7c20bf9`](https://github.com/mfeflow/mfeflow/commit/7c20bf9be1ffceed50bf7dd4ca71ed4472b85215), [`7e9aac2`](https://github.com/mfeflow/mfeflow/commit/7e9aac2bf5acbf7003ab8aaf4887771c92856d71)]:
  - mfeflow@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`8e84838`](https://github.com/mfeflow/mfeflow/commit/8e84838a66a726ed790e5cd4ced7c2ab42ce3033)]:
  - mfeflow@0.4.0

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
