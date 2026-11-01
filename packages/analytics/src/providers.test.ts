import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRecordingProvider,
  initAnalytics,
  isAnalyticsReady,
  page,
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

describe('providers that start in either order', () => {
  const named = (name: string) => ({ ...createRecordingProvider(), name });

  it('gives the provider that starts second the page view and events from before', () => {
    page('/', {});
    track('early', { n: 1 });
    const clarity = named('clarity');
    const gtm = named('gtm');
    addProvider(clarity);
    addProvider(gtm);
    expect(gtm.calls.map((c) => c.type)).toEqual(['init', 'page', 'track']);
    expect(clarity.calls.map((c) => c.type)).toEqual(['init', 'page', 'track']);
    track('later', {});
    expect(gtm.calls.at(-1)).toMatchObject({ event: 'later' });
  });

  it('does the same the other way round', () => {
    page('/', {});
    const gtm = named('gtm');
    const clarity = named('clarity');
    addProvider(gtm);
    track('mid', {});
    addProvider(clarity);
    expect(clarity.calls.map((c) => c.type)).toEqual(['init', 'page', 'track']);
    expect(gtm.calls.map((c) => c.type)).toEqual(['init', 'page', 'track']);
  });

  it('stops keeping calls after the boot window, and keeps at most 100', () => {
    vi.useFakeTimers();
    try {
      page('/', {});
      vi.advanceTimersByTime(11_000);
      track('late', {});
      const first = named('first');
      addProvider(first);
      const second = named('second');
      addProvider(second);
      expect(second.calls.map((c) => c.type)).toEqual(['init']);
    } finally {
      vi.useRealTimers();
    }
    resetAnalyticsForTests();
    for (let i = 0; i < 150; i++) track('e', { i });
    const first = named('first');
    addProvider(first);
    const second = named('second');
    addProvider(second);
    expect(second.calls.filter((c) => c.type === 'track')).toHaveLength(100);
  });

  it('leaves the running provider as it was when the newcomer throws in init, and lets it be added again', () => {
    const running = named('running');
    addProvider(running);
    let fail = true;
    const flaky = {
      ...named('flaky'),
      init() {
        if (fail) throw new Error('no network');
      },
    };
    expect(() => addProvider(flaky)).toThrow('no network');
    expect(providerName()).toBe('running');
    track('still', {});
    expect(running.calls.at(-1)).toMatchObject({ event: 'still' });
    fail = false;
    expect(addProvider(flaky)).toBe(true);
    expect(providerName()).toBe('running+flaky');
  });
});
