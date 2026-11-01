import { afterEach, describe, expect, it } from 'vitest';
import { CONSENT_STORAGE_KEY, DENY_ALL, GRANT_ALL, cleanConsent } from '.';
import { readStoredConsent } from './consent';

afterEach(() => {
  localStorage.clear();
});

describe('cleanConsent', () => {
  it('keeps the four signals with valid values', () => {
    expect(cleanConsent({ ...GRANT_ALL, extra: 'granted' })).toEqual(GRANT_ALL);
    expect(cleanConsent({ ad_storage: 'denied', analytics_storage: 1 })).toEqual({
      ad_storage: 'denied',
    });
  });

  it('returns nothing for input that is not an object', () => {
    for (const input of [null, undefined, 'granted', 3]) expect(cleanConsent(input)).toEqual({});
  });
});

describe('readStoredConsent', () => {
  it('reads what was stored', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(DENY_ALL));
    expect(readStoredConsent()).toEqual(DENY_ALL);
  });

  it('treats corrupt data as no choice', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, '{not json');
    expect(readStoredConsent()).toEqual({});
  });
});
