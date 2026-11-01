import { describe, expect, it } from 'vitest';
import { registryRemoteIssues, ROUTE_OVERLAP, validateRegistryIndex } from './registry';
import { isPortableRelativePath } from './validate';

describe('isPortableRelativePath', () => {
  it.each(['a/b.js', 'cart/1.0.0_abc/static/js/App.js', '.well-known/x', 'console/a.js'])(
    'accepts %j',
    (value) => {
      expect(isPortableRelativePath(value)).toBe(true);
    },
  );

  it.each([
    '../a',
    '/a',
    'C:/a',
    'a/b:stream',
    'a:b',
    'CON',
    'con.txt',
    'a/NUL.js',
    'a/Com1',
    'lpt9.log',
    'a/aux/b',
    'a/b.',
    'a/b ',
  ])('rejects %j', (value) => {
    expect(isPortableRelativePath(value)).toBe(false);
  });
});

describe('route overlap issues', () => {
  const remote = (name: string, route: string) => ({
    name,
    entry: `https://x.test/${name}.json`,
    routes: [route],
  });

  it('carry a code so callers need not match the message', () => {
    const issues = validateRegistryIndex({ remotes: [remote('a', '/x/*'), remote('b', '/x/y')] });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ROUTE_OVERLAP);
  });

  it('leave other issues without a code', () => {
    const issues = validateRegistryIndex({ remotes: [{ name: 'a', entry: 'nope' }] });
    expect(issues.every((i) => i.code === undefined)).toBe(true);
  });

  it('accepts rolledBackFrom as a string only', () => {
    const base = { name: 'a', entry: 'https://x.test/a.json' };
    expect(registryRemoteIssues({ ...base, rolledBackFrom: '2.0.0' })).toEqual([]);
    expect(registryRemoteIssues({ ...base, rolledBackFrom: 2 })).toHaveLength(1);
  });
});
