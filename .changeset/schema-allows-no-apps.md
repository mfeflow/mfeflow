---
'@mfeflow/contracts': patch
'mfeflow': patch
---

The JSON Schema of `mfeflow.json` no longer asks for at least one app, so editors stop flagging the `apps: {}` of a repo made with `init --kind tooling`. `mfeflow validate` still checks that a project has a shell, except when `repo` is `remote` or `platform`, because that rule depends on `repo` and a schema cannot say it simply.
