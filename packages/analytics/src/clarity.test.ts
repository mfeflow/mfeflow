import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLARITY_SCRIPT_ATTRIBUTE, createClarityProvider } from './clarity';

const queue = () =>
  (Reflect.get(globalThis, 'clarity') as { q?: ArrayLike<unknown>[] } | undefined)?.q?.map((args) =>
    Array.from(args),
  ) ?? [];
const scripts = () =>
  document.querySelectorAll<HTMLScriptElement>(`script[${CLARITY_SCRIPT_ATTRIBUTE}]`);

function reset() {
  Reflect.deleteProperty(globalThis, 'clarity');
  document.head.innerHTML = '';
}
beforeEach(reset);
afterEach(reset);

describe('createClarityProvider', () => {
  it('rejects a project id that is not a Clarity id', () => {
    expect(() => createClarityProvider({ projectId: '' })).toThrow('not a Clarity project id');
    expect(() => createClarityProvider({ projectId: 'GTM-ABC123' })).toThrow('Clarity');
    expect(() => createClarityProvider({ projectId: 'abc' })).toThrow('Clarity');
  });

  it('requests nothing and defines no function until analytics is granted', () => {
    const provider = createClarityProvider({ projectId: 'k3x9m2abcd' });
    provider.init({});
    provider.track('buy', {});
    provider.page('/cart', {});
    provider.setConsent({ ad_storage: 'granted' });
    expect(scripts()).toHaveLength(0);
    expect(Reflect.get(globalThis, 'clarity')).toBeUndefined();
  });

  it('keeps nothing from before consent: the calls are dropped, not replayed', () => {
    const provider = createClarityProvider({ projectId: 'k3x9m2abcd' });
    provider.init({});
    provider.track('before', {});
    provider.setConsent({ analytics_storage: 'granted' });
    expect(queue().map((call) => call[0])).toEqual(['consentv2']);
  });

  it('loads the script once consent is granted, and tells Clarity what was granted', () => {
    const provider = createClarityProvider({ projectId: 'k3x9m2abcd' });
    provider.init({});
    provider.setConsent({ analytics_storage: 'granted', ad_storage: 'denied' });
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.src).toBe('https://www.clarity.ms/tag/k3x9m2abcd');
    expect(queue()[0]).toEqual([
      'consentv2',
      { ad_Storage: 'denied', analytics_Storage: 'granted' },
    ]);
  });

  it('starts on init when the visitor granted analytics on an earlier visit', () => {
    createClarityProvider({ projectId: 'k3x9m2abcd' }).init({ analytics_storage: 'granted' });
    expect(scripts()).toHaveLength(1);
  });

  it('adds the script once, however many times consent changes or init runs', () => {
    const provider = createClarityProvider({ projectId: 'k3x9m2abcd' });
    provider.init({ analytics_storage: 'granted' });
    provider.setConsent({ analytics_storage: 'granted' });
    createClarityProvider({ projectId: 'k3x9m2abcd' }).init({ analytics_storage: 'granted' });
    expect(scripts()).toHaveLength(1);
  });

  it('sends events and the page path while granted', () => {
    const provider = createClarityProvider({ projectId: 'k3x9m2abcd' });
    provider.init({ analytics_storage: 'granted' });
    provider.track('buy', { sku: 'A1' });
    provider.page('/cart', {});
    expect(queue().slice(1)).toEqual([
      ['event', 'buy'],
      ['set', 'page_path', '/cart'],
    ]);
  });

  it('tells Clarity to stop when analytics is denied afterwards, and sends nothing more', () => {
    const provider = createClarityProvider({ projectId: 'k3x9m2abcd' });
    provider.init({ analytics_storage: 'granted' });
    provider.setConsent({ analytics_storage: 'denied' });
    provider.track('after', {});
    expect(queue().at(-1)).toEqual([
      'consentv2',
      { ad_Storage: 'denied', analytics_Storage: 'denied' },
    ]);
    expect(queue().some((call) => call[0] === 'event')).toBe(false);
  });

  it('sends the user id only when asked to', () => {
    const off = createClarityProvider({ projectId: 'k3x9m2abcd' });
    off.init({ analytics_storage: 'granted' });
    off.identify('u1', { plan: 'pro' });
    expect(queue().some((call) => call[0] === 'identify')).toBe(false);
    reset();
    const on = createClarityProvider({ projectId: 'k3x9m2abcd', sendUserId: true });
    on.init({ analytics_storage: 'granted' });
    on.identify('u1', { plan: 'pro' });
    expect(queue().at(-1)).toEqual(['identify', 'u1']);
  });

  it('points at a different script host when asked', () => {
    createClarityProvider({
      projectId: 'k3x9m2abcd',
      scriptUrl: 'http://localhost:9000/tag/',
    }).init({
      analytics_storage: 'granted',
    });
    expect(scripts()[0]?.src).toBe('http://localhost:9000/tag/k3x9m2abcd');
  });
});

describe('the script address', () => {
  it('keeps the last path segment of a script URL with no trailing slash', () => {
    createClarityProvider({ projectId: 'k3x9m2abcd', scriptUrl: 'http://localhost:9000/tag' }).init(
      {
        analytics_storage: 'granted',
      },
    );
    expect(scripts()[0]?.src).toBe('http://localhost:9000/tag/k3x9m2abcd');
  });
});
