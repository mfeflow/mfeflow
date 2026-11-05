---
'mfeflow': minor
'create-mfeflow': minor
---

`mfeflow init --remotes none` (or `--remotes ""`, or `"remotes": []` in a preset) starts a project with only a shell, in a monorepo and in a polyrepo. Without the flag `init` still makes `catalog,cart`. At the prompt an empty answer means none, and `none` mixed with names is E107. `mfeflow dev` prints a line saying so before it starts the shell, and the route table of a shell-only project is written so that Prettier leaves it alone. Before this, `--remotes ""` was read as not given and `--remotes none` created a remote called `none`.
