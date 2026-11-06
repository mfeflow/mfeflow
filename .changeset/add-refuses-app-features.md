---
'mfeflow': patch
---

`mfeflow add <feature>` in a repo with no apps (made by `init --kind tooling`) now refuses a feature that needs an app with `MFEFLOW_E216`, the same error and message `init --kind tooling --features` gives, and `ci-github` with E107. Before, `add` sent such a feature to the engine, which skipped the app parts without a word. Nothing is written when a feature is refused. The `platform` repo of a polyrepo takes `add` as before.
