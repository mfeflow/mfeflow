import { assetsFromManifest, validateRegistryIndex } from '@mfeflow/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

const registerRemotes = vi.fn();
vi.mock('@module-federation/enhanced/runtime', () => ({ registerRemotes }));

const {
  DEFAULT_REGISTRY_URL,
  isRegistryIndex,
  loadRegistryIndex,
  REGISTRY_GLOBAL,
  registerRemotesFromIndex,
  registeredRemotes,
} = await import('./registry.js');

const index = {
  shell: 'storefront',
  env: 'prod',
  remotes: [
    {
      name: 'cart',
      entry: 'https://cdn.example.com/mfe/cart/1.0.0/mf-manifest.json',
      version: '1.0.0',
      routes: ['/cart'],
    },
    { name: 'catalog', entry: 'https://evil.example.net/catalog/mf-manifest.json' },
  ],
};

const hang = (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

afterEach(() => {
  registerRemotes.mockReset();
  globalThis.mfeflowReports = undefined;
  vi.restoreAllMocks();
});

describe('isRegistryIndex', () => {
  it('accepts valid indexes and rejects bad shapes', () => {
    expect(isRegistryIndex(index)).toBe(true);
    expect(isRegistryIndex({ remotes: [] })).toBe(true);
    expect(isRegistryIndex(null)).toBe(false);
    expect(isRegistryIndex({})).toBe(false);
    expect(isRegistryIndex({ remotes: [{ name: 'bad name', entry: 'x' }] })).toBe(false);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 1 }] })).toBe(false);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', routes: [1] }] })).toBe(false);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', version: 2 }] })).toBe(false);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', remoteEntry: 2 }] })).toBe(false);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', remoteEntry: 'y' }] })).toBe(true);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', owner: 2 }] })).toBe(false);
  });
});

describe('loadRegistryIndex', () => {
  it('fetches and validates', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(index))));
    await expect(loadRegistryIndex('/registry/prod.json', { fetch: fetchFn })).resolves.toEqual(
      index,
    );
    await expect(loadRegistryIndex(undefined, { fetch: fetchFn })).resolves.toEqual(index);
    expect(fetchFn.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/registry/prod.json',
      DEFAULT_REGISTRY_URL,
    ]);
  });

  it('refuses a cross-origin fallback fetch unless allowed', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(index))));
    const url = 'https://registry.example.com/prod.json';
    await expect(loadRegistryIndex(url, { fetch: fetchFn })).rejects.toThrow(/same-origin/);
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(
      loadRegistryIndex(url, { fetch: fetchFn, allowCrossOrigin: true }),
    ).resolves.toEqual(index);
  });

  it('times out a slow registry', async () => {
    await expect(loadRegistryIndex('/r.json', { fetch: hang, timeoutMs: 20 })).rejects.toThrow(
      /aborted/,
    );
  });

  it('uses an inlined index without fetching, unless told not to', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ remotes: [] }))));
    Reflect.set(globalThis, REGISTRY_GLOBAL, index);
    try {
      await expect(loadRegistryIndex('u', { fetch: fetchFn })).resolves.toBe(index);
      expect(fetchFn).not.toHaveBeenCalled();
      await expect(loadRegistryIndex('u', { fetch: fetchFn, inline: false })).resolves.toEqual({
        remotes: [],
      });
      Reflect.set(globalThis, REGISTRY_GLOBAL, { remotes: 'broken' });
      await expect(loadRegistryIndex('u', { fetch: fetchFn })).resolves.toEqual({ remotes: [] });
    } finally {
      Reflect.deleteProperty(globalThis, REGISTRY_GLOBAL);
    }
  });

  it('throws on HTTP errors and invalid bodies', async () => {
    await expect(
      loadRegistryIndex('u', { fetch: () => Promise.resolve(new Response('x', { status: 503 })) }),
    ).rejects.toThrow(/HTTP 503/);
    await expect(
      loadRegistryIndex('u', {
        fetch: () => Promise.resolve(new Response(JSON.stringify({ remotes: 'no' }))),
      }),
    ).rejects.toThrow(/not a valid index/);
  });
});

