---
'@mfeflow/telemetry': patch
---

The OpenTelemetry provider no longer exports query strings, fragments or `user:pass@` in `url.full` and `http.url`; pass `recordQuery: true` to keep the query. Reported error messages and stacks are capped at 4 KB each.
