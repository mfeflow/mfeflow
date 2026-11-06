---
'mfeflow': minor
'create-mfeflow': minor
'@mfeflow/contracts': minor
---

`mfeflow init --kind tooling` makes a repo with no apps: the platform template (`contracts` and `tokens` packages, reusable CI, Renovate preset, Changesets) as its own repo, with `repo: "platform"`, `topology: "monorepo"` and `apps: {}` in `mfeflow.json`. `--features` takes `lint-oxlint`, `git-hooks`, `commit-prompt` and `release`; anything with an app part, and `ci-github` (it would replace the repo's own `ci.yml`), is refused with E107 naming the feature. `--kind` is `app` by default, and `remote` answers "not available in this release". In a project with no apps, `dev`, `budget`, `validate`, `check-compat` and `upgrade` print one line and exit 0, and `doctor` adds that line above its report. The `platform/` repo of a polyrepo now gets the root-only features chosen at `init` (`lint-oxlint`, `git-hooks`, `commit-prompt`), and is unchanged otherwise. The `repo` field of `mfeflow.json` is described again: absent means an app repo, and a platform repo may have no apps at all.