describe('registerRemotesFromIndex', () => {
  it('registers allowed remotes and reports the rest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const names = registerRemotesFromIndex(
      { remotes: [...index.remotes, { name: 'broken', entry: 'not a url' }] },
      { allowedOrigins: ['https://cdn.example.com/'] },
    );
    expect(names).toEqual(['cart']);
    expect(registerRemotes).toHaveBeenCalledWith([
      { name: 'cart', entry: 'https://cdn.example.com/mfe/cart/1.0.0/mf-manifest.json' },
    ]);
    expect(globalThis.mfeflowReports?.map((r) => [r.mfe, r.where])).toEqual([
      ['catalog', 'registry'],
      ['broken', 'registry'],
    ]);
  });

  it('passes the entry type and global name with a remoteEntry, and nothing extra with a manifest', () => {
    registerRemotesFromIndex({
      remotes: [
        {
          name: 'esm',
          entry: 'https://cdn.example.com/esm/m.json',
          remoteEntry: 'https://cdn.example.com/esm/e.mjs',
          type: 'module',
          entryGlobalName: 'esm_global',
        },
        { name: 'plain', entry: 'https://cdn.example.com/plain/m.json', type: 'module' },
      ],
    });
    expect(registerRemotes).toHaveBeenCalledWith([
      {
        name: 'esm',
        entry: 'https://cdn.example.com/esm/e.mjs',
        type: 'module',
        entryGlobalName: 'esm_global',
      },
      { name: 'plain', entry: 'https://cdn.example.com/plain/m.json' },
    ]);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', type: 1 }] })).toBe(false);
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', entryGlobalName: 1 }] })).toBe(
      false,
    );
    for (const bad of [{ type: 'wasm' }, { entryGlobalName: 'a b' }, { entryGlobalName: 'x";' }])
      expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', ...bad }] })).toBe(false);
    for (const type of ['var', 'esm', 'system'])
      expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', type }] })).toBe(true);
  });

  it('accepts what a manifest produces and what the contracts validator accepts', () => {
    for (const globalName of ['cart', 'my-app', '$shell', 'Cart_2']) {
      const assets = assetsFromManifest(
        {
          metaData: { globalName, remoteEntry: { name: 'e.mjs', path: '', type: 'module' } },
        },
        'https://cdn.example.com/cart/mf-manifest.json',
      );
      const remote = {
        name: 'cart',
        entry: 'https://cdn.example.com/cart/mf-manifest.json',
        ...assets,
      };
      expect(validateRegistryIndex({ remotes: [remote] })).toEqual([]);
      expect(isRegistryIndex({ remotes: [remote] })).toBe(true);
    }
  });

  it('registers the same remotes from the inlined index and from the fetched one', () => {
    const remote = {
      name: 'cart',
      entry: 'https://cdn.example.com/cart/m.json',
      remoteEntry: 'https://cdn.example.com/cart/e.mjs',
      type: 'module',
      entryGlobalName: 'cart_g',
      version: '1.2.3',
      owner: 'checkout',
      routes: ['/cart'],
    };
    registerRemotesFromIndex({ remotes: [remote] });
    const inlined = registeredRemotes();
    const exposes = { './App': ['https://cdn.example.com/cart/a.js'] };
    const fetched = { remotes: [{ ...remote, exposes }] };
    registerRemotesFromIndex(fetched);
    expect(registeredRemotes()).toEqual(inlined);
    expect(inlined).toEqual([remote]);
  });

  it('refuses and reports a manifest-only remote when the shell has no manifest loader', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const names = registerRemotesFromIndex(
      {
        remotes: [
          { name: 'cart', entry: 'https://cdn.example.com/cart/m.json' },
          {
            name: 'catalog',
            entry: 'https://cdn.example.com/catalog/m.json',
            remoteEntry: 'https://cdn.example.com/catalog/e.js',
          },
        ],
      },
      { snapshot: false },
    );
    expect(names).toEqual(['catalog']);
    expect(registerRemotes).toHaveBeenCalledWith([
      { name: 'catalog', entry: 'https://cdn.example.com/catalog/e.js' },
    ]);
    const report = globalThis.mfeflowReports?.[0];
    expect([report?.mfe, report?.where]).toEqual(['cart', 'registry']);
    expect(report?.message).toContain('MFE_NO_REMOTE_ENTRY');
  });

  it('reads the build-time flag when the option is absent', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const manifestOnly = { remotes: [{ name: 'cart', entry: 'https://cdn.example.com/c/m.json' }] };
    vi.stubGlobal('__MFEFLOW_SNAPSHOT__', false);
    expect(registerRemotesFromIndex(manifestOnly)).toEqual([]);
    vi.stubGlobal('__MFEFLOW_SNAPSHOT__', true);
    expect(registerRemotesFromIndex(manifestOnly)).toEqual(['cart']);
    vi.unstubAllGlobals();
    expect(registerRemotesFromIndex(manifestOnly)).toEqual(['cart']);
  });

  it('registers remoteEntry URLs in place of manifests and checks the origin of the URL it registers', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const names = registerRemotesFromIndex(
      {
        remotes: [
          {
            name: 'cart',
            entry: 'https://evil.example.net/cart/mf-manifest.json',
            remoteEntry: 'https://cdn.example.com/mfe/cart/remoteEntry.js',
          },
          {
            name: 'catalog',
            entry: 'https://cdn.example.com/mfe/catalog/mf-manifest.json',
            remoteEntry: 'https://evil.example.net/remoteEntry.js',
          },
        ],
      },
      { allowedOrigins: ['https://cdn.example.com'] },
    );
    expect(names).toEqual(['cart']);
    expect(registerRemotes).toHaveBeenCalledWith([
      { name: 'cart', entry: 'https://cdn.example.com/mfe/cart/remoteEntry.js' },
    ]);
    expect(globalThis.mfeflowReports?.map((r) => r.mfe)).toEqual(['catalog']);
  });

  it('registers everything when no allowlist is given', () => {
    expect(registerRemotesFromIndex(index)).toEqual(['cart', 'catalog']);
  });
});
