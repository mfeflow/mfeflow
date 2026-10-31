import { afterEach, describe, expect, it, vi } from 'vitest';

const registerRemotes = vi.fn();
vi.mock('@module-federation/enhanced/runtime', () => ({ registerRemotes }));

const { isRegistryIndex, loadRegistryIndex, registerRemotesFromIndex } =
  await import('./registry.js');

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
    expect(isRegistryIndex({ remotes: [{ name: 'a', entry: 'x', owner: 2 }] })).toBe(false);
  });
});

describe('loadRegistryIndex', () => {
  it('fetches and validates', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify(index))));
    await expect(
      loadRegistryIndex('https://registry.example.com/prod.json', { fetch: fetchFn }),
    ).resolves.toEqual(index);
  });

  it('uses an inlined index without fetching, unless told not to', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ remotes: [] }))));
    globalThis.mfeflowRegistry = index;
    try {
      await expect(loadRegistryIndex('u', { fetch: fetchFn })).resolves.toBe(index);
      expect(fetchFn).not.toHaveBeenCalled();
      await expect(loadRegistryIndex('u', { fetch: fetchFn, inline: false })).resolves.toEqual({
        remotes: [],
      });
      globalThis.mfeflowRegistry = { remotes: 'broken' };
      await expect(loadRegistryIndex('u', { fetch: fetchFn })).resolves.toEqual({ remotes: [] });
    } finally {
      globalThis.mfeflowRegistry = undefined;
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

  it('registers everything when no allowlist is given', () => {
    expect(registerRemotesFromIndex(index)).toEqual(['cart', 'catalog']);
  });
});
