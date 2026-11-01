---
'@mfeflow/event-bus': minor
---

Every copy of the bus also bridges over `window` events, deduplicated by message id, so a copy with its own registry and the main one hear each other and run their own validators; subscribing one function twice is two subscriptions; event names follow one pattern, `<domain>.<event>.v<major>`, also used by `mfe.json`.
