---
'mfeflow': patch
---

`mfeflow init --kind tooling` refuses `--bundler` (and a `bundler` in a preset) with an E107 that says a tooling repo has no apps to bundle, instead of accepting it and ignoring it. `--kind remote --bundler vite` is tested and built end to end.
