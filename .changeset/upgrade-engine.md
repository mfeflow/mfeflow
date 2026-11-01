---
'@mfeflow/core': minor
'mfeflow': minor
---

The engine behind `mfeflow upgrade` is in. `planUpgrade` rebuilds what the new version would generate for your project, using the features and options recorded in `mfeflow.json`, and compares it with what is on disk. A generated file you have not touched is replaced. A file you edited is left exactly as it is and comes back with a diff. New files are created. Files the new version no longer makes are listed, never deleted. `package.json`, `pnpm-workspace.yaml` and `turbo.json` only get small edits: `@mfeflow/*` ranges move to the new version, and new dependencies, scripts, catalog entries, `allowBuilds` rules and turbo tasks are added. Everything else in those files stays.

Projects made before `mfeflow.json` recorded `cli` (0.1) are detected from the shell's `@mfeflow/runtime` range. First-party features can now ship a migration, a small script that runs when an upgrade crosses its version and adds its changes to the same plan, so dry runs and rollback cover it. The command itself comes next. This release adds the errors E601 (cannot tell which version made the project), E602 (project is newer than the target) and E603 (a migration failed).
