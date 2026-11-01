import { describe, expect, expectTypeOf, it } from 'vitest';
import { createLinks, defineRoutes, shellRoutes, type LinkId, type PathParams } from '.';

const catalog = defineRoutes('/catalog', {
  home: '/',
  product: '/products/:sku',
  review: '/products/:sku/reviews/:reviewId',
  search: '/search?q&page?',
  browse: '/browse?sort?',
});
const cart = defineRoutes('/cart', { home: '/' });
const root = defineRoutes('/', { landing: '/', about: '/about' });

const links = createLinks({ catalog, cart });

describe('defineRoutes', () => {
  it.each(['catalog', '/catalog/', '/cat?alog', '/:id', '', '/a b'])(
    'rejects the mount "%s"',
    (mount) => {
      expect(() => defineRoutes(mount, {})).toThrow('mount');
    },
  );

  it('rejects a route that does not start with a slash', () => {
    expect(() => defineRoutes('/catalog', { home: 'home' })).toThrow('route "home" must start');
  });

  it('keeps the routes as written', () => {
    expect(catalog.mount).toBe('/catalog');
    expect(catalog.routes.product).toBe('/products/:sku');
    expect(root.mount).toBe('');
  });
});

describe('links.href', () => {
  it('joins the mount and the path', () => {
    expect(links.href('catalog.home')).toBe('/catalog');
    expect(links.href('cart.home')).toBe('/cart');
  });

  it('fills and encodes params', () => {
    expect(links.href('catalog.product', { params: { sku: 'A1' } })).toBe('/catalog/products/A1');
    expect(links.href('catalog.product', { params: { sku: 'a/b c' } })).toBe(
      '/catalog/products/a%2Fb%20c',
    );
    expect(links.href('catalog.review', { params: { sku: 7, reviewId: 'r1' } })).toBe(
      '/catalog/products/7/reviews/r1',
    );
  });

  it('adds search params and a hash', () => {
    expect(
      links.href('catalog.search', { search: { q: 'red mug', page: 2 }, hash: 'results' }),
    ).toBe('/catalog/search?q=red+mug&page=2#results');
    expect(links.href('catalog.search', { search: { q: 'x', page: undefined } })).toBe(
      '/catalog/search?q=x',
    );
    expect(links.href('catalog.browse')).toBe('/catalog/browse');
    expect(links.href('catalog.browse', { search: { sort: 'new' } })).toBe(
      '/catalog/browse?sort=new',
    );
    expect(links.href('cart.home', { hash: '#top' })).toBe('/cart#top');
  });

  it('puts the shell base in front', () => {
    const under = createLinks({ catalog, root }, { base: '/app/' });
    expect(under.href('catalog.product', { params: { sku: 'A1' } })).toBe(
      '/app/catalog/products/A1',
    );
    expect(under.href('root.landing')).toBe('/app/');
    expect(under.href('root.about')).toBe('/app/about');
    expect(under.path('catalog.product', { params: { sku: 'A1' } })).toBe('/catalog/products/A1');
  });

  it('reads the base on every call, so runtime config can load later', () => {
    let base = '';
    const late = createLinks({ cart }, { base: () => base });
    expect(late.href('cart.home')).toBe('/cart');
    base = 'https://shop.example.com/app';
    expect(late.href('cart.home')).toBe('https://shop.example.com/app/cart');
  });

  it('serves a remote mounted at the root', () => {
    const only = createLinks({ root });
    expect(only.href('root.landing')).toBe('/');
    expect(only.href('root.about')).toBe('/about');
  });
});

describe('when the types are bypassed', () => {
  const loose = links.href as (id: string, options?: unknown) => string;

  it('throws on an unknown route, naming it', () => {
    expect(() => loose('catalog.nope')).toThrow('unknown route "catalog.nope"');
    expect(() => loose('shipping.home')).toThrow('unknown route "shipping.home"');
    expect(() => loose('nodot')).toThrow('unknown route');
  });

  it('throws on a missing param, naming it', () => {
    expect(() => loose('catalog.product')).toThrow('missing param "sku" for "catalog.product"');
    expect(() => loose('catalog.product', { params: {} })).toThrow('missing param "sku"');
  });

  it('throws on a missing required search param and on one the route does not have', () => {
    expect(() => loose('catalog.search')).toThrow('missing search param "q"');
    expect(() => loose('catalog.search', { search: { q: 'x', color: 'red' } })).toThrow(
      '"color" is not a search param of "catalog.search"',
    );
  });
});

describe('shellRoutes', () => {
  it('lists the mount and the router pattern of every remote', () => {
    expect(shellRoutes({ catalog, cart, root })).toEqual([
      { remote: 'catalog', mount: '/catalog', pattern: '/catalog/*' },
      { remote: 'cart', mount: '/cart', pattern: '/cart/*' },
      { remote: 'root', mount: '/', pattern: '/*' },
    ]);
  });
});

describe('types', () => {
  it('derives path params from the template', () => {
    expectTypeOf<PathParams<'/a/:x/b/:y'>>().toEqualTypeOf<'x' | 'y'>();
    expectTypeOf<PathParams<'/a'>>().toEqualTypeOf<never>();
  });

  it('knows every route id', () => {
    expectTypeOf<LinkId<{ catalog: typeof catalog; cart: typeof cart }>>().toEqualTypeOf<
      | 'catalog.home'
      | 'catalog.product'
      | 'catalog.review'
      | 'catalog.search'
      | 'catalog.browse'
      | 'cart.home'
    >();
  });

  it('fails typecheck for a missing param, a missing search param and an unknown route', () => {
    // Never called: these only have to fail to compile.
    const bad = () => {
      // @ts-expect-error product needs its sku
      links.href('catalog.product');
      // @ts-expect-error product needs its sku
      links.href('catalog.product', {});
      // @ts-expect-error review needs reviewId as well
      links.href('catalog.review', { params: { sku: 'A1' } });
      // @ts-expect-error a param that the route does not have
      links.href('catalog.product', { params: { sku: 'A1', other: 1 } });
      // @ts-expect-error search needs q
      links.href('catalog.search');
      // @ts-expect-error search needs q
      links.href('catalog.search', { search: { page: 1 } });
      // @ts-expect-error a search param that the route does not have
      links.href('catalog.search', { search: { q: 'x', color: 'red' } });
      // @ts-expect-error no such route
      links.href('catalog.checkout');
      // @ts-expect-error no such remote
      links.href('shipping.home');
      // @ts-expect-error home has no params
      links.href('cart.home', { params: { id: 1 } });
      // @ts-expect-error a param is text or a number
      links.href('catalog.product', { params: { sku: true } });
    };
    expect(bad).toBeTypeOf('function');
  });

  it('accepts the right calls', () => {
    expectTypeOf(links.href('catalog.home')).toEqualTypeOf<string>();
    links.href('catalog.product', { params: { sku: 1 } });
    links.href('catalog.search', { search: { q: 'x' } });
    links.href('catalog.browse', {});
    expect(true).toBe(true);
  });
});
