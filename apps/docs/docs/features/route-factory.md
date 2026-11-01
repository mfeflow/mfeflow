---
title: route-factory - typed links between remotes
description: Link from one remote to another with routes checked by the compiler, so a renamed path or a missing parameter fails typecheck instead of 404ing.
---

# route-factory

This page shows how to link between remotes without hard-coding URLs. Each remote declares its routes once, and every link to them is checked when you run typecheck.

## What you get

Every remote gets a `routes.ts` with its paths and a `links` object that builds URLs from them. With `event-bus` installed, the paths move to the contracts package, so a remote can link to another one without importing it. This feature is off by default.

## Add it

```sh
pnpm mfeflow add route-factory
```

What changed:

- `apps/<remote>/src/routes.ts` in every remote
- `packages/contracts/src/routes/<remote>.ts` for each remote, only when `event-bus` is installed
- `apps/<remote>/src/routes.test.ts`, only when `testing` is installed
- `@mfeflow/route-factory` added to every remote

## Use it

Declare the routes. A `:name` is a path parameter, and the names after `?` are search parameters, where a trailing `?` makes one optional.

```ts title="packages/contracts/src/routes/catalog.ts"
export const routes = {
  home: '/',
  product: '/products/:sku',
  search: '/search?q&page?',
} as const;
```

Then build links from any remote. The id is `<remote>.<route>`.

```ts
import { createLinks, defineRoutes } from '@mfeflow/route-factory';
import { routes as catalog } from '<scope>/contracts/routes/catalog';
import { routes as cart } from '<scope>/contracts/routes/cart';

const links = createLinks({
  catalog: defineRoutes('/catalog', catalog),
  cart: defineRoutes('/cart', cart),
});

links.href('catalog.product', { params: { sku: 'A1' } }); // /catalog/products/A1
links.href('catalog.search', { search: { q: 'red mug' }, hash: 'top' }); // /catalog/search?q=red+mug#top
links.href('catalog.product'); // compile error: sku is missing
links.href('cart.checkout'); // compile error: no such route
```

For a link element, `@mfeflow/route-factory/react` gives you a typed anchor:

```tsx
import { createMfeLink } from '@mfeflow/route-factory/react';

const MfeLink = createMfeLink(links);

<MfeLink to="catalog.product" params={{ sku: 'A1' }}>
  Mug
</MfeLink>;
```

The shell can list what it needs to serve each remote from the same definitions:

```ts
import { shellRoutes } from '@mfeflow/route-factory';

shellRoutes({ catalog: defineRoutes('/catalog', catalog) });
// [{ remote: 'catalog', mount: '/catalog', pattern: '/catalog/*' }]
```

Use `pattern` in your router or in the `routes` field of `mfe.json`.

## Configure it

The feature has no install options. What you can change is in the code you write:

| Setting                  | Where                   | Effect                                                                    |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------- |
| `mount` (first argument) | `defineRoutes`          | Where the shell serves the remote, such as `/catalog`, or `/` at the root |
| `base`                   | `createLinks` options   | Prefix for `href` when the shell lives under a path; may be a function    |
| `useNavigate`            | `createMfeLink` options | Your router's navigate hook, so clicks go through the router              |

A `base` function is read on every call, so it can return a value from runtime config that loads after the links are created:

```ts
createLinks(sets, { base: () => getRuntimeConfig().basePath });
```

With React Router, pass its hook so clicks go through the router:

```tsx
import { useNavigate } from 'react-router';

const MfeLink = createMfeLink(links, { useNavigate });
```

## How it works

`defineRoutes` pairs a mount path with a table of templates. `createLinks` looks up `<remote>.<route>` in those tables, fills the parameters, checks the search names and joins the pieces. `href` includes `base`; `path` leaves it out, which is what a router with its own `basename` wants.

Without a router, a plain left click on a same-origin link pushes the URL and fires `popstate`, which the generated shell and any history-listening router pick up. Middle clicks, modifier keys and `target="_blank"` keep the browser's behaviour. The package has no router dependency; React is an optional peer.

## Gotchas

- A missing parameter, a missing required search parameter, an extra search name and an unknown route all fail typecheck. If you bypass the types, they throw an error naming the route.
- A mount must start with `/` and cannot end with one, so `/catalog/` is rejected.
- Which layout a remote gets is decided by whether `event-bus` is installed when the feature is added, so install `event-bus` first, or in the same command.

## Reference

- [event-bus](/features/event-bus), which holds the shared paths
- [Adding a remote](/guide/adding-a-remote)
- [mfe.json](/reference/mfe-json)
