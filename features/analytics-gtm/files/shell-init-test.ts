import { resetAnalyticsForTests } from '@mfeflow/analytics';
import { afterEach, describe, expect, it } from 'vitest';
import { startAnalytics } from './init';

function dataLayer(): unknown[] | undefined {
  const layer: unknown = Reflect.get(globalThis, 'dataLayer');
  return Array.isArray(layer) ? layer : undefined;
}

// gtag pushes the `arguments` object, which GTM reads and an array would not be.
const argumentsOf = (entry: unknown): unknown[] =>
  typeof entry === 'object' && entry !== null ? Object.values(entry) : [];

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__MFE_RUNTIME_CONFIG__');
  Reflect.deleteProperty(globalThis, 'dataLayer');
  document.head.innerHTML = '';
  resetAnalyticsForTests();
});

describe('startAnalytics', () => {
  it('stays off without a gtmId', async () => {
    Reflect.set(globalThis, '__MFE_RUNTIME_CONFIG__', { gtmId: '' });
    await startAnalytics();
    expect(dataLayer()).toBeUndefined();
    expect(document.querySelector('script[src*="gtm.js"]')).toBeNull();
  });

  it('pushes the consent defaults, then loads gtm.js once, however often it runs', async () => {
    Reflect.set(globalThis, '__MFE_RUNTIME_CONFIG__', { gtmId: 'GTM-TEST123' });
    await startAnalytics();
    await startAnalytics();
    expect(argumentsOf(dataLayer()?.[0]).slice(0, 2)).toEqual(['consent', 'default']);
    expect(document.querySelectorAll('script[src*="gtm.js?id=GTM-TEST123"]')).toHaveLength(1);
  });

  it('stays off when the id is not a container id', async () => {
    Reflect.set(globalThis, '__MFE_RUNTIME_CONFIG__', { gtmId: 'oops' });
    await startAnalytics();
    expect(dataLayer()).toBeUndefined();
  });
});
