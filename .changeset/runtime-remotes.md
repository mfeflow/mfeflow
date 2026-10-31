---
'@mfeflow/runtime': minor
---

Add remote loading to `@mfeflow/runtime`: `loadRegistryIndex` and `registerRemotesFromIndex` (validated index, origin allowlist), `RemoteBoundary` and `remoteComponent` (timeout, fallback, error boundary, reporting), `reportRemoteError` with a `mfeflow:remote-error` event, `checkSingletons` for the share scope, and a dependency-free `@mfeflow/runtime/plugins/report` Module Federation runtime plugin.
