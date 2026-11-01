import { describe, expect, it } from 'vitest';
import { assertUniqueTailwindPrefixes, tailwindPrefix } from './tailwind-prefix';

describe('tailwindPrefix', () => {
  it('keeps a name made of letters as it is', () => {
    expect(tailwindPrefix('cart')).toBe('cart');
    expect(tailwindPrefix('shell')).toBe('shell');
  });

  it('gives only lowercase letters, and a different prefix to names that would sanitise alike', () => {
    const names = ['cart_b', 'cartb', 'cart1', 'cart2', 'cart', 'cart_1'];
    const prefixes = names.map(tailwindPrefix);
    for (const prefix of prefixes) expect(prefix).toMatch(/^[a-z]+$/);
    expect(new Set(prefixes).size).toBe(names.length);
  });

  it('is the same every time, and has something to start from when the name has no letters', () => {
    expect(tailwindPrefix('cart1')).toBe(tailwindPrefix('cart1'));
    expect(tailwindPrefix('_1')).toMatch(/^app[a-z]{4}$/);
  });
});

describe('assertUniqueTailwindPrefixes', () => {
  it('accepts apps with different prefixes', () => {
    expect(() => {
      assertUniqueTailwindPrefixes(['shell', 'cart_b', 'cart1']);
    }).not.toThrow();
  });

  it('names both apps when two share a prefix', () => {
    expect(() => {
      assertUniqueTailwindPrefixes(['one', 'two'], () => 'same');
    }).toThrow(/"one" and "two".*"same"/);
  });
});
