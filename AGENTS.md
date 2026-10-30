# AGENTS.md

Guidance for coding agents working in this repo.

- Package manager: pnpm (via corepack). Never npm or yarn.
- Before finishing: `pnpm ci` must pass (format, lint, typecheck, test, build).
- Versions are pinned in the `catalog` in `pnpm-workspace.yaml`; add new
  dependencies there and reference them as `catalog:`.
- TypeScript stays on 6.x until typescript-eslint supports 7.
- Commits and PR titles follow Conventional Commits.
- Any change to a published package needs a changeset (`pnpm changeset`).
- Tests sit next to the code as `*.test.ts`; coverage must stay at or above 80%.
