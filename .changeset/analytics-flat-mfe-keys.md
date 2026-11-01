---
'@mfeflow/analytics': minor
---

The tracker stamps flat `mfe_name` and `mfe_version` keys (`mfe_version` is `null` when the remote has none) instead of a nested `mfe` object. The data layer merges nested objects, so one remote's version leaked onto the next remote's events. Update GTM variables from `mfe.name` to `mfe_name`.
