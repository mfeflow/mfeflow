import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GTM_SCRIPT_ATTRIBUTE, TITLE_WAIT_MS, createGtmProvider, scrubPii } from './gtm';
import { resetWarningsForTests } from './validate';

const layer = () => Reflect.get(globalThis, 'dataLayer') as unknown[];

function reset() {
  Reflect.deleteProperty(globalThis, 'dataLayer');
  Reflect.deleteProperty(globalThis, 'layer2');
  document.head.innerHTML = '';
  resetWarningsForTests();
}
beforeEach(reset);
afterEach(reset);

describe('createGtmProvider', () => {
  it('rejects a container id that is not GTM-…', () => {
    expect(() => createGtmProvider({ containerId: 'G-123' })).toThrow(
      'not a Tag Manager container',
    );
    expect(() => createGtmProvider({ containerId: '' })).toThrow('GTM-XXXXXXX');
  });

  it('pushes all four consent signals as denied, with wait_for_update, as an Arguments object', () => {
    const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
    provider.init({});
    const [first, second] = layer();
    expect(Object.prototype.toString.call(first)).toBe('[object Arguments]');
    expect(Array.from(first as ArrayLike<unknown>)).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        analytics_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        wait_for_update: 500,
      },
    ]);
    expect(second).toMatchObject({ event: 'gtm.js' });
    expect(document.querySelectorAll('script[src*="gtm.js"]')).toHaveLength(1);
  });

  it('puts the defaults in the layer before it appends the script', () => {
    const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
    const append = vi.spyOn(document.head, 'append').mockImplementation(() => {
      expect(layer().length).toBeGreaterThanOrEqual(2);
      expect(Object.prototype.toString.call(layer()[0])).toBe('[object Arguments]');
    });
    provider.init({});
    expect(append).toHaveBeenCalledTimes(1);
    append.mockRestore();
  });

  it('requests gtm.js with the container id', () => {
    createGtmProvider({ containerId: 'GTM-ABC123' }).init({});
    const script = document.querySelector<HTMLScriptElement>(`script[${GTM_SCRIPT_ATTRIBUTE}]`);
    expect(script?.src).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-ABC123');
    expect(script?.async).toBe(true);
  });

  it('honours custom defaults, wait time, script url and data layer name', () => {
    createGtmProvider({
      containerId: 'GTM-ABC123',
      dataLayerName: 'layer2',
      scriptUrl: '/vendor/gtm.js',
      consentDefaults: { analytics_storage: 'granted' },
      waitForUpdate: 2000,
    }).init({});
    const layer2 = Reflect.get(globalThis, 'layer2') as unknown[];
    expect(Array.from(layer2[0] as ArrayLike<unknown>)[2]).toMatchObject({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      wait_for_update: 2000,
    });
    expect(document.querySelector<HTMLScriptElement>('script[src]')?.src).toBe(
      `${location.origin}/vendor/gtm.js?id=GTM-ABC123&l=layer2`,
    );
  });

  it("applies an earlier visit's choice right after the defaults", () => {
    createGtmProvider({ containerId: 'GTM-ABC123' }).init({ analytics_storage: 'granted' });
    expect(Array.from(layer()[1] as ArrayLike<unknown>)).toEqual([
      'consent',
      'update',
      { analytics_storage: 'granted' },
    ]);
  });

  it('is idempotent: a second init, even from a new provider, adds no script and no defaults', () => {
    createGtmProvider({ containerId: 'GTM-ABC123' }).init({});
    const length = layer().length;
    createGtmProvider({ containerId: 'GTM-ABC123' }).init({});
    expect(layer()).toHaveLength(length);
    expect(document.querySelectorAll('script[src*="gtm.js"]')).toHaveLength(1);
  });

  it('pushes events as plain objects with the event name', () => {
    const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
    provider.init({});
    provider.track('add_to_cart', { sku: 'A1', mfe_name: 'cart' });
    expect(layer().at(-1)).toEqual({ sku: 'A1', mfe_name: 'cart', event: 'add_to_cart' });
  });

  it('sends page_view with the path, the full location and the title', async () => {
    document.title = 'Catalog';
    const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
    provider.init({});
    provider.page('/catalog?utm_source=mail', { mfe_name: 'shell' });
    await vi.waitFor(() => {
      expect(layer().at(-1)).toEqual({
        mfe_name: 'shell',
        event: 'page_view',
        page_path: '/catalog?utm_source=mail',
        page_location: `${location.origin}/catalog?utm_source=mail`,
        page_title: 'Catalog',
      });
    });
  });

  it('reads the title after the route rendered, not the previous page title', async () => {
    document.title = 'Home';
    const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
    provider.init({});
    history.pushState(null, '', '/catalog');
    provider.page('/catalog', {});
    expect(layer().some((e) => (e as { event?: string }).event === 'page_view')).toBe(false);
    document.title = 'Catalog';
    await vi.waitFor(() => {
      expect(layer().at(-1)).toMatchObject({ event: 'page_view', page_title: 'Catalog' });
    });
    history.pushState(null, '', '/');
  });

  it('still sends the page_view when the title never changes', () => {
    vi.useFakeTimers();
    try {
      document.title = 'Same';
      const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
      provider.init({});
      provider.page('/same', {});
      vi.advanceTimersByTime(TITLE_WAIT_MS);
      expect(layer().at(-1)).toMatchObject({ event: 'page_view', page_title: 'Same' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates consent through gtag', () => {
    const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
    provider.init({});
    provider.setConsent({ ad_storage: 'granted' });
    expect(Array.from(layer().at(-1) as ArrayLike<unknown>)).toEqual([
      'consent',
      'update',
      { ad_storage: 'granted' },
    ]);
    const length = layer().length;
    provider.setConsent({});
    expect(layer()).toHaveLength(length);
  });

  it('sends no user id unless asked, and never sends traits', () => {
    const quiet = createGtmProvider({ containerId: 'GTM-ABC123' });
    quiet.init({});
    const length = layer().length;
    quiet.identify('u1', { email: 'a@b.co' });
    expect(layer()).toHaveLength(length);
    const loud = createGtmProvider({ containerId: 'GTM-ABC123', sendUserId: true });
    loud.identify('u1', { email: 'a@b.co' });
    expect(layer().at(-1)).toEqual({ event: 'identify', user_id: 'u1' });
  });

  it('drops personal data from event parameters and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = createGtmProvider({ containerId: 'GTM-ABC123' });
    provider.init({});
    provider.track('signup', { plan: 'pro', email: 'a@b.co', note: 'write to me@x.io' });
    expect(layer().at(-1)).toEqual({ plan: 'pro', event: 'signup' });
    expect(String(warn.mock.calls[0]?.[0])).toContain('email, note');
    warn.mockRestore();
  });

  it('can be told to send personal data', () => {
    const provider = createGtmProvider({ containerId: 'GTM-ABC123', allowPii: true });
    provider.init({});
    provider.track('signup', { email: 'a@b.co' });
    expect(layer().at(-1)).toEqual({ email: 'a@b.co', event: 'signup' });
  });
});

describe('scrubPii', () => {
  it('drops by key and by value, keeps the rest', () => {
    expect(scrubPii({ Phone: '1', first_name: 'A', total: 3, ref: 'x@y.zz' })).toEqual({
      clean: { total: 3 },
      dropped: ['Phone', 'first_name', 'ref'],
    });
  });
});
