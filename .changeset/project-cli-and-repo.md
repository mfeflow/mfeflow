---
'@mfeflow/contracts': minor
'@mfeflow/core': minor
'mfeflow': minor
---

`mfeflow.json` now records which version of the CLI last wrote it (`cli`) and, for projects split across repos, which kind of repo it is (`repo`: `platform`, `shell` or `remote`). Both are optional, so existing projects keep working; a project without `repo` is a platform monorepo. A remote repo may have no shell in its `apps`.

`init`, `add` and `registry add` fill in `cli` when they save the file. The plan builder can now replace a file's content and move an existing dependency to a new range, following `catalog:` into `pnpm-workspace.yaml`. These are the building blocks for `mfeflow upgrade`.

Features and the monorepo template that changed since 0.1.0 have a new version.
