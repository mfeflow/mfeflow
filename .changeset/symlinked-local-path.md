---
'mfeflow': patch
---

`--local` records and follows the checkout by real path, so a project reached through a symlinked folder (the default macOS temp folder) no longer fails `doctor` with E110.
