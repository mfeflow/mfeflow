import { describe, expect, it } from 'vitest';
import { validateRegistryEntry } from '@mfeflow/contracts';
import type { LoadedFeature, MfeflowProject } from '@mfeflow/core';
import { assetRoots } from './assets';
import { assertAppName, freePort, partsForApp, remoteGlue, routeComponent } from './glue';
import { thrown } from './testing';

const apps: MfeflowProject['apps'] = {
  shell: { kind: 'shell', path: 'apps/shell', port: 4300 },
  catalog: { kind: 'remote', path: 'apps/catalog', port: 4311 },
  cart: { kind: 'remote', path: 'apps/cart' },
};

describe('app names', () => {
  it('accepts a fresh Module Federation name', () => {
    expect(() => {
      assertAppName('checkout', apps);
    }).not.toThrow();
  });

  it.each([
    'Checkout',
    '1st',
    'my-app',
    'shell',
    'root',
    'remotes',
    'catalog',
    'cart_',
    'a__b',
    'a_1',
    '_a',
  ])('rejects "%s" with E215', (name) => {
    expect(
      thrown(() => {
        assertAppName(name, apps);
      }).code,
    ).toBe('MFEFLOW_E215');
  });
});

describe('ports and route names', () => {
  it('finds the first free port from the start', () => {
    expect(freePort({ apps }, 4311)).toBe(4312);
    expect(freePort({ apps }, 4300)).toBe(4301);
    expect(freePort({ apps: {} }, 4311)).toBe(4311);
  });

  it('names the route component after the remote', () => {
    expect(routeComponent('catalog')).toBe('CatalogRoute');
    expect(routeComponent('order_history')).toBe('OrderHistoryRoute');
  });

  it('gives every allowed name its own route component', () => {
    const names = ['cart', 'cart2', 'a', 'a1', 'ab', 'a_b', 'a_b2', 'a_bc', 'ab_c', 'a_b_c', 'abc'];
    for (const name of names) assertAppName(name);
    const components = names.map(routeComponent);
    expect(new Set(components).size).toBe(names.length);
  });
});

describe('remoteGlue', () => {
  const roots = assetRoots();
  const base = { roots, version: '0.1.0', remote: { name: 'checkout', port: 4313 } };

  it('writes a valid registry entry per environment, dev pointing at the dev server', async () => {
    const { manifest } = await remoteGlue({ ...base, registry: true, shells: [] });
    const files = manifest.files ?? [];
    expect(files.map((f) => f.to)).toEqual([
      'registry/envs/dev/checkout.json',
      'registry/envs/staging/checkout.json',
      'registry/envs/prod/checkout.json',
    ]);
    const entries = files.map((f): unknown => JSON.parse(f.content ?? ''));
    for (const entry of entries) expect(validateRegistryEntry(entry)).toEqual([]);
    expect(entries[0]).toMatchObject({ manifestUrl: 'http://localhost:4313/mf-manifest.json' });
    expect(entries[2]).toMatchObject({
      manifestUrl: 'https://app.example.com/mfe/checkout/mf-manifest.json',
    });
    expect(manifest.transforms).toEqual([]);
  });

  it('adds a route file and a route-table entry for each shell it is told about', async () => {
    const { manifest } = await remoteGlue({ ...base, registry: false, shells: ['shell', 'admin'] });
    expect(manifest.files?.map((f) => [f.target, f.to])).toEqual([
      ['shell', 'src/remotes/checkout.tsx'],
      ['admin', 'src/remotes/checkout.tsx'],
    ]);
    expect(manifest.files?.[0]?.content).toContain('export function CheckoutRoute()');
    expect(manifest.files?.[0]?.content).toContain('id="checkout/App"');
    expect(manifest.transforms).toMatchObject([
      {
        op: 'add-route',
        target: 'shell',
        path: '/checkout',
        component: 'CheckoutRoute',
        from: './checkout',
      },
      { op: 'add-route', target: 'admin' },
    ]);
  });
});

describe('partsForApp', () => {
  const feature: LoadedFeature = {
    trust: 'first-party',
    manifest: {
      name: 'demo',
      version: '1.0.0',
      requires: ['core'],
      files: [
        { to: 'a.ts', target: 'remotes', content: 'a' },
        { to: 'b.ts', target: 'shell', content: 'b' },
        { to: 'c.ts', content: 'c' },
      ],
      dependencies: [{ name: 'zod', range: '4', target: 'remotes' }],
      scripts: [{ name: 'x', command: 'y', target: 'shell' }],
    },
  };

  it('keeps the parts for one kind, retargeted at the app, and drops requirements', () => {
    const parts = partsForApp(feature, 'remotes', 'checkout');
    expect(parts?.manifest.files).toEqual([{ to: 'a.ts', target: 'checkout', content: 'a' }]);
    expect(parts?.manifest.dependencies).toEqual([{ name: 'zod', range: '4', target: 'checkout' }]);
    expect(parts?.manifest.scripts).toEqual([]);
    expect(parts?.manifest.requires).toBeUndefined();
    expect(partsForApp(feature, 'shell', 'admin')?.manifest.scripts).toEqual([
      { name: 'x', command: 'y', target: 'admin' },
    ]);
  });

  it('returns nothing when the feature has no part for that kind', () => {
    const rootOnly: LoadedFeature = {
      ...feature,
      manifest: { name: 'r', version: '1', files: [{ to: 'x', target: 'root', content: '' }] },
    };
    expect(partsForApp(rootOnly, 'remotes', 'checkout')).toBeUndefined();
  });
});
