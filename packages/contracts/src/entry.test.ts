import { describe, expect, it } from 'vitest';
import { ENTRY_TYPES, GLOBAL_NAME, pickRegistryFields, REGISTRY_REMOTE_FIELDS } from './entry';

describe('entry constants', () => {
  it('has a global name pattern that takes MF names and refuses code', () => {
    for (const ok of ['cart', 'my-app', '$shell', 'a_1']) expect(GLOBAL_NAME.test(ok)).toBe(true);
    for (const bad of ['', '1a', 'a b', 'x";', 'a.b']) expect(GLOBAL_NAME.test(bad)).toBe(false);
  });

  it('lists each entry type once', () => {
    expect(new Set(ENTRY_TYPES).size).toBe(ENTRY_TYPES.length);
    expect(ENTRY_TYPES).toContain('module');
  });
});

describe('pickRegistryFields', () => {
  it('keeps whitelisted fields that are set and drops the rest', () => {
    const remote = {
      name: 'cart',
      entry: 'https://x.test/m.json',
      remoteEntry: undefined,
      exposes: { './App': ['https://x.test/a.js'] },
      extra: 1,
      routes: ['/cart'],
    };
    expect(pickRegistryFields(remote)).toEqual({
      name: 'cart',
      entry: 'https://x.test/m.json',
      routes: ['/cart'],
    });
    expect(Object.keys(pickRegistryFields(remote))).not.toContain('remoteEntry');
  });

  it('whitelists exactly the fields of a registry index remote', () => {
    expect([...REGISTRY_REMOTE_FIELDS].toSorted()).toEqual([
      'entry',
      'entryGlobalName',
      'name',
      'owner',
      'remoteEntry',
      'routes',
      'type',
      'version',
    ]);
  });
});
