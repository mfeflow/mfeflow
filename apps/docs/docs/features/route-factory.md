# route-factory

Typed links between remotes. Off by default.

```sh
mfeflow add route-factory
```

## What you get

| File                                        | What it is for                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/<remote>/src/routes.ts`               | The remote's routes and `links`: `defineRoutes('/<remote>', { home: '/' })` and `createLinks`.      |
| `packages/contracts/src/routes/<remote>.ts` | With `event-bus`: the paths as plain data, so other remotes can link without importing this remote. |

Without `event-bus` the paths sit in the remote's `routes.ts`. With it, they move to the contracts package and
`routes.ts` reads them from there. Add `event-bus` first, or route-factory in the same command, to get that layout; a
remote that already has its `routes.ts` is not rewritten.

## Defining routes

```ts
// packages/contracts/src/routes/catalog.ts
export const routes = {
  home: '/',
  product: '/products/:sku',
  search: '/search?q&page?',
} as const;
```

`/catalog` is where the shell serves the remote. `:sku` is a path param. After `?`, `q&page?` names search params:
`q` is required, `page` is optional.

## Linking

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

A missing param, a missing required search param, a param the route does not have and an unknown route all fail
`pnpm typecheck`. If the types are bypassed they throw with the route's name.

`base` puts a prefix in front when the shell is served under a path, and may be a function read on every call:

```ts
createLinks(sets, { base: () => getRuntimeConfig().basePath });
```

## In the shell

`shellRoutes` lists what the shell needs for each remote from the same definitions:

```ts
import { shellRoutes } from '@mfeflow/route-factory';
shellRoutes({ catalog: defineRoutes('/catalog', catalog) });
// [{ remote: 'catalog', mount: '/catalog', pattern: '/catalog/*' }]
```

Use `pattern` in a router or in `mfe.json` `routes`.

## React

```tsx
import { createMfeLink } from '@mfeflow/route-factory/react';

const MfeLink = createMfeLink(links);
<MfeLink to="catalog.product" params={{ sku: 'A1' }}>
  Mug
</MfeLink>;
```

Without a router, a left click on a same-origin link pushes the URL and sends `popstate`, which the generated shell
and routers that listen to the history pick up. With React Router, pass your navigate function:

```tsx
import { useNavigate } from 'react-router';
const MfeLink = createMfeLink(links, { useNavigate });
```

The path it gets has no `base`, so it works with a router that has its own `basename`. Modified clicks, middle clicks
and `target="_blank"` keep the browser's behaviour. There is no dependency on a router.
