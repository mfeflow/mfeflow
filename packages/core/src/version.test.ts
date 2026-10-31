import { describe, expect, it } from 'vitest';
import { isPackageJson, readPackageJson } from './version';

describe('version', () => {
  it('reads this package.json', () => {
    expect(isPackageJson(readPackageJson())).toBe(true);
  });

  it('rejects values without a string name and version', () => {
    expect(isPackageJson(null)).toBe(false);
    expect(isPackageJson('mfeflow')).toBe(false);
    expect(isPackageJson({ name: 'x' })).toBe(false);
    expect(isPackageJson({ name: 'x', version: 1 })).toBe(false);
    expect(isPackageJson({ name: 'x', version: '1.0.0' })).toBe(true);
  });
});
