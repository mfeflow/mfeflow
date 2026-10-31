import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRsbuild } from '@rsbuild/core';
import {
  createRemoteConfig,
  createShellConfig,
  DEFAULT_SINGLETONS,
  remoteFederationOptions,
  resolvableFrom,
  sharedSingletons,
  shellFederationOptions,
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
      experiments: { externalRuntime: true },
      shared: { react: { singleton: true } },
    });
    expect(
      remoteFederationOptions({ name: 'cart', exposes: { './A': 'a' }, types: false }, all).dts,
    ).toBe(false);
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

describe('shellFederationOptions', () => {
  it('registers no static remotes, provides the runtime and adds the report plugin', () => {
    const o = shellFederationOptions({ name: 'shell', env: {} }, all, resolvePath);
    expect(o.remotes).toEqual({});
    expect(o.dts).toBe(false);
    expect(o.experiments).toEqual({ provideExternalRuntime: true });
    expect(o.runtimePlugins).toEqual(['/abs/@mfeflow/runtime/plugins/report']);
  });

  it('skips the report plugin when @mfeflow/runtime is not installed and keeps custom plugins', () => {
    const o = shellFederationOptions(
      { name: 'shell', runtimePlugins: ['/x.js'], env: {} },
      only('react'),
      resolvePath,
    );
    expect(o.runtimePlugins).toEqual(['/x.js']);
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

describe('createShellConfig', () => {
  it('turns on history fallback and the port', () => {
    const config = createShellConfig({
      name: 'shell',
      port: 3000,
      cwd: path.resolve(import.meta.dirname, '..'),
    });
    expect(config.server).toEqual({ historyApiFallback: true, port: 3000 });
    expect(config.plugins).toHaveLength(2);
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
