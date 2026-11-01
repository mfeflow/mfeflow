---
'mfeflow': patch
---

Generated projects now install the `mfeflow` CLI as a root dev dependency and get `doctor`, `validate`, `check-compat` and `budget` scripts, so every command in the generated README and AGENTS.md runs after `pnpm install` (before, `pnpm exec mfeflow doctor` failed with "Command mfeflow not found"). The docs and the CI workflow call the CLI as `pnpm mfeflow <command>`.
