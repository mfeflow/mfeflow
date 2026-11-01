---
'@mfeflow/url-factory': minor
'@mfeflow/route-factory': minor
'@mfeflow/http': minor
---

Share one `PathParams` type and one `fillPath` between url-factory and route-factory: a param name is letters, digits and underscores in both the type and the runtime, and the values `.` and `..` are refused. `@mfeflow/route-factory` now depends on `@mfeflow/url-factory`. `@mfeflow/http` times out the wait for headers only, wraps body failures in `HttpError`, adds the `auth` error kind for a failing `getToken`, and merges header names case-insensitively.
