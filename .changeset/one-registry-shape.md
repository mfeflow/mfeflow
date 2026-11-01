---
'@mfeflow/contracts': minor
'@mfeflow/runtime': minor
'mfeflow': minor
---

The registry index has one shape now. `RegistryIndexRemote` and its browser-safe check live in `@mfeflow/contracts/entry`, and the shell runtime, the CLI's dev registry and the contracts validator all use them, so a new field is added once. Remote names follow the Module Federation global-name rule (hyphens and capitals are fine; every name `mfe.json` allows still works), and `exposes` is now a known field.

Route collisions are found by overlap instead of exact match: `/checkout/*` collides with `/checkout/pay` and `/checkout`, and `/p/:id` with `/p/42`. `routesOverlap(a, b)` is exported from `@mfeflow/contracts`, and `mfeflow doctor` and the registry validator name both remotes and both routes. The runtime now skips a remote whose `entry` is not an http(s) URL when it loads the index, instead of failing later at registration.
