import { providerName, resetAnalyticsForTests, updateConsent } from '@mfeflow/analytics';
import { afterEach, describe, expect, it } from 'vitest';
import { startClarity } from './clarity';

const clarityScript = () => document.querySelector('script[src*="clarity.ms/tag/"]');

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__MFE_RUNTIME_CONFIG__');
  Reflect.deleteProperty(globalThis, 'clarity');
  document.head.innerHTML = '';
  resetAnalyticsForTests();
});

describe('startClarity', () => {
  it('stays off without a clarityId', async () => {
    Reflect.set(globalThis, '__MFE_RUNTIME_CONFIG__', { clarityId: '' });
    await startClarity();
    expect(providerName()).toBe('noop');
  });

  it('stays off when the id is not a Clarity project id', async () => {
    Reflect.set(globalThis, '__MFE_RUNTIME_CONFIG__', { clarityId: 'GTM-ABC123' });
    await startClarity();
    expect(providerName()).toBe('noop');
  });

  it('waits for consent, then loads the script once', async () => {
    Reflect.set(globalThis, '__MFE_RUNTIME_CONFIG__', { clarityId: 'k3x9m2abcd' });
    await startClarity();
    await startClarity();
    expect(providerName()).toBe('clarity');
    expect(clarityScript()).toBeNull();
    updateConsent({ analytics_storage: 'granted' });
    expect(document.querySelectorAll('script[src*="clarity.ms/tag/k3x9m2abcd"]')).toHaveLength(1);
  });
});
