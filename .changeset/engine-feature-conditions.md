---
'@mfeflow/contracts': minor
'@mfeflow/core': minor
---

A feature part can be conditional on another feature (`"when": { "feature:env-t3": true }`). `add-env-key` takes a schema per validator (the one matching what the schema file imports is written), a list as the placeholder value, and creates `public/config/runtime-config.json` for the first runtime key in a project without env-t3.
