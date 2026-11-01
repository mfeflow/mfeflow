import { describe, expect, it } from 'vitest';
import { artifactPrefix, buildIndex, HISTORY_LIMIT } from './build';
import {
  BASE_URL,
  filesFor,
  indexWith,
  input,
  manifestFor,
  mfe,
  shellManifest,
} from './fixtures/remote';

const codes = (r: ReturnType<typeof buildIndex>) => r.failures.map((f) => f.code);

describe('buildIndex', () => {
  it('adds a remote with URLs under its versioned folder and passes every gate', () => {
    const { index, failures } = buildIndex(input());
    expect(failures).toEqual([]);
    expect(index.env).toBe('prod');
    expect(index.generatedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(index.remotes).toEqual([
      {
        name: 'cart',
        entry: `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
        remoteEntry: `${BASE_URL}/cart/1.0.0/remoteEntry.js`,
        type: 'global',
        entryGlobalName: 'cart',
        exposes: { './App': [`${BASE_URL}/cart/1.0.0/static/js/App.js`] },
        version: '1.0.0',
        routes: ['/cart'],
        owner: 'team-cart',
      },
    ]);
  });

  it('keeps the other remotes and the shell, and replaces the same remote in place', () => {
    const other = {
      name: 'catalog',
      entry: `${BASE_URL}/catalog/2.0.0/mf-manifest.json`,
      routes: ['/shop'],
    };
    const old = {
      name: 'cart',
      entry: `${BASE_URL}/cart/0.9.0/mf-manifest.json`,
      version: '0.9.0',
      routes: ['/cart'],
    };
    const { index, failures } = buildIndex(
      input({ currentIndex: { ...indexWith(old, other), shell: 'https://app.example.com' } }),
    );
    expect(failures).toEqual([]);
    expect(index.shell).toBe('https://app.example.com');
    expect(index.remotes.map((r) => r.name)).toEqual(['cart', 'catalog']);
    expect(index.remotes[0]?.version).toBe('1.0.0');
  });

  it('encodes + in a version so keys and URLs need no escaping', () => {
    expect(artifactPrefix('cart', '1.4.2+a1b2c3d')).toBe('cart/1.4.2_a1b2c3d');
    const { index, failures } = buildIndex(input({ version: '1.4.2+a1b2c3d' }));
    expect(failures).toEqual([]);
    expect(index.remotes[0]?.entry).toBe(`${BASE_URL}/cart/1.4.2_a1b2c3d/mf-manifest.json`);
    expect(index.remotes[0]?.version).toBe('1.4.2+a1b2c3d');
  });

  it('leaves remoteEntry out when the manifest cannot say where its files are', () => {
    const manifest = manifestFor();
    const withGetter = {
      ...(manifest as object),
      metaData: { ...(manifest as { metaData: object }).metaData, getPublicPath: 'return "/x/"' },
    };
    const { index } = buildIndex(input({ manifest: withGetter, files: filesFor(manifest) }));
    expect(index.remotes[0]?.remoteEntry).toBeUndefined();
    expect(index.remotes[0]?.exposes).toBeUndefined();
  });

  describe('history', () => {
    it('records the version it replaces as previous and first in history', () => {
      const first = buildIndex(input({ version: '1.0.0' })).index;
      const second = buildIndex(input({ version: '1.1.0', currentIndex: first })).index;
      const remote = second.remotes[0];
      expect(remote?.previous).toBe('1.0.0');
      expect(remote?.history).toEqual(['1.0.0']);
    });

    it('keeps only the last 10', () => {
      let current = buildIndex(input({ version: '1.0.0' })).index;
      for (let minor = 1; minor <= 14; minor += 1)
        current = buildIndex(
          input({ version: `1.${String(minor)}.0`, currentIndex: current }),
        ).index;
      const remote = current.remotes[0];
      expect(remote?.version).toBe('1.14.0');
      expect(remote?.previous).toBe('1.13.0');
      expect(remote?.history).toHaveLength(HISTORY_LIMIT);
      expect(remote?.history?.[0]).toBe('1.13.0');
      expect(remote?.history?.at(-1)).toBe('1.4.0');
    });

    it('takes the limit as an option', () => {
      let current = buildIndex(input({ version: '1.0.0' })).index;
      for (let minor = 1; minor <= 5; minor += 1)
        current = buildIndex(
          input({ version: `1.${String(minor)}.0`, currentIndex: current, historyLimit: 2 }),
        ).index;
      expect(current.remotes[0]?.history).toEqual(['1.4.0', '1.3.0']);
    });

    it('drops the target from history when rolling back to an older version', () => {
      let current = buildIndex(input({ version: '1.0.0' })).index;
      current = buildIndex(input({ version: '1.1.0', currentIndex: current })).index;
      current = buildIndex(input({ version: '1.2.0', currentIndex: current })).index;
      const back = buildIndex(input({ version: '1.1.0', currentIndex: current })).index.remotes[0];
      expect(back?.previous).toBe('1.2.0');
      expect(back?.history).toEqual(['1.2.0', '1.0.0']);
    });

    it('does not touch history when the same version is deployed again', () => {
      let current = buildIndex(input({ version: '1.0.0' })).index;
      current = buildIndex(input({ version: '1.1.0', currentIndex: current })).index;
      const again = buildIndex(input({ version: '1.1.0', currentIndex: current })).index.remotes[0];
      expect(again?.previous).toBe('1.0.0');
      expect(again?.history).toEqual(['1.0.0']);
    });
  });

  describe('gates', () => {
    it('schema: a bad version, a bad route and a manifest for another remote', () => {
      const bad = buildIndex(input({ version: 'v 1' }));
      expect(codes(bad)).toContain('schema');
      const route = buildIndex(input({ remote: mfe('cart', ['cart']) }));
      expect(
        route.failures.some((f) => f.code === 'schema' && f.message.includes('routes[0]')),
      ).toBe(true);
      const other = buildIndex(input({ manifest: manifestFor('catalog') }));
      expect(other.failures.find((f) => f.code === 'schema')?.message).toBe(
        'cart@1.0.0: mf-manifest.json is for "catalog" but mfe.json names "cart"',
      );
    });

    it('route-overlap: names the remote, the routes and the version', () => {
      const taken = {
        name: 'checkout',
        entry: `${BASE_URL}/checkout/3.1.0/mf-manifest.json`,
        version: '3.1.0',
        routes: ['/cart/*'],
      };
      const result = buildIndex(input({ currentIndex: indexWith(taken) }));
      expect(codes(result)).toEqual(['route-overlap']);
      expect(result.failures[0]).toMatchObject({
        remote: 'cart',
        version: '1.0.0',
        route: '/cart',
        message: 'cart@1.0.0: route "/cart" overlaps route "/cart/*" of checkout@3.1.0',
      });
    });

    it('route-overlap: a remote may keep or change its own routes', () => {
      const own = {
        name: 'cart',
        entry: `${BASE_URL}/cart/0.9.0/mf-manifest.json`,
        routes: ['/cart/old'],
      };
      expect(buildIndex(input({ currentIndex: indexWith(own) })).failures).toEqual([]);
    });

    it('compat: the shell provides a react the remote does not accept', () => {
      const result = buildIndex(input({ shellManifest: shellManifest('18.3.1') }));
      expect(codes(result)).toEqual(['compat']);
      expect(result.failures[0]?.message).toBe(
        'cart@1.0.0: needs react ^19.0.0 (shared) but the shell provides 18.3.1',
      );
    });

    it('compat: falls back to workspace versions without a shell manifest', () => {
      const bad = buildIndex(
        input({ shellManifest: undefined, workspaceVersions: { react: '18.0.0' } }),
      );
      expect(codes(bad)).toEqual(['compat']);
      const good = buildIndex(
        input({ shellManifest: undefined, workspaceVersions: { react: '19.2.0' } }),
      );
      expect(good.failures).toEqual([]);
    });

    it('compat: checks mfe.json platform ranges too', () => {
      const remote = { ...mfe(), platform: { '@mfeflow/runtime': '^0.4.0' } };
      const shell = { shared: [{ name: '@mfeflow/runtime', version: '0.3.0' }] };
      const result = buildIndex(input({ remote, shellManifest: shell }));
      expect(result.failures[0]?.message).toContain(
        'needs @mfeflow/runtime ^0.4.0 (mfe.json platform)',
      );
    });

    it('budget: over mfe.json budgets.initialJsKb', () => {
      const manifest = manifestFor();
      const result = buildIndex(input({ files: filesFor(manifest, 6 * 1024, 4 * 1024) }));
      expect(codes(result)).toEqual(['budget']);
      expect(result.failures[0]?.message).toMatch(
        /^cart@1\.0\.0: loads \d+(\.\d)? KB of JS first; mfe\.json budgets\.initialJsKb is 8$/,
      );
    });

    it('budget: without an mfe.json budget the entry must fit the cost model remoteKb', () => {
      const { budgets: _budgets, ...remote } = mfe();
      const manifest = manifestFor();
      const big = buildIndex(input({ remote, files: filesFor(manifest, 12 * 1024) }));
      expect(big.failures[0]?.message).toContain('the cost model remoteKb is 10');
      const small = buildIndex(input({ remote, files: filesFor(manifest, 2048) }));
      expect(small.failures).toEqual([]);
      const custom = buildIndex(
        input({
          remote,
          files: filesFor(manifest, 2048),
          costModel: { lcpDeltaMs: 300, shellKb: 32, remoteKb: 1 },
        }),
      );
      expect(codes(custom)).toEqual(['budget']);
    });

    it('budget: a file missing from the build output cannot be measured', () => {
      const { 'remoteEntry.js': _entry, ...rest } = filesFor(manifestFor());
      const result = buildIndex(input({ files: rest }));
      expect(result.failures[0]?.message).toBe(
        'cart@1.0.0: cannot measure initial JS: remoteEntry.js is not in the build output',
      );
      const { 'static/js/App.js': _app, ...noApp } = filesFor(manifestFor());
      expect(buildIndex(input({ files: noApp })).failures[0]?.message).toContain(
        'static/js/App.js',
      );
      expect(buildIndex(input({ manifest: {} })).failures[0]?.message).toContain(
        'no usable remote entry',
      );
    });

    it('rollout: rejected, a static host cannot split traffic', () => {
      const result = buildIndex(
        input({ rollout: { candidate: '1.1.0', stable: '1.0.0', percent: 10 } }),
      );
      expect(codes(result)).toEqual(['rollout']);
      expect(result.failures[0]?.message).toContain('static host cannot split traffic');
    });

    it('reports every failed gate together', () => {
      const taken = {
        name: 'checkout',
        entry: `${BASE_URL}/checkout/1.0.0/mf-manifest.json`,
        routes: ['/cart'],
      };
      const result = buildIndex(
        input({
          currentIndex: indexWith(taken),
          shellManifest: shellManifest('18.0.0'),
          files: filesFor(manifestFor(), 20 * 1024),
          rollout: {},
        }),
      );
      expect(codes(result).toSorted()).toEqual(['budget', 'compat', 'rollout', 'route-overlap']);
    });
  });

  it('keeps the current generatedAt when none is given', () => {
    const result = buildIndex(
      input({ generatedAt: undefined, currentIndex: { generatedAt: 'then', remotes: [] } }),
    );
    expect(result.index.generatedAt).toBe('then');
    expect(buildIndex(input({ generatedAt: undefined })).index.generatedAt).toBeUndefined();
  });
});
