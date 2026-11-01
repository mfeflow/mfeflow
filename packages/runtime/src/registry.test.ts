import { assetsFromManifest, validateRegistryIndex } from '@mfeflow/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportRemoteError } from './report';
import { RUNTIME_CONFIG_KEY, resetRuntimeConfigForTests } from './runtime-config';

const registerRemotes = vi.fn();
vi.mock('@module-federation/enhanced/runtime', () => ({ registerRemotes }));

const {
  DEFAULT_REGISTRY_URL,
  INVALID_REMOTE,
  isRegistryIndex,
  isRegistryRemote,
  loadRegistryIndex,
  REGISTRY_FALLBACK,
  REGISTRY_GLOBAL,
  registerRemotesFromIndex,
  registeredRemotes,
  registrySources,
  registrySourcesFromConfig,
} = await import('./registry');

const U = 'https://cdn.example.com/m.json';

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
  it('checks the envelope only, so one bad remote does not invalidate the index', () => {
    expect(isRegistryIndex(index)).toBe(true);
    expect(isRegistryIndex({ remotes: [] })).toBe(true);
    expect(isRegistryIndex({ remotes: [{ name: 'bad name' }, null] })).toBe(true);
    expect(isRegistryIndex(null)).toBe(false);
    expect(isRegistryIndex({})).toBe(false);
    expect(isRegistryIndex({ remotes: 'broken' })).toBe(false);
  });
});

