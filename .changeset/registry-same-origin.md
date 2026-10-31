---
'@mfeflow/runtime': minor
---

Breaking (0.x): `loadRegistryIndex` now throws for a registry URL on another origin than the page. Pass `{ allowCrossOrigin: true }` to keep fetching one, for example `loadRegistryIndex('https://registry.example.com/index.json', { allowCrossOrigin: true })`. The inlined `window.__MFE_REGISTRY__` is unaffected.
