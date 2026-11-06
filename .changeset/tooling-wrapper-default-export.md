---
'mfeflow': patch
'create-mfeflow': patch
---

The packages `init --kind tooling --packages` makes now export a `default` condition next to `import`, as our own packages do. Without it the preset could not resolve a wrapper such as `@acme/theme` and refused it in its `shared` option ("cannot be resolved"). The READMEs of `analytics`, `telemetry`, `theme`, `i18n` and `runtime` now say that a micro-frontend app must also list our package of the same name, because the preset shares `@mfeflow/theme` and the others only when the app can resolve them from its own folder.
