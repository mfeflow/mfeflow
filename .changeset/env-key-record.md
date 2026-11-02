---
'mfeflow': minor
'@mfeflow/core': minor
'@mfeflow/contracts': minor
---

`mfeflow add env-key` now records the keys it adds in `envKeys` in `mfeflow.json`. When a newer mfeflow ships another value for one of those keys, `mfeflow upgrade` stops and asks instead of only warning: `--accept` takes the new value and `--keep` keeps yours. Projects made before this keep the warning. The new field is optional, so existing `mfeflow.json` files stay valid.
