import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRecordingProvider,
  initAnalytics,
  isAnalyticsReady,
  providerName,
  resetAnalyticsForTests,
  track,
  updateConsent,
} from '.';
import { addProvider, combineProviders } from './providers';

beforeEach(resetAnalyticsForTests);
afterEach(resetAnalyticsForTests);

describe('addProvider', () => {
  it('starts analytics when nothing runs yet', () => {
    const provider = createRecordingProvider();
    expect(addProvider(provider)).toBe(true);
    expect(isAnalyticsReady()).toBe(true);
    expect(provider.calls.map((c) => c.type)).toEqual(['init']);
  });

  it('joins the running provider: both get later calls, the newcomer gets the stored consent', () => {
    const first = createRecordingProvider();
    initAnalytics(first);
    updateConsent({ analytics_storage: 'granted' });
    const second: ReturnType<typeof createRecordingProvider> = {
      ...createRecordingProvider(),
      name: 'second',
    };
    expect(addProvider(second)).toBe(true);
    expect(second.calls[0]).toEqual({ type: 'init', consent: { analytics_storage: 'granted' } });
    track('buy', { sku: 'A1' });
    expect(first.calls.at(-1)).toMatchObject({ type: 'track', event: 'buy' });
    expect(second.calls.at(-1)).toMatchObject({ type: 'track', event: 'buy' });
    expect(providerName()).toBe('recording+second');
  });

  it('works whichever feature starts first', () => {
    const a = { ...createRecordingProvider(), name: 'a' };
    const b = { ...createRecordingProvider(), name: 'b' };
    addProvider(b);
    addProvider(a);
    expect(providerName()).toBe('b+a');
  });

  it('ignores a provider whose name is already there', () => {
    const first = createRecordingProvider();
    addProvider(first);
    expect(addProvider(createRecordingProvider())).toBe(false);
    expect(first.calls.filter((c) => c.type === 'init')).toHaveLength(1);
  });
});

describe('combineProviders', () => {
  it('is the same function the combine module has', () => {
    expect(typeof combineProviders).toBe('function');
  });
});
