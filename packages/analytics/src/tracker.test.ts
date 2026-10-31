import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  createRecordingProvider,
  createTracker,
  initAnalytics,
  resetAnalyticsForTests,
  resetWarningsForTests,
  type RecordedCall,
} from '.';

declare module '.' {
  interface AnalyticsEvents {
    add_to_cart: { sku: string; qty: number };
    cart_viewed: undefined;
  }
}

let calls: RecordedCall[] = [];
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetAnalyticsForTests();
  resetWarningsForTests();
  const provider = createRecordingProvider();
  initAnalytics(provider);
  calls = provider.calls;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  resetAnalyticsForTests();
});

const tracked = () => calls.filter((c) => c.type === 'track');

describe('createTracker', () => {
  it('stamps every event with the remote name', () => {
    const tracker = createTracker('cart');
    tracker.track('add_to_cart', { sku: 'A1', qty: 2 });
    tracker.track('cart_viewed');
    expect(tracked()).toEqual([
      { type: 'track', event: 'add_to_cart', params: { sku: 'A1', qty: 2, mfe: { name: 'cart' } } },
      { type: 'track', event: 'cart_viewed', params: { mfe: { name: 'cart' } } },
    ]);
  });

  it('adds the version when it has one', () => {
    createTracker('cart', { mfeVersion: '1.4.0' }).track('cart_viewed');
    expect(tracked()[0]).toMatchObject({ params: { mfe: { name: 'cart', version: '1.4.0' } } });
  });

  it('stamps page views too', () => {
    createTracker('cart').page('/cart');
    expect(calls.at(-1)).toEqual({
      type: 'page',
      path: '/cart',
      params: { mfe: { name: 'cart' } },
    });
  });

  it('does not let a caller overwrite the stamp', () => {
    createTracker('cart').track('add_to_cart', {
      sku: 'x',
      qty: 1,
      mfe: { name: 'evil' },
    } as never);
    expect(tracked()[0]).toMatchObject({ params: { mfe: { name: 'cart' } } });
  });
});

describe('the development validator', () => {
  it('warns once about an event the tracker does not declare, and still sends it', () => {
    const tracker = createTracker('cart', { events: ['cart_viewed'] });
    tracker.track('add_to_cart', { sku: 'a', qty: 1 });
    tracker.track('add_to_cart', { sku: 'b', qty: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"add_to_cart" is not one of the events');
    expect(tracked()).toHaveLength(2);
  });

  it('stays quiet for declared events and for trackers with no list', () => {
    createTracker('cart', { events: ['cart_viewed'] }).track('cart_viewed');
    createTracker('cart').track('add_to_cart', { sku: 'a', qty: 1 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about names GA4 would reject', () => {
    createTracker('cart').track('Add To Cart' as never);
    expect(String(warn.mock.calls[0]?.[0])).toContain('not a valid event name');
  });

  it('is silent in production builds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      createTracker('cart', { events: [] }).track('nope' as never);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
