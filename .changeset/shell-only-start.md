---
'mfeflow': minor
'create-mfeflow': minor
---

`mfeflow init --remotes none` (or `--remotes ""`, or `"remotes": []` in a preset) starts a project with only a shell, in a monorepo and in a polyrepo. Without the flag `init` still makes `catalog,cart`. At the prompt an empty answer means none, and `none` mixed with names is E107. The shell page now reads "No remotes yet. Add one with `mfeflow add remote <name>`." when the registry is empty, and `mfeflow dev` prints a line saying so before it starts the shell. Before this, `--remotes ""` was read as not given and `--remotes none` created a remote called `none`.
