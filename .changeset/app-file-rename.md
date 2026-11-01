---
'@mfeflow/core': minor
'@mfeflow/contracts': minor
'@mfeflow/registry': minor
'@mfeflow/route-factory': minor
'mfeflow': minor
---

Each app now keeps its owner, routes and budgets in `mfeflow.app.json`, next to the project's `mfeflow.json`. The old name `mfe.json` still works: mfeflow reads it and prints one notice per command asking you to rename it. If an app has both files, mfeflow stops with the new error E122, because it cannot tell which one you meant.

New projects, the templates and the storefront example use the new name. The schema is published at `/schema/mfeflow-app.json`, and the old `/schema/mfe.json` address keeps working, so existing `$schema` lines still resolve. `mfeflow upgrade` renames the file for you.
