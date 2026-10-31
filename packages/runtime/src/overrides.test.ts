import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDevOverrides, OVERRIDE_STORAGE_KEY } from './overrides.js';

const index = {
  remotes: [
    {
      name: 'cart',
      entry: 'https://cdn.example.com/cart/1.0.0/mf-manifest.json',
      version: '1.0.0',
    },
    { name: 'catalog', entry: 'https://cdn.example.com/catalog/2.0.0/mf-manifest.json' },
  ],
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  sessionStorage.clear();
  globalThis.mfeflowReports = undefined;
  vi.restoreAllMocks();
});

describe('applyDevOverrides', () => {
  it('does nothing unless enabled', () => {
    expect(
      applyDevOverrides(index, {
        enabled: false,
        search: '?mfe-override=cart@http://localhost:4312/m.json',
      }),
    ).toBe(index);
  });

  it('ignores the override and reports it when overrides are disabled (production)', () => {
    const search = '?mfe-override=cart@http://localhost:4312/mf-manifest.json';
    expect(applyDevOverrides(index, { enabled: false, search })).toBe(index);
    expect(globalThis.mfeflowReports).toEqual([
      expect.objectContaining({ mfe: 'shell', where: 'override' }),
    ]);
    expect(sessionStorage.getItem(OVERRIDE_STORAGE_KEY)).toBeNull();
    globalThis.mfeflowReports = undefined;
    applyDevOverrides(index, { enabled: false, search: '' });
    expect(globalThis.mfeflowReports).toBeUndefined();
  });

  it('replaces the remote entry URL too, so the override wins', () => {
    const withEntry = {
      remotes: [
        { ...index.remotes[0]!, remoteEntry: 'https://cdn.example.com/cart/remoteEntry.js' },
      ],
    };
    const out = applyDevOverrides(withEntry, {
      enabled: true,
      search: '?mfe-override=cart@http://localhost:4312/mf-manifest.json',
    });
    expect(out.remotes[0]).toEqual({
      name: 'cart',
      entry: 'http://localhost:4312/mf-manifest.json',
      version: 'override',
    });
  });

  it('replaces and adds remotes from the query and persists them', () => {
    const out = applyDevOverrides(index, {
      enabled: true,
      search:
        '?mfe-override=cart@http://localhost:4312/mf-manifest.json,reviews@http://127.0.0.1:4400/mf-manifest.json',
    });
    expect(out.remotes).toEqual([
      { name: 'cart', entry: 'http://localhost:4312/mf-manifest.json', version: 'override' },
      index.remotes[1],
      { name: 'reviews', entry: 'http://127.0.0.1:4400/mf-manifest.json', version: 'override' },
    ]);
    const again = applyDevOverrides(index, { enabled: true, search: '' });
    expect(again.remotes[0]?.entry).toBe('http://localhost:4312/mf-manifest.json');
  });

  it('rejects hosts outside the allowlist and bad URLs, and reports them', () => {
    const out = applyDevOverrides(index, {
      enabled: true,
      search: '?mfe-override=cart@https://evil.example.net/m.json,catalog@not-a-url,@x,nameonly',
    });
    expect(out.remotes).toEqual(index.remotes);
    expect(globalThis.mfeflowReports?.map((r) => r.mfe)).toEqual(['cart', 'catalog']);
    expect(sessionStorage.getItem(OVERRIDE_STORAGE_KEY)).toBeNull();
  });

  it('honours custom hosts, resets, and ignores corrupt storage', () => {
    const preview = applyDevOverrides(index, {
      enabled: true,
      allowedHosts: ['preview.example.com'],
      search: '?mfe-override=cart@https://preview.example.com/pr-12/mf-manifest.json',
    });
    expect(preview.remotes[0]?.entry).toBe('https://preview.example.com/pr-12/mf-manifest.json');
    applyDevOverrides(index, { enabled: true, search: '?mfe-override=reset' });
    expect(sessionStorage.getItem(OVERRIDE_STORAGE_KEY)).toBeNull();
    sessionStorage.setItem(OVERRIDE_STORAGE_KEY, '{oops');
    expect(applyDevOverrides(index, { enabled: true, search: '' }).remotes).toEqual(index.remotes);
    sessionStorage.setItem(OVERRIDE_STORAGE_KEY, '{"cart":1}');
    expect(applyDevOverrides(index, { enabled: true, search: '' }).remotes).toEqual(index.remotes);
  });
});
