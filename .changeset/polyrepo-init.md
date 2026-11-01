---
'mfeflow': minor
'create-mfeflow': minor
'@mfeflow/contracts': minor
---

You can now give each team its own repo. `mfeflow init my-org --topology polyrepo --remotes catalog,cart` creates a folder with a platform repo, a shell repo and a repo for each remote. Each one is a separate git repo with its own `mfeflow.json`.

The platform repo holds two shared packages, published with Changesets, a reusable GitHub Actions workflow that every other repo calls, and a Renovate preset. The shell and the remotes install those packages from `link:` paths, so a first run needs no registry. The docs list the options for publishing them (npm, GitHub Packages, a private registry). mfeflow writes the repos on your machine and never calls GitHub; creating them there is your job.

`mfeflow add team-repo checkout`, run in the shell repo, adds one more remote repo next to the others and registers it in the shell. The shell finds its remotes in `devRemotes` in `public/config/runtime-config.dev.json`, so `mfeflow dev` in the shell repo works with remotes that run from other repos. `mfeflow validate` and `doctor` know which repo they are in, and a platform repo may have no shell in `mfeflow.json`.

The `core` template moved to 0.5.0 because the shell's `rsbuild.config.ts` reads its dev remotes from config in a polyrepo. A monorepo gets the same file as before. `ci-github` and `env-t3` cannot be used in a polyrepo yet. `hybrid` is still not available.
