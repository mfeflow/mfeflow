---
'mfeflow': minor
'create-mfeflow': minor
'@mfeflow/contracts': minor
---

`mfeflow init --kind remote` makes one repo of one or more remotes with no shell, for a team that joins a platform whose shell is deployed from another repo. `mfeflow.json` has `repo: "remote"` and `topology: "monorepo"`, `apps` holds only remotes, and there is no `registry/` folder. `--remotes` needs at least one name (default `catalog`; `none` is E107). `--shell <url|file>` records where the deployed shell is, as a new optional `shell` field of `mfeflow.json` that follows the rules of `--against` (https, or http on localhost, or a file; no credentials or token in a URL); `doctor` and `check-compat` use it when `--against` is not given, so the "shell is not in this repo" warning goes away. `dev` runs the remotes and, with a recorded shell, prints how to see one in that shell and that overrides work only in a development build. `add remote` writes no route and no registry entry in such a repo, and `upgrade` does not bring a shell or registry folder back. Features write their remote parts and skip their shell parts. `pnpm create mfeflow` takes the same flags.
