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
  it('stamps every event with the remote name and a null version', () => {
    const tracker = createTracker('cart');
    tracker.track('add_to_cart', { sku: 'A1', qty: 2 });
    tracker.track('cart_viewed');
    expect(tracked()).toEqual([
      {
        type: 'track',
        event: 'add_to_cart',
        params: { sku: 'A1', qty: 2, mfe_name: 'cart', mfe_version: null },
      },
      { type: 'track', event: 'cart_viewed', params: { mfe_name: 'cart', mfe_version: null } },
    ]);
  });

  it('adds the version when it has one', () => {
    createTracker('cart', { mfeVersion: '1.4.0' }).track('cart_viewed');
    expect(tracked()[0]).toMatchObject({ params: { mfe_name: 'cart', mfe_version: '1.4.0' } });
  });

  it('never leaves one remote’s version on another remote’s event', () => {
    createTracker('cart', { mfeVersion: '1.4.0' }).track('cart_viewed');
    createTracker('catalog').track('cart_viewed');
    const [first, second] = tracked();
    expect(first?.params).toMatchObject({ mfe_name: 'cart', mfe_version: '1.4.0' });
    expect(second?.params).toEqual({ mfe_name: 'catalog', mfe_version: null });
  });

  it('stamps page views too', () => {
    createTracker('cart').page('/cart');
    expect(calls.at(-1)).toEqual({
      type: 'page',
      path: '/cart',
      params: { mfe_name: 'cart', mfe_version: null },
    });
  });

  it('does not let a caller overwrite the stamp', () => {
    createTracker('cart').track('add_to_cart', {
      sku: 'x',
      qty: 1,
      mfe_name: 'evil',
      mfe_version: '9',
    } as never);
    expect(tracked()[0]).toMatchObject({ params: { mfe_name: 'cart', mfe_version: null } });
  });
});
