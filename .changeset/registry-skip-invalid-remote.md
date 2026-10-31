---
'@mfeflow/runtime': patch
---

`loadRegistryIndex` no longer rejects the whole index for one invalid remote. It checks the index envelope, then skips and reports each invalid remote (`MFE_INVALID_REMOTE`, with the `mfe` name) and returns the valid ones. `isRegistryIndex` now checks the envelope only; use the new `isRegistryRemote` for one remote.