describe('isRegistryRemote', () => {
  it('accepts valid remotes and rejects bad shapes', () => {
    expect(isRegistryRemote(index.remotes[0])).toBe(true);
    expect(isRegistryRemote(null)).toBe(false);
    expect(isRegistryRemote({ name: 'bad name', entry: U })).toBe(false);
    expect(isRegistryRemote({ name: 'a', entry: 1 })).toBe(false);
    expect(isRegistryRemote({ name: 'a', entry: U, routes: [1] })).toBe(false);
    expect(isRegistryRemote({ name: 'a', entry: U, version: 2 })).toBe(false);
    expect(isRegistryRemote({ name: 'a', entry: U, remoteEntry: 2 })).toBe(false);
    expect(
      isRegistryRemote({ name: 'a', entry: U, remoteEntry: 'https://cdn.example.com/e.js' }),
    ).toBe(true);
    expect(isRegistryRemote({ name: 'a', entry: U, owner: 2 })).toBe(false);
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
      /timed out after \d+ ms/,
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

const reported = () => globalThis.mfeflowReports?.map((r) => [r.mfe, r.where]);

const respond = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body)));

describe('a bad remote in the index', () => {
  const mixed = {
    remotes: [
      { name: 'cart', entry: 'https://cdn.example.com/cart/mf-manifest.json', type: 'wasm' },
      { name: 'catalog', entry: 'https://cdn.example.com/catalog/mf-manifest.json' },
      { name: 'bad name', entry: U },
    ],
  };
  const expected = { remotes: [mixed.remotes[1]] };

  it('is skipped and reported from the fetched index; the good remote stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(mixed))));
    await expect(loadRegistryIndex('/r.json', { fetch: fetchFn })).resolves.toEqual(expected);
    expect(reported()).toEqual([
      ['cart', 'registry'],
      ['bad name', 'registry'],
    ]);
    expect(globalThis.mfeflowReports?.[0]?.message).toContain(INVALID_REMOTE);
    expect(globalThis.mfeflowReports?.[0]?.message).toContain('type');
  });

  it('keeps a remote whose exposes are malformed, since the shell never reads them', async () => {
    const remote = { name: 'cart', entry: U, exposes: { './App': ['not-a-url'] } };
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ remotes: [remote] }))),
    );
    await expect(loadRegistryIndex('/r.json', { fetch: fetchFn })).resolves.toEqual({
      remotes: [remote],
    });
    expect(reported() ?? []).toEqual([]);
  });

  it('is skipped and reported from the inlined index', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Reflect.set(globalThis, REGISTRY_GLOBAL, mixed);
    try {
      await expect(loadRegistryIndex('u')).resolves.toEqual(expected);
      expect(reported()).toEqual([
        ['cart', 'registry'],
        ['bad name', 'registry'],
      ]);
    } finally {
      Reflect.deleteProperty(globalThis, REGISTRY_GLOBAL);
    }
  });

  it('names a remote without a usable name as unnamed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      loadRegistryIndex('/r.json', { fetch: respond({ remotes: [42, {}] }) }),
    ).resolves.toEqual({
      remotes: [],
    });
    expect(reported()).toEqual([
      ['(unnamed)', 'registry'],
      ['(unnamed)', 'registry'],
    ]);
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
    expect(isRegistryRemote({ name: 'a', entry: U, type: 1 })).toBe(false);
    expect(isRegistryRemote({ name: 'a', entry: U, entryGlobalName: 1 })).toBe(false);
    for (const bad of [{ type: 'wasm' }, { entryGlobalName: 'a b' }, { entryGlobalName: 'x";' }])
      expect(isRegistryRemote({ name: 'a', entry: U, ...bad })).toBe(false);
    for (const type of ['var', 'esm', 'system'])
      expect(isRegistryRemote({ name: 'a', entry: U, type })).toBe(true);
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
      expect(isRegistryRemote(remote)).toBe(true);
    }
  });

  it('keeps exposes only on the fetched index, which the inlined HTML leaves out', () => {
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
    expect(inlined).toEqual([remote]);
    expect(registeredRemotes()).toEqual([{ ...remote, exposes }]);
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

describe('loadRegistryIndex with a fallback', () => {
  const CDN = 'https://cdn.example.com';
  const sources = ['/registry/index.json', `${CDN}/registry/index.json`];
  const withCdn = { allowedOrigins: [CDN] };
  const isCdn = (url: string | URL | Request) =>
    new URL(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      'https://shop.test',
    ).origin === CDN;
  const ok = () => Promise.resolve(new Response(JSON.stringify(index)));
  const answer = (primary: () => Promise<Response>) =>
    vi.fn((url: string | URL | Request) => (isCdn(url) ? ok() : primary()));
  const fallbackReports = () =>
    (globalThis.mfeflowReports ?? []).filter((r) => r.message.includes(REGISTRY_FALLBACK));

  it('uses the fallback when the primary answers 5xx, and reports it once', async () => {
    const fetchFn = answer(() => Promise.resolve(new Response('x', { status: 500 })));
    await expect(loadRegistryIndex(sources, { fetch: fetchFn, ...withCdn })).resolves.toEqual(
      index,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fallbackReports()).toHaveLength(1);
    expect(fallbackReports()[0]?.message).toContain('HTTP 500');
  });

  it('uses the fallback when the primary does not answer in time', async () => {
    const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      isCdn(url) ? ok() : hang(url, init),
    );
    await expect(
      loadRegistryIndex(sources, { fetch: fetchFn, primaryTimeoutMs: 20, ...withCdn }),
    ).resolves.toEqual(index);
    expect(fallbackReports()[0]?.message).toContain('timed out after 20 ms');
  });

  it('gives the last URL what the primary left of the budget', async () => {
    const error = await loadRegistryIndex(sources, {
      fetch: hang,
      primaryTimeoutMs: 10,
      timeoutMs: 400,
      ...withCdn,
    }).catch((e: unknown) => e);
    const waits = [...String(error).matchAll(/timed out after (\d+) ms/g)].map((m) => Number(m[1]));
    expect(waits[0]).toBe(10);
    // Whatever the primary left of the 400 ms budget: less than the whole, more than nothing.
    // A busy CI machine can spend a lot of it before the fallback starts, so no tighter bound.
    expect(waits[1]).toBeGreaterThan(0);
    expect(waits[1]).toBeLessThan(400);
  });

  it('uses the fallback when the primary body is not JSON', async () => {
    const fetchFn = answer(() => Promise.resolve(new Response('<html>')));
    await expect(loadRegistryIndex(sources, { fetch: fetchFn, ...withCdn })).resolves.toEqual(
      index,
    );
    expect(fallbackReports()[0]?.message).toContain('not valid JSON');
  });

  it('uses the fallback when the primary is not a valid envelope or the network fails', async () => {
    const envelope = answer(() => Promise.resolve(new Response(JSON.stringify({ remotes: 1 }))));
    await expect(loadRegistryIndex(sources, { fetch: envelope, ...withCdn })).resolves.toEqual(
      index,
    );
    const network = answer(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(loadRegistryIndex(sources, { fetch: network, ...withCdn })).resolves.toEqual(
      index,
    );
  });

  it('does not report a fallback when the primary works, and skips invalid remotes as before', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ remotes: [{ name: 'bad name' }] }))),
    );
    await expect(loadRegistryIndex(sources, { fetch: fetchFn, ...withCdn })).resolves.toEqual({
      remotes: [],
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fallbackReports()).toHaveLength(0);
  });

  it('fails with every reason when all URLs fail', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('x', { status: 503 })));
    await expect(loadRegistryIndex(sources, { fetch: fetchFn, ...withCdn })).rejects.toThrow(
      /every source failed \(registry index \/registry\/index.json: HTTP 503; registry index https:\/\/cdn.example.com\/registry\/index.json: HTTP 503\)/,
    );
  });

  it('refuses a fallback on an origin that is not allowed, without fetching it', async () => {
    const fetchFn = answer(() => Promise.resolve(new Response('x', { status: 500 })));
    await expect(loadRegistryIndex(sources, { fetch: fetchFn })).rejects.toThrow(
      /cdn\.example\.com.*must be same-origin or in allowedOrigins/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(
      loadRegistryIndex(sources, { fetch: fetchFn, allowedOrigins: ['https://other.example.com'] }),
    ).rejects.toThrow(/allowedOrigins/);
  });

  it('refuses a URL that is not a URL', async () => {
    const fetchFn = vi.fn(ok);
    await expect(loadRegistryIndex('http://', { fetch: fetchFn })).rejects.toThrow(
      /allowedOrigins/,
    );
    await expect(loadRegistryIndex([], { fetch: fetchFn })).rejects.toThrow(/no URL/);
  });

  it('lets the inline index win over every URL', async () => {
    const fetchFn = vi.fn(ok);
    Reflect.set(globalThis, REGISTRY_GLOBAL, index);
    try {
      await expect(loadRegistryIndex(sources, { fetch: fetchFn, ...withCdn })).resolves.toBe(index);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(globalThis, REGISTRY_GLOBAL);
    }
  });
});

