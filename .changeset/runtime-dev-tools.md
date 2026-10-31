---
'@mfeflow/runtime': minor
---

Add `applyDevOverrides` (`?mfe-override=cart@http://localhost:4312/mf-manifest.json`, session-persisted, host allowlist), `DevOverlay` (Alt+Shift+M: registered remotes, versions, overrides, live errors), `registeredRemotes()`, and inline registry indexes: `loadRegistryIndex` uses `globalThis.mfeflowRegistry` when a server or edge inlined it.
