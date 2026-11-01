import type { EventParams } from './types';

const PII_KEY =
  /^(e-?mail|phone|mobile|first_?name|last_?name|full_?name|name|address|ssn|dob|birth_?date|password|token)$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Drops personal data from event parameters, and says what it dropped. */
export function scrubPii(params: EventParams): { clean: EventParams; dropped: string[] } {
  const clean: EventParams = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (PII_KEY.test(key) || (typeof value === 'string' && EMAIL.test(value))) dropped.push(key);
    else clean[key] = value;
  }
  return { clean, dropped };
}
