---
'mfeflow': minor
'create-mfeflow': minor
---

`mfeflow init --kind tooling --packages` can also make `analytics`, `telemetry`, `http`, `theme`, `url-factory` and `storage` in your scope. Each depends on our package of the same name, re-exports its API, and adds your defaults and one helper: `analytics` has consent denied until granted, a Tag Manager container id per environment and `createAnalytics(env)`; `telemetry` has the collector address per environment, a service name prefix and `telemetryOptions(env, service, version)`; `http` has base URLs per environment, one place for token handling and `createHttp(endpoints, env)`; `theme` has your light and dark tokens in one file and `createThemes()`. `http` also makes `url-factory` and `theme` also makes `storage`, and the output says so. The wrappers hold settings only, never state, because a package in your scope is not shared between the shell and the remotes by name.
