import { createLinks, defineRoutes, shellRoutes } from '@mfeflow/route-factory';
import { routes as cart } from '@storefront/contracts/routes/cart';
import { routes as catalog } from '@storefront/contracts/routes/catalog';

const sets = { catalog: defineRoutes('/catalog', catalog), cart: defineRoutes('/cart', cart) };

export const links = createLinks(sets);

/** Which remote serves a path; the catalog is the front page. */
export function remoteFor(path: string): 'catalog' | 'cart' {
  const match = shellRoutes(sets).find(
    (route) => path === route.mount || path.startsWith(`${route.mount}/`),
  );
  return match?.remote === 'cart' ? 'cart' : 'catalog';
}
