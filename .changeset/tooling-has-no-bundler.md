---
'mfeflow': patch
---

`mfeflow init --kind tooling` refuses `--bundler` (any value, an empty one too) with an E107 that says a tooling repo has no apps to bundle, instead of accepting it and ignoring it. `mfeflow upgrade --bundler` in a tooling repo is refused the same way. A `bundler` that comes from a shared preset is not an error: it is ignored, and the summary says so (`preset bundler vite ignored: a tooling repo has no apps`). `--kind remote --bundler vite` is tested and built end to end.
