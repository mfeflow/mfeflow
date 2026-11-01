# AGENTS.md

Guidance for coding agents working in this repo.

- Package manager: pnpm (via corepack). Never npm or yarn. Versions live in the `catalog` of
  `pnpm-workspace.yaml`; add dependencies there and reference them as `catalog:`.
- `pnpm dev` runs the shell and every remote. `pnpm build` builds all of them. `pnpm mfeflow dev` does the same with
  per-app logs and picks up new remotes without a restart.
- Before finishing: `pnpm doctor` (and `pnpm validate`, `pnpm check-compat`, `pnpm budget` after a build) must exit 0.
- TypeScript 7, strict. Relative imports have no file extension (`./plan`, not `./plan.js`).
- Each remote is deployed on its own. A remote must not import from another remote or from
  the shell; talk through the registry, events or URLs.
- A remote's public surface is `src/exposed/`. Everything else is private to it.
- Add apps and features with the `mfeflow` CLI, installed as a root dev dependency (`pnpm mfeflow add remote <name>`, `pnpm mfeflow features`).
  `mfeflow.json` is the CLI's record of the project; do not edit the file hashes by hand.
- Shared singletons (react, react-dom, `@mfeflow/runtime`) are provided by the shell. Do not
  bundle your own copy.
