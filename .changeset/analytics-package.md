---
'@mfeflow/analytics': minor
---

Add `@mfeflow/analytics`: a provider interface with a typed event map that remotes extend by declaration merging, `createTracker(mfeName)` that stamps `mfe.name`, idempotent `initAnalytics`, a dev-only event validator, a noop and a recording provider for tests, Consent Mode v2 state that is remembered between visits, and React bindings (`AnalyticsProvider`, `useTracker`, `useTrackOnMount`, `useConsent`). `@mfeflow/analytics/gtm` is the Google Tag Manager provider: consent defaults (all `denied`, with `wait_for_update`) are pushed to `dataLayer` before `gtm.js` is requested, and parameters that look like personal data are dropped.
