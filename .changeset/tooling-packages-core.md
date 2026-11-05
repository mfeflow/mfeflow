---
'mfeflow': minor
'create-mfeflow': minor
---

`mfeflow init --kind tooling --packages a,b` makes one package for each name in your scope, in `packages/<name>/` of the tooling repo (a multiselect asks when it runs interactively, and a preset can carry `packages`). This release has `tsconfig` and `oxlint-config`, and both are made when the flag is left out. `@<scope>/tsconfig` has `base`, `react-app`, `react-library` and `node` presets that extend `@mfeflow/tsconfig`. `@<scope>/oxlint-config` writes `dist/oxlintrc.json` from `@mfeflow/oxlint-config` and your `overrides.json` when you build, because oxlint does not resolve a package name in `extends`. An unknown name is `MFEFLOW_E107` and lists the valid ones; `--packages` without `--kind tooling` is E107. A package that needs another adds it and the command says so.
