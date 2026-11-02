# @mfeflow/event-bus

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

### Minor Changes

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Every copy of the bus also bridges over `window` events, deduplicated by message id, so a copy with its own registry and the main one hear each other and run their own validators; subscribing one function twice is two subscriptions; event names follow one pattern, `<domain>.<event>.v<major>`, also used by `mfe.json`.

- [#28](https://github.com/mfeflow/mfeflow/pull/28) [`8043f00`](https://github.com/mfeflow/mfeflow/commit/8043f00627e0ac0c6e665b745cf29f2cfe428c61) Thanks [@speedsharmaai](https://github.com/speedsharmaai)! - Add `@mfeflow/event-bus`: a typed event bus for micro-frontends on one page. Versioned event names (`cart.item-added.v1`), payload types merged from each contract with `interface EventMap`, an optional `validate` hook (`@mfeflow/event-bus/standard-schema` adapts a Zod, Valibot or ArkType schema), opt-in replay of the last payload for late subscribers, and a `useEvent` hook. A singleton.
