import { CONSENT_KEYS, type ConsentUpdate, type ConsentValue } from './types';

export const CONSENT_STORAGE_KEY = 'mfeflow:consent';

export const GRANT_ALL: ConsentUpdate = {
  ad_storage: 'granted',
  analytics_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
};

export const DENY_ALL: ConsentUpdate = {
  ad_storage: 'denied',
  analytics_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
};

const isValue = (value: unknown): value is ConsentValue =>
  value === 'granted' || value === 'denied';

/** Keeps only the known signals with a valid value; anything else in stored or passed-in data is dropped. */
export function cleanConsent(input: unknown): ConsentUpdate {
  const out: ConsentUpdate = {};
  if (typeof input !== 'object' || input === null) return out;
  for (const key of CONSENT_KEYS) {
    const value: unknown = Reflect.get(input, key);
    if (isValue(value)) out[key] = value;
  }
  return out;
}

export function readStoredConsent(): ConsentUpdate {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    return raw === null ? {} : cleanConsent(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeStoredConsent(consent: ConsentUpdate): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // Storage is blocked or full; the choice still applies to this visit.
  }
}
