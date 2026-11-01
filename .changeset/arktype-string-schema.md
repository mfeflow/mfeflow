---
'@mfeflow/core': patch
---

A third-party `add-env-key` with a per-validator schema map can give the arktype entry as a plain string literal (`'string.url'`), re-emitted safely. The zod and valibot entries must still be calls.
