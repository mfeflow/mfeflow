---
'mfeflow': patch
---

When `init` fails in a folder that already existed and was empty, everything it put there (generated files, `node_modules`, lockfile, `.git`) is removed and the empty folder is kept.
