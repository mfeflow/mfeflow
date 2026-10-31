---
'mfeflow': patch
---

Commands the CLI runs (git and the package manager) no longer inherit `GIT_DIR`, `GIT_WORK_TREE` and the other variables that bind git to one repository. Run from a git hook in a worktree, `git init` in a new project used to turn the outer repository bare.
