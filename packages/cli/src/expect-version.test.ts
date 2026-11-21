import { describe, expect, it } from 'vitest';
import { assertExpectedVersion, expectedVersion } from './expect-version';

describe('expect-version', () => {
  it('reads only a string flag', () => {
    expect(expectedVersion({ 'expect-version': '1.2.3' })).toBe('1.2.3');
    expect(expectedVersion({ 'expect-version': true })).toBeUndefined();
    expect(expectedVersion({})).toBeUndefined();
  });

  it('passes when nothing was expected or the source matches', () => {
    expect(() => assertExpectedVersion({}, 'staging', 'cart', '2.0.0')).not.toThrow();
    expect(() =>
      assertExpectedVersion({ 'expect-version': '2.0.0' }, 'staging', 'cart', '2.0.0'),
    ).not.toThrow();
  });

  it('refuses with E510 when the source moved', () => {
    expect(() =>
      assertExpectedVersion({ 'expect-version': '1.0.0' }, 'staging', 'cart', '2.0.0'),
    ).toThrowError(expect.objectContaining({ code: 'MFEFLOW_E510' }));
  });
});