describe('registrySourcesFromConfig', () => {
  it('defaults to the same-origin index', () => {
    expect(registrySourcesFromConfig({})).toEqual({
      urls: [DEFAULT_REGISTRY_URL],
      allowedOrigins: [],
    });
  });

  it('reads the URLs and origins, dropping anything that is not a string URL', () => {
    expect(
      registrySourcesFromConfig({
        registryUrls: ['https://cdn.example.com/index.json', 3, ''],
        registryOrigins: ['https://cdn.example.com/some/path', 'nope', 7],
      }),
    ).toEqual({
      urls: ['https://cdn.example.com/index.json'],
      allowedOrigins: ['https://cdn.example.com'],
    });
  });

  it('drops origins that are not http(s), which would be the opaque "null" origin', () => {
    const config = {
      registryOrigins: ['data:,x', 'blob:https://a.test/1', 'javascript:x', 'https://ok.test'],
    };
    expect(registrySourcesFromConfig(config).allowedOrigins).toEqual(['https://ok.test']);
  });
});

describe('registrySources', () => {
  afterEach(() => {
    resetRuntimeConfigForTests();
    Reflect.deleteProperty(globalThis, REGISTRY_GLOBAL);
    vi.useRealTimers();
  });

  it('uses an inlined runtime config without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    Reflect.set(globalThis, RUNTIME_CONFIG_KEY, { registryOrigins: ['https://cdn.test'] });
    await expect(registrySources()).resolves.toEqual({
      urls: [DEFAULT_REGISTRY_URL],
      allowedOrigins: ['https://cdn.test'],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches nothing when the index is inlined', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    Reflect.set(globalThis, REGISTRY_GLOBAL, index);
    await expect(registrySources()).resolves.toEqual({
      urls: [DEFAULT_REGISTRY_URL],
      allowedOrigins: [],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads the config file when it answers in time', async () => {
    const config = {
      registryUrls: ['https://cdn.test/index.json'],
      registryOrigins: ['https://cdn.test'],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(config)));
    await expect(registrySources()).resolves.toEqual({
      urls: ['https://cdn.test/index.json'],
      allowedOrigins: ['https://cdn.test'],
    });
  });

  it('stops waiting for a config file that hangs, and for one that fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => undefined));
    const hung = registrySources(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(hung).resolves.toEqual({ urls: [DEFAULT_REGISTRY_URL], allowedOrigins: [] });
    vi.useRealTimers();
    resetRuntimeConfigForTests();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(registrySources()).resolves.toEqual({
      urls: [DEFAULT_REGISTRY_URL],
      allowedOrigins: [],
    });
  });
});

describe('a redirected registry index', () => {
  it('is refused when the redirect lands on an origin that is not allowed', async () => {
    const res = new Response(JSON.stringify(index));
    Object.defineProperty(res, 'redirected', { value: true });
    Object.defineProperty(res, 'url', { value: 'https://evil.test/index.json' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      loadRegistryIndex('https://cdn.example.com/index.json', {
        fetch: () => Promise.resolve(res),
        allowedOrigins: ['https://cdn.example.com'],
      }),
    ).rejects.toThrow(/redirected to https:\/\/evil\.test\/index\.json/);
  });
});

describe('versions in reports', () => {
  it('says cart@1.0.0 once the registry gave cart a version', async () => {
    registerRemotesFromIndex(index, { allowedOrigins: ['https://cdn.example.com'] });
    const report = reportRemoteError('cart', 'load', new Error('boom'));
    expect(report.version).toBe('1.0.0');
    expect(globalThis.mfeflowReports?.at(-1)?.version).toBe('1.0.0');
    expect(reportRemoteError('unknown', 'load', new Error('boom')).version).toBeUndefined();
    registerRemotesFromIndex({ remotes: [] });
    expect(reportRemoteError('cart', 'load', new Error('boom')).version).toBeUndefined();
  });
});
