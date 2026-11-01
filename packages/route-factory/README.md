# @mfeflow/route-factory

Typed links between micro-frontends. Each remote defines its routes once; a link to any of them is checked at compile time for a missing param, a missing search param and an unknown route.

## Install

```sh
pnpm add @mfeflow/route-factory
```

`react` (19) is an optional peer dependency, needed only for `@mfeflow/route-factory/react`. In a project made with mfeflow, `mfeflow add route-factory` does all of this.

## Usage

```ts
import { createLinks, defineRoutes } from '@mfeflow/route-factory';

// `/catalog` is where the shell serves the remote. `?q&page?` names search params: q is required.
export const catalogRoutes = defineRoutes('/catalog', {
  home: '/',
  product: '/products/:sku',
  search: '/search?q&page?',
});
export const cartRoutes = defineRoutes('/cart', { home: '/' });

const links = createLinks({ catalog: catalogRoutes, cart: cartRoutes }, { base: '/app' });

links.href('catalog.product', { params: { sku: 'A1' } }); // /app/catalog/products/A1
links.href('catalog.search', { search: { q: 'red mug' }, hash: 'top' }); // /app/catalog/search?q=red+mug#top
links.href('catalog.product'); // compile error: sku is missing
links.href('catalog.checkout'); // compile error: no such route
```

The route definitions are plain strings, so they can sit in a contracts package that other remotes read without importing the remote. `links.path` gives the same URL without `base`, for a router that has its own `basename`.

`base` can be a function, read on every call, so it may come from runtime config that loads later.

### The shell's route table

```ts
import { shellRoutes } from '@mfeflow/route-factory';
shellRoutes({ catalog: catalogRoutes, cart: cartRoutes });
// [{ remote: 'catalog', mount: '/catalog', pattern: '/catalog/*' }, ...]
```

Use `pattern` in a router or in `mfeflow.app.json` `routes`, `mount` in a hand-written route table.

### React

```tsx
import { createMfeLink } from '@mfeflow/route-factory/react';

const MfeLink = createMfeLink(links); // or createMfeLink(links, { useNavigate }) with React Router
<MfeLink to="catalog.product" params={{ sku: 'A1' }}>
  Mug
</MfeLink>;
```

There is no dependency on a router. Without `useNavigate`, a left click on a same-origin link pushes the URL and sends `popstate`; modified clicks, middle clicks and `target="_blank"` keep the browser's behaviour.

## Module Federation sharing

Bucket: **stateless**. Nothing here holds state shared between micro-frontends, so each remote can bundle its own copy and different versions can run side by side. No sharing config is needed.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
