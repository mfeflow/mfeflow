import {
  isRegistryIndexRemote,
  registryRemoteIssues,
  validateRegistryIndex,
} from '@mfeflow/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@module-federation/enhanced/runtime', () => ({ registerRemotes: vi.fn() }));

const { isRegistryRemote, loadRegistryIndex } = await import('./registry');

const U = 'https://cdn.example.com/cart/mf-manifest.json';
const E = 'https://cdn.example.com/cart/e.mjs';

const accepted: [string, unknown][] = [
  ['minimal', { name: 'cart', entry: U }],
  ['snake name', { name: 'order_status', entry: U }],
  ['hyphen name', { name: 'my-app', entry: U }],
  ['upper and dollar name', { name: '$Shell_2', entry: U }],
  [
    'remoteEntry, type and global',
    { name: 'cart', entry: U, remoteEntry: E, type: 'module', entryGlobalName: 'cart_g' },
  ],
  ['exposes', { name: 'cart', entry: U, exposes: { './App': [E], './Mini': [] } }],
  ['routes', { name: 'cart', entry: U, routes: ['/cart', '/checkout/*', '/p/:id'] }],
  ['version and owner', { name: 'cart', entry: U, version: '1.2.3+abc', owner: 'team-cart' }],
  ['unknown field', { name: 'cart', entry: U, future: true }],
];

const rejected: [string, unknown][] = [
  ['not an object', 'cart'],
  ['null', null],
  ['array', []],
  ['no name', { entry: U }],
  ['digit-led name', { name: '1cart', entry: U }],
  ['name with a space', { name: 'bad name', entry: U }],
  ['name with a dot', { name: 'a.b', entry: U }],
  ['non-string name', { name: 1, entry: U }],
  ['no entry', { name: 'cart' }],
  ['entry not a url', { name: 'cart', entry: 'not a url' }],
  ['entry not http', { name: 'cart', entry: 'javascript:alert(1)' }],
  ['remoteEntry not a url', { name: 'cart', entry: U, remoteEntry: 'e.js' }],
  ['unknown entry type', { name: 'cart', entry: U, type: 'wasm' }],
  ['bad global name', { name: 'cart', entry: U, entryGlobalName: 'x";' }],
  ['version not a string', { name: 'cart', entry: U, version: 2 }],
  ['owner not a string', { name: 'cart', entry: U, owner: 2 }],
  ['routes not an array', { name: 'cart', entry: U, routes: '/cart' }],
  ['route not a string', { name: 'cart', entry: U, routes: [1] }],
  ['route without a slash', { name: 'cart', entry: U, routes: ['cart'] }],
];

const badExposes: [string, unknown][] = [
  ['exposes not an object', { name: 'cart', entry: U, exposes: [E] }],
  ['expose key', { name: 'cart', entry: U, exposes: { App: [E] } }],
  ['expose files not an array', { name: 'cart', entry: U, exposes: { './App': E } }],
  ['expose file not a url', { name: 'cart', entry: U, exposes: { './App': ['a.js'] } }],
];

const load = (remote: unknown) =>
  loadRegistryIndex('/r.json', {
    fetch: () => Promise.resolve(new Response(JSON.stringify({ remotes: [remote] }))),
  });

describe('one registry remote shape', () => {
  it.each(accepted)('runtime and contracts accept: %s', async (_name, remote) => {
    expect(isRegistryRemote(remote)).toBe(true);
    expect(isRegistryIndexRemote(remote)).toBe(true);
    expect(registryRemoteIssues(remote)).toEqual([]);
    expect(validateRegistryIndex({ remotes: [remote] })).toEqual([]);
    expect((await load(remote)).remotes).toHaveLength(1);
  });

  it.each(rejected)('runtime and contracts reject: %s', async (_name, remote) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(isRegistryRemote(remote)).toBe(false);
    expect(isRegistryIndexRemote(remote)).toBe(false);
    expect(registryRemoteIssues(remote).length).toBeGreaterThan(0);
    expect(validateRegistryIndex({ remotes: [remote] }).length).toBeGreaterThan(0);
    expect((await load(remote)).remotes).toHaveLength(0);
  });

  it.each(badExposes)('contracts reject, the shell keeps the remote: %s', async (_name, remote) => {
    expect(isRegistryIndexRemote(remote)).toBe(false);
    expect(validateRegistryIndex({ remotes: [remote] }).length).toBeGreaterThan(0);
    expect((await load(remote)).remotes).toHaveLength(1);
  });
});
