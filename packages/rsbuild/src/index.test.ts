import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRsbuild } from '@rsbuild/core';
import {
  createRemoteConfig,
  assertAsyncBoundary,
  createShellConfig,
  DEFAULT_SINGLETONS,
  installedVersionFrom,
  packageNameOf,
  remoteFederationOptions,
  resolvableFrom,
  sharedSingletons,
  shellFederationOptions,
  snapshotEnabled,
} from './index.js';

const all = () => true;
const only =
  (...names: string[]) =>
  (s: string) =>
    names.includes(s);

const resolvePath = (s: string) => `/abs/${s}`;

interface SharedEntry {
  name: string;
  singleton: boolean;
}

function isSharedList(value: unknown): value is SharedEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v: unknown) =>
        typeof v === 'object' &&
        v !== null &&
        'name' in v &&
        typeof v.name === 'string' &&
        'singleton' in v &&
        typeof v.singleton === 'boolean',
    )
  );
}

describe('sharedSingletons', () => {
  it('shares only the defaults the app can resolve, plus extras', () => {
    expect(sharedSingletons(only('react', 'react-dom', 'zustand'), ['zustand'])).toEqual({
      react: { singleton: true },
      'react-dom': { singleton: true },
      zustand: { singleton: true },
    });
    expect(Object.keys(sharedSingletons(all))).toEqual([...DEFAULT_SINGLETONS]);
  });

  it('throws for an extra that is not installed', () => {
    expect(() => sharedSingletons(only('react'), ['left-pad'])).toThrow(
      /"left-pad" cannot be resolved/,
    );
  });

  it('lists react-dom/client and the @mfeflow react subpaths', () => {
    for (const s of [
      'react-dom/client',
      'react/jsx-runtime',
      '@mfeflow/theme/react',
      '@mfeflow/i18n/react',
    ]) {
      expect(DEFAULT_SINGLETONS).toContain(s);
    }
  });

  it('pins requiredVersion to the installed version, not the package.json spec', () => {
    expect(sharedSingletons(only('react'), [], () => '19.3.1')).toEqual({
      react: { singleton: true, requiredVersion: '^19.3.1' },
    });
    const versionOf = installedVersionFrom(path.resolve(import.meta.dirname, '..'));
    expect(versionOf('react-dom/client')).toMatch(/^19\./);
    expect(versionOf('definitely-not-installed-xyz')).toBeUndefined();
    expect(packageNameOf('@mfeflow/theme/react')).toBe('@mfeflow/theme');
    expect(packageNameOf('react-dom/client')).toBe('react-dom');
  });

  it('resolves from a directory', () => {
    const canResolve = resolvableFrom(path.resolve(import.meta.dirname, '..'));
    expect(canResolve('react')).toBe(true);
    expect(canResolve('definitely-not-installed-xyz')).toBe(false);
  });
});

describe('remoteFederationOptions', () => {
  it('uses the external runtime, a manifest and generated types', () => {
    const o = remoteFederationOptions(
      { name: 'cart', exposes: { './App': './src/App.tsx' } },
      only('react'),
    );
    expect(o).toMatchObject({
      name: 'cart',
      exposes: { './App': './src/App.tsx' },
      manifest: true,
      dts: { generateTypes: true, consumeTypes: false },
      experiments: {
        externalRuntime: true,
        optimization: { disableRemote: true, target: 'web' },
      },
      shared: { react: { singleton: true } },
    });
    expect(o.shared.react).not.toHaveProperty('eager');
    expect(
      remoteFederationOptions({ name: 'cart', exposes: { './A': 'a' }, types: false }, all).dts,
    ).toBe(false);
  });

  it('keeps remote support when the remote consumes other remotes', () => {
    const o = remoteFederationOptions(
      { name: 'checkout', exposes: { './App': 'a' }, consumesRemotes: true },
      all,
    );
    expect(o.experiments.optimization).toEqual({ target: 'web' });
  });

  it('rejects bad names and empty exposes', () => {
    expect(() =>
      remoteFederationOptions({ name: 'Cart-App', exposes: { './A': 'a' } }, all),
    ).toThrow(/not a valid/);
    expect(() => remoteFederationOptions({ name: 'cart', exposes: {} }, all)).toThrow(
      /exposes nothing/,
    );
  });
});

