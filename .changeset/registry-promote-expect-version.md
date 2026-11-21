---
'@mfeflow/registry': minor
---

`POST /v1/promote` accepts an optional `expectVersion`. If the source environment serves another version, the server answers 409 (`conflict`) and changes nothing, so a promote planned against one version cannot move another.
