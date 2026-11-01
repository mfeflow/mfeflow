# event-bus

Typed events between remotes on one page, and the `contracts` package that holds their types. Off by default.

```sh
mfeflow add event-bus
```

Remotes never import each other (decision 0009). They talk through events that both sides can read in `packages/contracts`.

## What you get

| File                                     | What it is for                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/package.json`        | The workspace package `@<scope>/contracts`. Every app depends on it with `workspace:*`.                                                        |
| `packages/contracts/src/events/index.ts` | `interface Events`: the event names and payload types. Types only, no imports, so reading it costs a remote nothing at run time.               |
| `apps/<app>/src/events.ts`               | One `declare module '@mfeflow/event-bus'` line that merges `Events` into the bus, plus a sample: `announceReady()` and `onOtherRemoteReady()`. |
| `apps/shell/src/events.ts`               | The same merge, and an import of the bus so the shell is the one that provides the shared copy. Imported from `bootstrap.tsx`.                 |

With `testing`, each of these gets a unit test.

## Using it

Add the event to the contracts package:

```ts
// packages/contracts/src/events/index.ts
export interface Events {
  'mfe.ready.v1': { mfe: string };
  'cart.item-added.v1': { sku: string; qty: number };
}
```

Publish from one remote and listen in another. Neither imports the other:

```ts
// apps/catalog
import { publish } from '@mfeflow/event-bus';
publish('cart.item-added.v1', { sku: 'A1', qty: 1 });
```

```tsx
// apps/cart
import { useEvent } from '@mfeflow/event-bus/react';
useEvent('cart.item-added.v1', ({ sku, qty }) => addLine(sku, qty));
```

A wrong name, a wrong payload or a missing payload fails `pnpm typecheck`.

## Versioned names

Names are `<domain>.<event>.v<major>`. A change old listeners cannot read gets a new version (`cart.item-added.v2`);
publish both until every listener has moved, then delete the old one. `mfe.json` `events` accepts these names (and the
older `cart.item_added@1` form).

## Replay for late subscribers

Most events are things that happened, and a remote that mounts late missed them. State is different: the signed-in
user, the selected store. Mark those events and each new subscriber gets the last payload immediately:

```ts
import { configureEvent } from '@mfeflow/event-bus';
configureEvent('session.changed.v1', { replay: true });
```

Do it in the shell's `events.ts`, once. Under React StrictMode a replayed event reaches a handler once per mount, so
keep that handler idempotent. Live events are delivered once.

## Validating payloads

TypeScript checks the code you wrote; it cannot check a payload from a remote built last week. To check at run time,
give the event a `validate` function. Nothing validates in the core bundle:

```ts
import { configureEvent } from '@mfeflow/event-bus';
import { fromStandardSchema } from '@mfeflow/event-bus/standard-schema';
import { z } from 'zod';

configureEvent('cart.item-added.v1', {
  validate: fromStandardSchema(z.object({ sku: z.string(), qty: z.number().int().positive() })),
});
```

`fromStandardSchema` accepts any [Standard Schema](https://standardschema.dev) (Zod 3.24+, Valibot 1+, ArkType 2+). A
rejected payload reaches nobody, `publish` returns `false`, and the console names the event and the schema's message,
never the payload.

## One copy on the page

`@mfeflow/event-bus` and `@mfeflow/event-bus/react` are shared singletons (`@mfeflow/rsbuild` adds them), so every
remote uses the shell's copy. The subscribers also live on `globalThis`, so a second copy of the same version still
reaches them. A copy that finds a registry from an incompatible version keeps its own, warns in development, and
exchanges events with other copies through `window` events.

A handler that throws is logged and does not stop the other handlers.

## Adding it later

`mfeflow add event-bus` on an existing project creates the package, adds the dependency to every app and the files to
each. A remote added afterwards gets its own `events.ts` and the dependency.
