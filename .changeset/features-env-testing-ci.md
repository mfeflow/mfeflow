---
'mfeflow': minor
'@mfeflow/oxlint-config': patch
---

New features: `env-t3` (typed env with t3-env, runtime-config schema checked before deploy, default on), `testing` (Vitest, Testing Library, MSW and a Playwright smoke test, default on) and `ci-github` (pull request workflow with pinned actions, opt-in). `./env` is allowed as a side-effect import by the shared oxlint config.
