---
'mfeflow': patch
---

`mfeflow add` applies several features in catalogue order, as `init` does, so `mfeflow add analytics-gtm env-t3` no longer patches env-t3 files that do not exist yet.
