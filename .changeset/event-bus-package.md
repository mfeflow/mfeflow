---
'@mfeflow/event-bus': minor
---

Add `@mfeflow/event-bus`: a typed event bus for micro-frontends on one page. Versioned event names (`cart.item-added.v1`), payload types merged from each contract with `interface EventMap`, an optional `validate` hook (`@mfeflow/event-bus/standard-schema` adapts a Zod, Valibot or ArkType schema), opt-in replay of the last payload for late subscribers, and a `useEvent` hook. A singleton.
