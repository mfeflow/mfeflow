---
'mfeflow': patch
---

The generated telemetry init catches a failure while starting, so it logs a warning instead of an unhandled rejection. The storefront example starts analytics and telemetry independently: a bad `gtmId` no longer skips telemetry.
