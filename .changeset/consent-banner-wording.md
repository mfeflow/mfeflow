---
'mfeflow': patch
---

The consent banner `analytics-gtm` generates no longer grants the `ad_*` signals on a plain "Accept". It offers "Accept analytics" (`analytics_storage` only), "Accept analytics and advertising" and "Reject", and writes a unit test for them when `testing` is installed.