const optimization = (env: Record<string, string>, snapshot?: boolean) =>
  shellFederationOptions(
    { name: 'shell', env, ...(snapshot === undefined ? {} : { snapshot }) },
    all,
    resolvePath,
  ).experiments.optimization;

describe('shellFederationOptions', () => {
  it('registers no static remotes, provides the runtime and adds the report plugin', () => {
    const o = shellFederationOptions({ name: 'shell', env: {} }, all, resolvePath);
    expect(o.remotes).toEqual({});
    expect(o.dts).toBe(false);
    expect(o.experiments.provideExternalRuntime).toBe(true);
    expect(o.runtimePlugins).toEqual([
      '/abs/@mfeflow/runtime/plugins/report',
      '/abs/@mfeflow/runtime/plugins/entry-retry',
    ]);
  });

  it('ships shared singletons eagerly unless told not to', () => {
    const eager = shellFederationOptions({ name: 'shell', env: {} }, only('react'), resolvePath);
    expect(eager.shared).toEqual({ react: { singleton: true, eager: true } });
    const lazy = shellFederationOptions(
      { name: 'shell', env: {}, eager: false },
      only('react'),
      resolvePath,
    );
    expect(lazy.shared).toEqual({ react: { singleton: true } });
  });

  it('targets the web, and drops the snapshot loader in production only', () => {
    expect(optimization({ NODE_ENV: 'production' })).toEqual({
      target: 'web',
      disableSnapshot: true,
    });
    expect(optimization({ NODE_ENV: 'development' })).toEqual({ target: 'web' });
    expect(optimization({})).toEqual({ target: 'web' });
    expect(optimization({ NODE_ENV: 'production' }, true)).toEqual({ target: 'web' });
    expect(optimization({ NODE_ENV: 'development' }, false)).toEqual({
      target: 'web',
      disableSnapshot: true,
    });
  });

  it('skips the report plugin when @mfeflow/runtime is not installed and keeps custom plugins', () => {
    const o = shellFederationOptions(
      { name: 'shell', runtimePlugins: ['/x.js'], env: {} },
      only('react'),
      resolvePath,
    );
    expect(o.runtimePlugins).toEqual(['/x.js']);
    expect(
      shellFederationOptions({ name: 'shell', env: {} }, only('react'), resolvePath).runtimePlugins,
    ).toEqual([]);
  });

  it('consumes remote types only in types builds', () => {
    const typesFrom = { cart: 'https://cdn.example.com/cart/1.0.0/mf-manifest.json' };
    expect(
      shellFederationOptions({ name: 'shell', typesFrom, env: {} }, all, resolvePath).remotes,
    ).toEqual({});
    const o = shellFederationOptions(
      { name: 'shell', typesFrom, env: { MFEFLOW_TYPES: '1' } },
      all,
      resolvePath,
    );
    expect(o.remotes).toEqual({ cart: `cart@${typesFrom.cart}` });
    expect(o.dts).toEqual({
      generateTypes: false,
      consumeTypes: { typesOnBuild: true, abortOnError: true },
    });
  });
});

