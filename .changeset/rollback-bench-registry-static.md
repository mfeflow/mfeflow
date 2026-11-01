---
'mfeflow': minor
'@mfeflow/registry': minor
---

Two new features. `registry-static` adds `registry:deploy`, `registry:rollback` and `registry:status` scripts, a guide, and, when `ci-github` is present, a workflow that deploys every remote when `main` changes. Its `host` and `baseUrl` options are what `deploy`, `promote`, `rollback` and `status` use when `mfeflow.json` has no `registry` setting. `release` sets up Changesets so each remote gets its own version, and `deploy` publishes that version.

The registry README no longer says nothing is wired to a command.
