---
'mfeflow': patch
---

`mfeflow add <@namespace/feature> --dry-run` previews a registry feature without `--yes`, since nothing is written. A real write without a terminal still needs `--yes`.
