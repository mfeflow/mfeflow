# @mfeflow/route-factory

## 0.6.0

### Minor Changes

- [#62](https://github.com/mfeflow/mfeflow/pull/62) [`fedc8c5`](https://github.com/mfeflow/mfeflow/commit/fedc8c5f79a0b0e66d32728b18a561f995efa651) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Each app now keeps its owner, routes and budgets in `mfeflow.app.json`, next to the project's `mfeflow.json`. The old name `mfe.json` still works: mfeflow reads it and prints one notice per command asking you to rename it. If an app has both files, mfeflow stops with the new error E122, because it cannot tell which one you meant.
  
  New projects and the templates use the new name. The schema is published at `/schema/mfeflow-app.json`, and the old `/schema/mfe.json` address keeps working, so existing `$schema` lines still resolve. `mfeflow upgrade` renames the file for you.

### Patch Changes

- Updated dependencies []:
  - @mfeflow/url-factory@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/url-factory@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/url-factory@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @mfeflow/url-factory@0.3.0

## 0.2.0

### Minor Changes

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/route-factory`: `defineRoutes` per remote, `createLinks` for typed links between remotes (a missing param, a missing search param or an unknown route fails typecheck), `shellRoutes` for the shell's route table, and `createMfeLink` in `@mfeflow/route-factory/react` with no router dependency.

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Share one `PathParams` type and one `fillPath` between url-factory and route-factory: a param name is letters, digits and underscores in both the type and the runtime, and the values `.` and `..` are refused. `@mfeflow/route-factory` now depends on `@mfeflow/url-factory`. `@mfeflow/http` times out the wait for headers only, wraps body failures in `HttpError`, adds the `auth` error kind for a failing `getToken`, and merges header names case-insensitively.

### Patch Changes

- Updated dependencies [[`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61)]:
  - @mfeflow/url-factory@0.2.0
