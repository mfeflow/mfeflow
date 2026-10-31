---
'mfeflow': minor
---

`mfeflow dev` runs the shell and every remote with one command: a coloured, prefixed log per app, `--only a,b` for part of the project, and `--remote name=url` to use a server you run yourself (localhost only unless `--allow-origin` names the origin). It writes the dev registry the shell reads to `.mfeflow/dev-registry.json` and rewrites it when `mfeflow.json` or `registry/envs/dev` changes, so `mfeflow add remote` no longer needs a restart: the shell restarts itself and the new remote is started. Ctrl+C stops every app and its children (`taskkill /T` on Windows) and exits 130. The generated shell config reads `MFEFLOW_DEV_REGISTRY` when set and watches the registry; plain `pnpm dev` is unchanged.

`mfeflow doctor` checks that every app is on disk, `mfe.json` and the registry entries are valid, ports and routes are unique, the linked checkout is built, each singleton (react, react-dom, …) is one version across the apps, every workspace package has a version, remotes fit their shell, copied files match their hashes and runtime plugins import nothing shared. `--fix` writes missing registry entries and missing workspace versions. `mfeflow validate` and `mfeflow check-compat` run the schema and compatibility parts, and `mfeflow budget` measures the built shell and remotes against the cost-model budget. All four take `--json` (schema-checked) and exit non-zero on errors. The generated README and AGENTS.md document them.

Migration: none. `.mfeflow/` is added to the generated `.gitignore`.
