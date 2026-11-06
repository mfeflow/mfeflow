import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertSafeKey, HostError } from './host';

const attempt = (key: string): HostError | undefined => {
  try {
    assertSafeKey(key);
    return undefined;
  } catch (error) {
    if (error instanceof HostError) return error;
    throw error;
  }
};

const segment = fc.constantFrom(
  'a',
  'b.js',
  '.',
  '..',
  '...',
  '',
  'x y',
  'C:',
  'con',
  '.hidden',
  'ü',
);
const keys = fc.array(segment, { minLength: 1, maxLength: 6 }).map((parts) => parts.join('/'));

describe('assertSafeKey fuzz', () => {
  it('throws nothing but HostError, for any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (key) => {
        attempt(key);
      }),
      { numRuns: 500 },
    );
  });

  it('never accepts a key with a dot segment, empty segment, backslash, NUL, colon or leading slash', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), keys), (key) => {
        if (attempt(key) !== undefined) return;
        expect(key.split('/').every((part) => part !== '' && part !== '.' && part !== '..')).toBe(
          true,
        );
        expect(key).not.toMatch(/[\\\0:]/);
        expect(key.startsWith('/')).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it('rejects a key that climbs out with .. wherever it sits', () => {
    const plain = fc.stringMatching(/^[a-z]{1,8}$/);
    fc.assert(
      fc.property(fc.array(plain, { maxLength: 3 }), fc.array(plain, { maxLength: 3 }), (a, b) => {
        expect(attempt([...a, '..', ...b].join('/'))).toBeInstanceOf(HostError);
      }),
      { numRuns: 200 },
    );
  });

  it('accepts plain relative paths', () => {
    const plain = fc
      .stringMatching(/^[a-z][a-z0-9_-]{0,8}$/)
      .filter((p) => !/^(con|prn|aux|nul|com\d|lpt\d)$/.test(p));
    fc.assert(
      fc.property(fc.array(plain, { minLength: 1, maxLength: 5 }), (parts) => {
        expect(attempt(parts.join('/'))).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });
});
