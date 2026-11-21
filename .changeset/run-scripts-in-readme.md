---
'mfeflow': patch
---

The generated README and AGENTS.md now say `pnpm run doctor` (and the same for `validate`, `check-compat` and `budget`). `pnpm doctor` is pnpm's own command, so the project's script never ran. Monorepo template 0.6.2, remote-only template 0.1.1.
