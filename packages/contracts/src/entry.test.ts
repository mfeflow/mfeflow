import { describe, expect, it } from 'vitest';
import {
  ENTRY_TYPES,
  GLOBAL_NAME,
  isRemoteName,
  pickRegistryFields,
  registryRemoteIssues,
  REGISTRY_REMOTE_FIELDS,
} from './entry';

describe('entry constants', () => {
  it('has a global name pattern that takes MF names and refuses code', () => {
    for (const ok of ['cart', 'my-app', '$shell', 'a_1']) expect(GLOBAL_NAME.test(ok)).toBe(true);
    for (const bad of ['', '1a', 'a b', 'x";', 'a.b']) expect(GLOBAL_NAME.test(bad)).toBe(false);
  });

  it('refuses remote names that are object prototype keys', () => {
    for (const bad of ['__proto__', 'constructor', 'prototype'])
      expect(isRemoteName(bad)).toBe(false);
    expect(isRemoteName('cart')).toBe(true);
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
      exposes: { './App': ['https://x.test/a.js'] },
      routes: ['/cart'],
    });
    expect(Object.keys(pickRegistryFields(remote))).not.toContain('remoteEntry');
  });

  it('whitelists exactly the fields of a registry index remote', () => {
    expect([...REGISTRY_REMOTE_FIELDS].toSorted()).toEqual([
      'entry',
      'entryGlobalName',
      'exposes',
      'history',
      'name',
      'owner',
      'previous',
      'remoteEntry',
      'routes',
      'type',
      'version',
    ]);
  });
});

describe('registryRemoteIssues rollback fields', () => {
  const remote = { name: 'cart', entry: 'https://x.test/m.json' };

  it('accepts previous and history', () => {
    expect(
      registryRemoteIssues({ ...remote, previous: '1.0.0', history: ['1.0.0', '0.9.0'] }),
    ).toEqual([]);
  });

  it('names a bad previous and a bad history', () => {
    expect(registryRemoteIssues({ ...remote, previous: 3 })).toEqual([
      { path: 'previous', message: 'must be a string' },
    ]);
    expect(registryRemoteIssues({ ...remote, history: 'x' })).toEqual([
      { path: 'history', message: 'must be an array of strings' },
    ]);
    expect(registryRemoteIssues({ ...remote, history: ['1.0.0', 2] })).toEqual([
      { path: 'history[1]', message: 'must be a string' },
    ]);
  });
});
