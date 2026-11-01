import { describe, expect, expectTypeOf, it } from 'vitest';
import { createUrlFactory, defineEndpoints, fillPath, type PathParams } from '.';

const endpoints = defineEndpoints({
  listOrders: { service: 'orders', path: '/v1/orders' },
  getOrder: { service: 'orders', path: '/v1/orders/:orderId' },
  getItem: { service: 'orders', path: '/v1/orders/:orderId/items/:itemId' },
  me: { service: 'users', path: '/me' },
});

const bases: Record<string, string> = {
  orders: 'https://api.example.com/orders',
  users: 'https://api.example.com/users/',
};

const apiUrl = createUrlFactory(endpoints, (s) => bases[s]);

describe('createUrlFactory', () => {
  it('joins base and path, with or without a trailing slash on the base', () => {
    expect(apiUrl('listOrders')).toBe('https://api.example.com/orders/v1/orders');
    expect(apiUrl('me')).toBe('https://api.example.com/users/me');
  });

  it('fills and encodes params', () => {
    expect(apiUrl('getOrder', { params: { orderId: 42 } })).toBe(
      'https://api.example.com/orders/v1/orders/42',
    );
    expect(apiUrl('getItem', { params: { orderId: 'a/b', itemId: 'x y' } })).toBe(
      'https://api.example.com/orders/v1/orders/a%2Fb/items/x%20y',
    );
  });

  it('builds queries: arrays repeat, null and undefined are dropped', () => {
    expect(
      apiUrl('listOrders', {
        query: { status: ['open', 'paid'], page: 2, draft: false, q: null, tag: undefined },
      }),
    ).toBe('https://api.example.com/orders/v1/orders?status=open&status=paid&page=2&draft=false');
  });

  it('reads the base URL at call time (runtime config loads later)', () => {
    let base: string | undefined;
    const late = createUrlFactory(endpoints, () => base);
    expect(() => late('me')).toThrow(/no base URL for service "users"/);
    base = 'https://staging.example.com/users';
    expect(late('me')).toBe('https://staging.example.com/users/me');
  });

  it('throws on unknown endpoints and missing params at runtime too', () => {
    // @ts-expect-error unknown endpoint: rejected by the compiler and at runtime
    expect(() => apiUrl('nope')).toThrow(/unknown endpoint "nope"/);
    // @ts-expect-error orderId missing: rejected by the compiler and at runtime
    expect(() => apiUrl('getOrder', { params: {} })).toThrow(/missing param "orderId"/);
  });

  it('rejects paths that do not start with a slash', () => {
    expect(() => defineEndpoints({ bad: { service: 's', path: 'v1/x' } })).toThrow(
      /must start with/,
    );
  });
});

describe('fillPath', () => {
  it.each(['.', '..'])('refuses the value %s, which would walk out of the path', (value) => {
    expect(() => apiUrl('getOrder', { params: { orderId: value } })).toThrow(
      `cannot be "${value}"`,
    );
    expect(() => fillPath('/a/:id', { id: value }, 'x', 'y')).toThrow('x: param "id" for "y"');
  });

  it('keeps dots inside a longer value and ends a name at the first other character', () => {
    expect(fillPath('/a/:id.json', { id: 'a.b' }, 'x', 'y')).toBe('/a/a.b.json');
    expect(fillPath('/a/:order-id', { order: 7 }, 'x', 'y')).toBe('/a/7-id');
  });
});

describe('types', () => {
  it('derives params from the template, ending a name where fillPath does', () => {
    expectTypeOf<PathParams<'/a/:order-id'>>().toEqualTypeOf<'order'>();
    expectTypeOf<PathParams<'/v1/orders/:orderId/items/:itemId'>>().toEqualTypeOf<
      'orderId' | 'itemId'
    >();
    expectTypeOf<PathParams<'/v1/orders'>>().toEqualTypeOf<never>();
  });

  it('requires params where the path has them and forbids unknown keys', () => {
    // @ts-expect-error params are required for getOrder
    expect(() => apiUrl('getOrder')).toThrow();
    // @ts-expect-error orderId must be present
    expect(() => apiUrl('getOrder', { params: { id: 1 } })).toThrow();
    // @ts-expect-error unknown endpoint
    expect(() => apiUrl('getOrders')).toThrow();
  });
});
