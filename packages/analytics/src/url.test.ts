import { describe, expect, it } from 'vitest';
import { scrubQuery } from './url';

describe('scrubQuery', () => {
  it('keeps campaign ids and plain params, drops personal data and secrets', () => {
    expect(
      scrubQuery('?utm_campaign=x&fbclid=f&name=Ann&phone=1&sid=1&auth=z&reset_token=t&q=shoes'),
    ).toBe('?utm_campaign=x&fbclid=f&sid=1&q=shoes');
  });

  it('drops a campaign param whose value is an email', () => {
    expect(scrubQuery('?utm_content=a%40b.com&utm_medium=cpc')).toBe('?utm_medium=cpc');
  });

  it('gives an empty string when nothing is left', () => {
    expect(scrubQuery('')).toBe('');
    expect(scrubQuery('?token=1')).toBe('');
  });
});
