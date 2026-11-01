---
'@mfeflow/analytics': minor
---

Add `@mfeflow/analytics/providers` with `addProvider` and `combineProviders`, to run more than one provider (every call reaches all of them, a provider that throws does not stop the others, and the order they start in does not matter), and `@mfeflow/analytics/clarity`: a Microsoft Clarity provider that requests nothing, and sets no cookie, until `analytics_storage` is granted, and tells Clarity to stop if it is withdrawn.
