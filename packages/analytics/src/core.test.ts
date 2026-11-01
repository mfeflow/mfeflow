import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProvider,
  createRecordingProvider,
  getConsent,
  hasConsentChoice,
  identify,
  initAnalytics,
  isAnalyticsReady,
  page,
  pageOnce,
  providerName,
  resetAnalyticsForTests,
  subscribeConsent,
  track,
  updateConsent,
} from '.';

beforeEach(resetAnalyticsForTests);
afterEach(resetAnalyticsForTests);

describe('initAnalytics', () => {
  it('starts the provider once; a second call changes nothing', () => {
    const first = createRecordingProvider();
    const second = createRecordingProvider();
    expect(initAnalytics(first)).toBe(true);
    expect(initAnalytics(second)).toBe(false);
    expect(initAnalytics(first)).toBe(false);
    expect(first.calls.filter((c) => c.type === 'init')).toHaveLength(1);
    expect(second.calls).toEqual([]);
    expect(providerName()).toBe('recording');
  });

  it('keeps calls made before init and sends them in order afterwards', () => {
    expect(isAnalyticsReady()).toBe(false);
    track('a', { n: 1 });
    page('/x', {});
    identify('u1');
    const provider = createRecordingProvider();
    initAnalytics(provider);
    expect(provider.calls.map((c) => c.type)).toEqual(['init', 'track', 'page', 'identify']);
    expect(isAnalyticsReady()).toBe(true);
  });

  it('keeps at most 100 early calls', () => {
    for (let i = 0; i < 150; i++) track(`e${String(i)}`);
    const provider = createRecordingProvider();
    initAnalytics(provider);
    expect(provider.calls.filter((c) => c.type === 'track')).toHaveLength(100);
  });

  it('passes the consent from an earlier visit to the provider', () => {
    localStorage.setItem('mfeflow:consent', JSON.stringify({ analytics_storage: 'granted' }));
    Reflect.deleteProperty(globalThis, Symbol.for('mfeflow.analytics'));
    const provider = createRecordingProvider();
    initAnalytics(provider);
    expect(provider.calls[0]).toEqual({ type: 'init', consent: { analytics_storage: 'granted' } });
  });

  it('shares its state with a second copy of the module through globalThis', async () => {
    const provider = createRecordingProvider();
    initAnalytics(provider);
    vi.resetModules();
    const copy = await import('./core');
    copy.track('from_copy');
    expect(copy.isAnalyticsReady()).toBe(true);
    expect(provider.calls.some((c) => c.type === 'track' && c.event === 'from_copy')).toBe(true);
  });
});

describe('pageOnce', () => {
  it('skips a path that was just sent', () => {
    const provider = createRecordingProvider();
    initAnalytics(provider);
    pageOnce('/a');
    pageOnce('/a');
    pageOnce('/b');
    pageOnce('/a');
    expect(provider.calls.filter((c) => c.type === 'page')).toHaveLength(3);
  });
});

describe('consent', () => {
  it('records the choice, stores it, tells the provider and the listeners', () => {
    const provider = createRecordingProvider();
    initAnalytics(provider);
    let notified = 0;
    const stop = subscribeConsent(() => notified++);
    expect(hasConsentChoice()).toBe(false);
    updateConsent({ analytics_storage: 'granted' });
    expect(getConsent()).toEqual({ analytics_storage: 'granted' });
    expect(hasConsentChoice()).toBe(true);
    expect(JSON.parse(localStorage.getItem('mfeflow:consent') ?? '{}')).toEqual({
      analytics_storage: 'granted',
    });
    expect(provider.calls.at(-1)).toEqual({
      type: 'consent',
      update: { analytics_storage: 'granted' },
    });
    expect(notified).toBe(1);
    stop();
    updateConsent({ ad_storage: 'denied' });
    expect(notified).toBe(1);
    expect(getConsent()).toEqual({ analytics_storage: 'granted', ad_storage: 'denied' });
  });

  it('ignores unknown signals and invalid values', () => {
    updateConsent({ analytics_storage: 'maybe', bogus: 'granted' } as never);
    expect(getConsent()).toEqual({});
  });

  it('works when storage is blocked', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(() => {
        updateConsent({ analytics_storage: 'granted' });
      }).not.toThrow();
      expect(getConsent()).toEqual({ analytics_storage: 'granted' });
    } finally {
      setItem.mockRestore();
    }
  });
});

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
