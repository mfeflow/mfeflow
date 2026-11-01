import { afterEach, describe, expect, it } from 'vitest';
import { combineProviders, partsOf } from './combine';
import { createRecordingProvider } from './noop';
import type { AnalyticsProvider } from './types';
import { resetWarningsForTests } from './validate';

afterEach(resetWarningsForTests);

describe('combineProviders', () => {
  it('sends every call to every provider, in order', () => {
    const a = createRecordingProvider();
    const b = createRecordingProvider();
    const both = combineProviders(a, b);
    both.init({ analytics_storage: 'granted' });
    both.track('buy', { sku: 'A1' });
    both.page('/cart', {});
    both.identify('u1', {});
    both.setConsent({ ad_storage: 'denied' });
    for (const provider of [a, b]) {
      expect(provider.calls.map((c) => c.type)).toEqual([
        'init',
        'track',
        'page',
        'identify',
        'consent',
      ]);
    }
    expect(both.name).toBe('recording+recording');
  });

  it('flattens a combination, so nesting does not forward twice', () => {
    const a = createRecordingProvider();
    const b = createRecordingProvider();
    const c = createRecordingProvider();
    const nested = combineProviders(combineProviders(a, b), c);
    expect(partsOf(nested)).toEqual([a, b, c]);
    nested.track('x', {});
    expect(a.calls).toHaveLength(1);
  });

  it('keeps going when one provider throws', () => {
    const broken: AnalyticsProvider = {
      ...createRecordingProvider(),
      name: 'broken',
      track() {
        throw new Error('boom');
      },
    };
    const ok = createRecordingProvider();
    combineProviders(broken, ok).track('x', {});
    expect(ok.calls).toHaveLength(1);
  });

  it('treats a plain provider as its own only part', () => {
    const a = createRecordingProvider();
    expect(partsOf(a)).toEqual([a]);
  });
});
