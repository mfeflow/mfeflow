---
'mfeflow': minor
'@mfeflow/core': minor
---

`mfeflow adopt` sets up mfeflow in a project that already uses Module Federation. Run it in the folder with your shell (or a workspace root) and it writes `mfeflow.json`, an `mfeflow.app.json` for each app, a dev, staging and prod registry entry for each remote, and adds `@mfeflow/runtime` to the shell's `package.json`. It reads your Rsbuild, Rspack or webpack config as text and never edits it. Instead it prints the one line to paste into your shared list.

`--dry-run` shows every file and diff first. In a terminal it asks before writing. Without a terminal you must pass `--yes`, or it exits with code 2 and writes nothing. Parts of the config it could not read, or that have no place in mfeflow's files, are printed under "not carried over" with the reason, and the command still exits 0. Owners and routes are left as placeholders for you to fill in.

New errors: E123 when the folder already has an `mfeflow.json`, and E124 when adopt finds no shell it can set up. Core gains `planAdoption`, which turns what `detectFederation` found into the files to write.
