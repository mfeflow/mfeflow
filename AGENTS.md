# AGENTS.md

Guidance for coding agents working in this repo.

- Package manager: pnpm (via corepack). Never npm or yarn.
- Before finishing: `pnpm ci` must pass (format, build, lint, typecheck, test).
  Type-aware lint reads other workspace packages' `dist` types, so run
  `pnpm build` once after cloning or after changing a package's exports.
- Versions are pinned in the `catalog` in `pnpm-workspace.yaml`; add new
  dependencies there and reference them as `catalog:`.
- TypeScript 7 (native compiler). Linting is oxlint with type-aware rules
  (oxlint-tsgolint); there is no ESLint in this repo.
- Every dependency is on its latest stable version; Dependabot keeps it there.
- Commits and PR titles follow Conventional Commits.
- Any change to a published package needs a changeset (`pnpm changeset`).
- Tests sit next to the code as `*.test.ts`; coverage must stay at or above 80%.
- Relative imports have no file extension (`./plan`, not `./plan.js`); a folder's
  `index` is imported as the folder. oxlint (`import/extensions`) enforces it.
  Asset imports keep their extension. Exceptions: files Node runs directly
  (`bin/`, `scripts/`, the storefront e2e, `e2e/matrix/run.ts`, `e2e/matrix/registry.ts`, `e2e/matrix/ui-checks.ts`, `bench/time-to-running.ts`, `bench/rollback-visible.ts`).
