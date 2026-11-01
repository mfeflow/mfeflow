# @mfeflow/route-factory

## 0.2.0

### Minor Changes

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/route-factory`: `defineRoutes` per remote, `createLinks` for typed links between remotes (a missing param, a missing search param or an unknown route fails typecheck), `shellRoutes` for the shell's route table, and `createMfeLink` in `@mfeflow/route-factory/react` with no router dependency.

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Share one `PathParams` type and one `fillPath` between url-factory and route-factory: a param name is letters, digits and underscores in both the type and the runtime, and the values `.` and `..` are refused. `@mfeflow/route-factory` now depends on `@mfeflow/url-factory`. `@mfeflow/http` times out the wait for headers only, wraps body failures in `HttpError`, adds the `auth` error kind for a failing `getToken`, and merges header names case-insensitively.

### Patch Changes

- Updated dependencies [[`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61)]:
  - @mfeflow/url-factory@0.2.0
