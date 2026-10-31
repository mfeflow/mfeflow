import { describe, expect, it } from 'vitest';
import { comparable, unresolved } from './singletons';

describe('comparable', () => {
  it.each([
    ['19.3.1', '19.3.1'],
    ['^18.2.0', '18.2.0'],
    ['>=17 <19', '17.0.0'],
    ['~19.1', '19.1.0'],
  ])('reads %s as %s', (spec, expected) => {
    expect(comparable(spec)).toBe(expected);
  });

  it.each(['link:../react', 'workspace:*', 'workspace:^', 'catalog:', 'catalog:react19', 'latest'])(
    'does not throw on %s and says it has no version yet',
    (spec) => {
      expect(comparable(spec)).toBeUndefined();
    },
  );
});

describe('unresolved', () => {
  it('is a warning that names the specs and says to install', () => {
    const f = unresolved('singletons.versions', 'E301', 'react', ['shell link:../react']);
    expect(f).toMatchObject({ severity: 'warning', code: 'MFEFLOW_E301' });
    expect(f.message).toContain('react is shell link:../react');
    expect(f.message).toContain('until install');
  });
});
