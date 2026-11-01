---
title: event-bus - Typed events between remotes
description: Let remotes talk to each other through typed, versioned events defined in a shared contracts package, without importing each other's code.
---

# event-bus

This feature lets one remote tell another that something happened without either importing the other. They publish and listen to named events, and a shared contracts package holds the payload types. A wrong name or payload fails your typecheck.

## What you get

A typed publish and subscribe bus, a `packages/contracts` workspace package where event types live, and a sample event so you can see it working. Remotes never import each other (decision 0009), so the contracts package is the one thing they share. It is off by default.

## Add it

```sh
pnpm mfeflow add event-bus
```

What changed:

```text
packages/contracts/
├── package.json         # the @<scope>/contracts package
├── README.md
└── src/events/index.ts  # where event types live
apps/shell/src/
├── events.ts            # event setup for the shell
└── bootstrap.tsx        # gains a boot step that configures shell events
apps/<remote>/src/
├── events.ts            # event setup for each remote
└── Announce.tsx         # wrapped around the remote's exposed App
```

Every app gets the event bus package and your contracts package as dependencies. A unit test sits next to each `events.ts` if you have the `testing` feature.

Adding it to an existing project works the same way. A remote you add later gets its own `events.ts` and the dependency.

## Use it

### Define an event

Events are declared as types in the contracts package. This is the generated file:

```ts title="packages/contracts/src/events/index.ts"
export interface Events {
  /** A remote is on the page. The sample event: every remote announces itself, every other one can listen. */
  'mfe.ready.v1': { mfe: string };
}
```

Add a line for yours:

```ts title="packages/contracts/src/events/index.ts"
export interface Events {
  'mfe.ready.v1': { mfe: string };
  'cart.item-added.v1': { sku: string; qty: number };
}
```

The file holds types only and imports nothing, so reading it costs a remote nothing at run time.

### Publish from one remote, listen in another

```ts title="apps/catalog"
import { publish } from '@mfeflow/event-bus';

publish('cart.item-added.v1', { sku: 'A1', qty: 1 });
```

```tsx title="apps/cart"
import { useEvent } from '@mfeflow/event-bus/react';

useEvent('cart.item-added.v1', ({ sku, qty }) => addLine(sku, qty));
```

Outside React, use `subscribe(name, handler)`, which returns the function that stops listening. A wrong name, a wrong payload or a missing payload fails `pnpm typecheck`.

### Give late subscribers the latest value

Most events are things that happened, and a remote that mounts late missed them. Some are state instead, like the signed-in user. Mark those, and each new subscriber gets the last payload immediately. The generated shell file already does this for the sample event:

```ts title="apps/shell/src/events.ts"
export function configureShellEvents(): void {
  configureEvent('mfe.ready.v1', { replay: true });
}
```

Do it once, in the shell. Under React StrictMode a replayed event reaches a handler once per mount, so keep that handler safe to run twice. Live events are delivered once.

### Check payloads at run time

TypeScript checks the code you wrote, but it cannot check a payload from a remote built last week. Give the event a `validate` function. Nothing validates in the core bundle unless you do:

```ts
import { configureEvent } from '@mfeflow/event-bus';
import { fromStandardSchema } from '@mfeflow/event-bus/standard-schema';
import { z } from 'zod';

configureEvent('cart.item-added.v1', {
  validate: fromStandardSchema(z.object({ sku: z.string(), qty: z.number().int().positive() })),
});
```

`fromStandardSchema` accepts any [Standard Schema](https://standardschema.dev) (Zod 3.24+, Valibot 1+, ArkType 2+). A rejected payload reaches nobody, `publish` returns `false`, and the console names the event and the schema's message, never the payload. The schema must validate synchronously.

## Configure it

`feature.json` has no prompts. Behavior is set per event with `configureEvent(name, options)`:

| Option     | Meaning                                                    | Default |
| ---------- | ---------------------------------------------------------- | ------- |
| `replay`   | Give each new subscriber the last payload right away       | `false` |
| `validate` | A function that returns the payload or throws to reject it | none    |

A subscriber can opt out of a replayed payload with `subscribe(name, handler, { replay: false })`. Event names look like `<domain>.<event>.v<major>`, for example `cart.item-added.v1`. A name that does not match warns in development.

## How it works

Every app merges the contracts' `Events` into the bus's map with one `declare module` block. That makes publishing and subscribing typed end to end.

The shell's `events.ts` imports the bus, which makes the shell the one that provides the shared copy. The bus and its React entry are shared singletons, so every remote uses the shell's copy. The registry of subscribers also lives on `globalThis`, so a second copy of the same version still reaches the same subscribers. A copy that finds a registry from an incompatible version keeps its own and exchanges events with other copies through `window` events.

A handler that throws is logged and does not stop the other handlers.

## Gotchas

:::warning
Change an event's payload in a way old listeners cannot read by adding a new version, such as `cart.item-added.v2`. Publish both until every listener has moved, then delete the old one. Editing `v1` in place breaks remotes that were built before the change.
:::

- **Two copies of the bus.** In development you get a warning that a remote is bundling its own copy. Events still arrive, but share the package as a singleton and make sure the shell imports it.

- **Events in `mfe.json`.** The two lists in `mfe.json` take the same versioned names, checked by the same pattern. The `@major` form is not accepted.

- **Replay keeps only the last payload.** Do not turn it on for events like `cart.item-added.v1`, where every occurrence matters.

## Reference

- [mfe.json](/reference/mfe-json), where a remote lists what it publishes and consumes
- [Ownership](/concepts/ownership)
- [Shared singletons](/concepts/shared-singletons)
- [`@mfeflow/event-bus` README](https://github.com/mfeflow/mfeflow/tree/main/packages/event-bus)
