---
'mfeflow': minor
'create-mfeflow': minor
'@mfeflow/core': minor
'@mfeflow/contracts': minor
---

`mfeflow init`, `add remote`, `add shell`, `add <feature>` and `features`, and `npm create mfeflow@latest`, which runs `init`.

`init` writes a pnpm 12 workspace with Turborepo, a shell and remotes (default `catalog` and `cart`) as thin configs over `@mfeflow/rsbuild`, a registry per environment, and the first-party features `core`, `tsconfig`, `lint-oxlint`, `url-factory` and `git-hooks`. `pnpm dev` in the result starts the shell and every remote, with a dev registry pointing at their dev servers. Every command takes `--yes`, `--preset`, `--json` (schema-checked output), `--dry-run` (summary and diff, nothing written), `--cwd`, `--no-install` and `--verbose`; errors print `MFEFLOW_Exxx`, a fix and a docs link, with stable exit codes. `--local <checkout>` links `@mfeflow/*` from a built clone so a project can be generated and run before anything is on npm.

`@mfeflow/core` exports `inOrder`, `hasErrno` and `messageOf`, gives templates `app.port`, lets a `PlanBuilder` rewrite dependency ranges (`rewriteRange`), and adds the error codes `E107` to `E110` and `E215`. `@mfeflow/contracts` accepts an optional `port` on each app in `mfeflow.json`.
