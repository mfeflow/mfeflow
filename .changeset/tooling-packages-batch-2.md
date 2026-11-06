---
'mfeflow': minor
'create-mfeflow': minor
---

`mfeflow init --kind tooling --packages` can also make `i18n`, `event-bus`, `route-factory`, `runtime` and `testing` in your scope, so every shared package except `contracts` and `tokens` (which a tooling repo already has) is a choice. `i18n` has your languages, the default language and the namespace list, with `startI18n()`; `event-bus` has your shared events declared in one file and `configureCompanyEvents()`; `route-factory` has your routes and `createCompanyLinks()`; `runtime` has the registry addresses per environment and `loadRegistry(env)`; `testing` has your providers and `renderWithCompany()`. `i18n` also makes `storage`, `route-factory` also makes `url-factory` and `testing` also makes `runtime`, and the output says so. `runtime` and `testing` are for micro-frontends and the output says that too. Each carries the peer dependencies of our package of the same name, so a missing `i18next` or `react` shows as a peer warning.