describe('snapshotEnabled and the runtime flag', () => {
  it('follows NODE_ENV unless the option says otherwise', () => {
    expect(snapshotEnabled({ env: { NODE_ENV: 'production' } })).toBe(false);
    expect(snapshotEnabled({ env: { NODE_ENV: 'development' } })).toBe(true);
    expect(snapshotEnabled({ env: { NODE_ENV: 'production' }, snapshot: true })).toBe(true);
    expect(snapshotEnabled({ env: {}, snapshot: false })).toBe(false);
  });

  it('defines the flag the runtime reads in the shell config', () => {
    const cwd = path.resolve(import.meta.dirname, '..');
    const define = (env: Record<string, string>, snapshot?: boolean) =>
      createShellConfig({
        name: 'shell',
        cwd,
        env,
        ...(snapshot === undefined ? {} : { snapshot }),
      }).source?.define;
    expect(define({ NODE_ENV: 'production' })).toEqual({ __MFEFLOW_SNAPSHOT__: 'false' });
    expect(define({ NODE_ENV: 'production' }, true)).toEqual({ __MFEFLOW_SNAPSHOT__: 'true' });
    expect(define({ NODE_ENV: 'development' })).toEqual({ __MFEFLOW_SNAPSHOT__: 'true' });
  });
});

describe('createShellConfig', () => {
  it('turns on history fallback and the port', () => {
    const config = createShellConfig({
      name: 'shell',
      port: 3000,
      cwd: path.resolve(import.meta.dirname, '..'),
    });
    expect(config.server).toEqual({ historyApiFallback: true, port: 3000 });
    expect(config.plugins).toHaveLength(3);
    expect(
      createShellConfig({
        name: 'shell',
        esmRuntime: false,
        cwd: path.resolve(import.meta.dirname, '..'),
      }).plugins,
    ).toHaveLength(2);
  });
});

describe('eager: false', () => {
  it('needs an entry with a dynamic import', () => {
    expect(() => {
      assertAsyncBoundary(
        '/app/src/index.ts',
        () => "import { main } from './bootstrap';\nmain();",
      );
    }).toThrow(/eager: false needs an async bootstrap boundary.*import\('\.\/bootstrap'\)/s);
    expect(() => {
      assertAsyncBoundary('/app/src/index.ts', () => "void import('./bootstrap');");
    }).not.toThrow();
    expect(() => {
      assertAsyncBoundary('/app/src/index.ts', () => undefined);
    }).not.toThrow();
  });

  it('is checked by createShellConfig against the real entry file', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-eager-'));
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), "import './bootstrap';\n");
    expect(() => createShellConfig({ name: 'shell', cwd, eager: false })).toThrow(/import\(\)/);
    expect(() => createShellConfig({ name: 'shell', cwd })).not.toThrow();
    fs.writeFileSync(path.join(cwd, 'src/index.ts'), "void import('./bootstrap');\n");
    expect(() => createShellConfig({ name: 'shell', cwd, eager: false })).not.toThrow();
  });
});

describe('createRemoteConfig (real build)', () => {
  it('builds a remote with a manifest, shared react singletons and no bundled runtime', async () => {
    const fixture = path.resolve(import.meta.dirname, '../test/fixtures/remote');
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-rsbuild-'));
    const config = createRemoteConfig({
      name: 'fixture',
      exposes: { './App': './src/App.tsx' },
      types: false,
      cwd: fixture,
    });
    const rsbuild = await createRsbuild({
      cwd: fixture,
      rsbuildConfig: {
        ...config,
        output: { ...config.output, distPath: { root: dist } },
        logLevel: 'error',
      },
    });
    await rsbuild.build();
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(dist, 'mf-manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      name: 'fixture',
      exposes: [expect.objectContaining({ path: './App' })],
    });
    const shared: unknown =
      typeof manifest === 'object' && manifest !== null
        ? Reflect.get(manifest, 'shared')
        : undefined;
    if (!isSharedList(shared)) throw new Error('manifest has no shared list');
    expect(shared.filter((s) => s.singleton).map((s) => s.name)).toEqual(
      expect.arrayContaining(['react', 'react-dom', 'react-dom/client']),
    );
    fs.rmSync(dist, { recursive: true, force: true });
  }, 120_000);
});
