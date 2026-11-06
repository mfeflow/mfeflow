---
'@mfeflow/registry': patch
---

The static registry no longer fails a deploy on Windows when it tries to take the index lock while the last writer is still deleting it. It waits as it does for a held lock.
