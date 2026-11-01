# @mfeflow/analytics

## 0.4.0

No changes in this release.

## 0.3.0

### Minor Changes

- [#32](https://github.com/mfeflow/mfeflow/pull/32) [`351ef12`](https://github.com/mfeflow/mfeflow/commit/351ef123ecd790872b7f1312c7fd06e37f35fdbe) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/analytics/providers` with `addProvider` and `combineProviders`, to run more than one provider (every call reaches all of them, a provider that throws does not stop the others, and the order they start in does not matter), and `@mfeflow/analytics/clarity`: a Microsoft Clarity provider that requests nothing, and sets no cookie, until `analytics_storage` is granted, and tells Clarity to stop if it is withdrawn.

## 0.2.0

No changes in this release.

## 0.1.0

### Minor Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - The tracker stamps flat `mfe_name` and `mfe_version` keys (`mfe_version` is `null` when the remote has none) instead of a nested `mfe` object. The data layer merges nested objects, so one remote's version leaked onto the next remote's events. Update GTM variables from `mfe.name` to `mfe_name`.

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/analytics`: a provider interface with a typed event map that remotes extend by declaration merging, `createTracker(mfeName)` that stamps `mfe.name`, idempotent `initAnalytics`, a dev-only event validator, a noop and a recording provider for tests, Consent Mode v2 state that is remembered between visits, and React bindings (`AnalyticsProvider`, `useTracker`, `useTrackOnMount`, `useConsent`). `@mfeflow/analytics/gtm` is the Google Tag Manager provider: consent defaults (all `denied`, with `wait_for_update`) are pushed to `dataLayer` before `gtm.js` is requested, and parameters that look like personal data are dropped.

### Patch Changes

- [#24](https://github.com/mfeflow/mfeflow/pull/24) [`bdb8cee`](https://github.com/mfeflow/mfeflow/commit/bdb8ceeafb5f711fce106fabfb9800eb829fded7) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - `page_view` carries the query string (personal data and secrets removed; `utm_*`, `gclid` and `fbclid` kept) in `page_path` and `page_location`, follows hash routers, and is deduplicated on path and query. The GTM provider reads `page_title` after the route has rendered instead of at the moment of navigation.
