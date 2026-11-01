# @mfeflow/event-bus

A typed event bus for micro-frontends on one page. Remotes publish and subscribe by event name; they never import each other. Event names are versioned (`cart.item-added.v1`), payload types come from a map each contract adds to, and late subscribers can be given the last payload.

## Install

```sh
pnpm add @mfeflow/event-bus
```

`react` (19) is an optional peer dependency, needed only for `@mfeflow/event-bus/react`. In a project made with mfeflow, `mfeflow add event-bus` does all of this and creates the contracts package.

## Usage

```ts
// packages/contracts: the types, shared by every remote
export interface Events {
  'cart.item-added.v1': { sku: string; qty: number };
  'cart.cleared.v1': undefined;
}
```

```ts
// each app, once
import type { Events } from '@acme/contracts/events';

declare module '@mfeflow/event-bus' {
  interface EventMap extends Events {}
}
```

```ts
// catalog
import { publish } from '@mfeflow/event-bus';
publish('cart.item-added.v1', { sku: 'A1', qty: 1 });

// cart
import { useEvent } from '@mfeflow/event-bus/react';
useEvent('cart.item-added.v1', ({ sku, qty }) => addLine(sku, qty));
```

A wrong name, a wrong payload or a missing payload fails typecheck. A handler that throws is logged and does not stop the others.

### Replay for late subscribers

```ts
import { configureEvent } from '@mfeflow/event-bus';
configureEvent('session.changed.v1', { replay: true });
```

A remote that mounts after the event was published gets the last payload when it subscribes. Off by default: most events are things that happened, not state. Under React StrictMode a replayed event reaches the handler once per mount, so keep that handler idempotent.

### Validating payloads

Nothing validates in the core bundle. Pass any function that returns the payload or throws:

```ts
import { fromStandardSchema } from '@mfeflow/event-bus/standard-schema';
configureEvent('cart.item-added.v1', { validate: fromStandardSchema(itemAddedSchema) });
```

`fromStandardSchema` takes a Zod 3.24+, Valibot 1+ or ArkType 2+ schema (the [Standard Schema](https://standardschema.dev) interface, copied in, so it is not a dependency). A rejected payload reaches nobody, `publish` returns `false`, and the log names the event and the schema's message, never the payload.

## Module Federation sharing

Bucket: **singleton**. Share `@mfeflow/event-bus` and `@mfeflow/event-bus/react` (`@mfeflow/rsbuild` does). The registry also lives on `globalThis`, so a second copy of the same version still reaches the same subscribers (and warns in development that two copies are loaded). A copy that finds a registry from an incompatible version keeps its own, warns in development, and talks to other copies through `window` events.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
