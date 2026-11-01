---
'mfeflow': minor
---

Add the `event-bus`, `route-factory` and `http` features. `event-bus` creates the `packages/contracts` workspace package (`@<scope>/contracts`) and merges its events into the bus in every app; `route-factory` writes `src/routes.ts` per remote, with the paths in the contracts package when `event-bus` is installed; `http` writes `src/api/client.ts` and adds the `apiUrl` runtime key. The `url-factory` feature's `endpoints.ts` now reads `<service>Url` from the runtime config. Doctor reports `@mfeflow/event-bus` installed in two versions.
