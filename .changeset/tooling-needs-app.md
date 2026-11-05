---
'mfeflow': minor
'create-mfeflow': minor
'@mfeflow/core': minor
---

A feature that needs an app and is asked for in a tooling repo now fails with its own error, `MFEFLOW_E216` ("A feature needs an app, and this repo has none"), instead of the general E107. The message names the feature and the part that goes to an app, and says to use a repo with apps; the exit code is still 2. `ci-github` keeps E107, because its problem is the `ci.yml` the repo already has, not that it needs an app. The docs list the four features a repo with no apps takes.
