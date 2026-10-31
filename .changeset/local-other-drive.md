---
'mfeflow': patch
'@mfeflow/contracts': patch
---

`--local` works when the mfeflow checkout sits on another Windows drive: with no relative path between them, `mfeflow.json` records the checkout as an absolute path with forward slashes.
