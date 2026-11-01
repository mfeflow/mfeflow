---
'@mfeflow/core': minor
'mfeflow': minor
'@mfeflow/contracts': minor
---

`mfeflow upgrade` is here. It moves a project to the version of mfeflow you are running, so `pnpm dlx mfeflow@latest upgrade` is the whole command and nothing asks npm for a newer version. It prints what it replaced, created and edited, which files you changed, which you deleted, and which migrations ran. `--dry-run` shows every diff and writes nothing. A file you changed is never overwritten unless you pass `--accept <path|all>`; `--keep <path|all>` leaves your version and stops asking until the new version of that file changes again, which `mfeflow.json` now records in a new `kept` field. In a terminal it asks once before writing. Without one, a file you changed and did not decide on stops the run with the new error E604, before anything is written. Files are written all or nothing, with the install inside the same step, so a failed install puts every file back.

Files that `add env-key` adds keys to (`env.ts`, the config schema, `.env.example`, the runtime-config files) are now replaced when every key in them is still in the new version. When you have keys of your own, the file is listed with those keys, and accepting it drops them. Exit code 8 is for upgrade problems and E604. Exit code 7 is now named deploy, and E601 to E603 exit with 8 instead of 1. `--json` gains an `upgrade` result.
