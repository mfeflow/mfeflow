---
'@mfeflow/registry': minor
'@mfeflow/runtime': minor
---

Percentage rollouts on the registry server. A deploy can carry `rollout: { percent, steps }`: that share of clients (chosen by the `u` id on `GET /v1/index/:env`, always the same ones) gets the new version, and everyone else keeps stable. `POST /v1/rollout/step`, `/complete` and `/abort` move it along, under a new `rollout` token action, and every change is audited. `POST /v1/beacon` takes load and error counts from browsers, with strict validation and a per-address rate limit. A page sends one report with its browser id, and each browser counts once per rollout side, on the side it is assigned to, up to a cap per rollout. `GET /v1/rollout` shows each side's numbers and why the gate is waiting. After a minimum sample (200 candidate loads and 50 distinct browsers on each side by default) the server halts a candidate whose error rate is twice stable's and at least two points higher, and the audit entry gives the numbers. The static fallback index still holds stable only.

`@mfeflow/runtime` gets an optional beacon, off by default. With `registryBeacon: true` in the runtime config, `registrySourcesWithBeacon()` from `@mfeflow/runtime/beacon` adds a browser id to the server index URL and reports the page's loads and errors in one request when the page is hidden. A shell that does not import it is unchanged in size.
