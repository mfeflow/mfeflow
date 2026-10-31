import { describe, expect, it } from 'vitest';
import {
  isMfeflowProject,
  isMfeManifest,
  isRegistryEntry,
  isRegistryIndex,
  SCHEMA_URLS,
  validateMfeflowProject,
  validateMfeManifest,
  validateRegistryEntry,
  validateRegistryIndex,
} from './index.js';

const cart = {
  name: 'cart',
  owner: 'team-cart',
  contact: '#team-cart',
  shells: ['storefront'],
  routes: ['/cart'],
  exposes: ['./App', './MiniCart'],
  events: { publishes: [], consumes: ['cart.item_added@1'] },
  analyticsEvents: ['cart_item_added'],
  budgets: { initialJsKb: 120, lcpMs: 2500 },
  platform: { react: '^19', '@mfeflow/runtime': '^0.1' },
};

const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('mfe.json', () => {
  it('accepts a complete manifest', () => {
    expect(validateMfeManifest(cart)).toEqual([]);
    expect(isMfeManifest(cart)).toBe(true);
  });

  it('points at each bad field with a useful message', () => {
    const issues = validateMfeManifest({
      ...cart,
      name: 'Cart-App',
      routes: ['cart', '/cart', '/cart'],
      exposes: ['App'],
      events: { publishes: ['itemAdded'], consumes: [] },
      analyticsEvents: ['AddToCart'],
      budgets: { initialJsKb: 0 },
      platform: { react: 19 },
    });
    expect(paths(issues)).toEqual([
      'name',
      'routes[0]',
      'routes',
      'exposes[0]',
      'events.publishes[0]',
      'analyticsEvents[0]',
      'budgets.initialJsKb',
      'platform.react',
    ]);
    expect(issues[1]?.message).toBe('must start with "/"');
  });

  it('reports missing and wrong-typed fields', () => {
    expect(paths(validateMfeManifest({ name: 1, shells: 'x', exposes: [1] }))).toEqual([
      'name',
      'owner',
      'shells',
      'routes',
      'exposes[0]',
    ]);
    expect(validateMfeManifest(null)).toEqual([{ path: '', message: 'must be an object' }]);
    expect(
      paths(validateMfeManifest({ ...cart, events: 'x', budgets: { lcpMs: 'fast' } })),
    ).toEqual(['events', 'budgets.lcpMs']);
  });
});

describe('registry entry', () => {
  const entry = {
    version: '1.4.2+a1b2c3d',
    manifestUrl: 'https://cdn.example.com/mfe/cart/1.4.2+a1b2c3d/mf-manifest.json',
    previous: '1.4.1+9f8e7d6',
    rollout: { candidate: '1.4.2+a1b2c3d', stable: '1.4.1+9f8e7d6', percent: 25 },
  };

  it('accepts a valid entry and rejects bad ones', () => {
    expect(isRegistryEntry(entry)).toBe(true);
    expect(
      paths(
        validateRegistryEntry({
          ...entry,
          manifestUrl: 'ftp://x',
          rollout: { ...entry.rollout, percent: 120 },
        }),
      ),
    ).toEqual(['manifestUrl', 'rollout.percent']);
    expect(paths(validateRegistryEntry({ version: 'v 1' }))).toEqual(['version', 'manifestUrl']);
    expect(validateRegistryEntry([])).toHaveLength(1);
  });

  it('checks the entry script and per-expose files', () => {
    const files = {
      remoteEntry: 'https://cdn.example.com/mfe/cart/e.js',
      exposes: { './App': ['https://cdn.example.com/mfe/cart/a.js'] },
    };
    expect(isRegistryEntry({ ...entry, ...files })).toBe(true);
    expect(
      paths(
        validateRegistryEntry({
          ...entry,
          remoteEntry: 'e.js',
          exposes: { App: [], './Other': 'x', './Third': ['https://ok.example.com/a.js', 3] },
        }),
      ),
    ).toEqual(['remoteEntry', 'exposes.App', 'exposes../Other', 'exposes../Third[1]']);
  });

  it('checks the entry type and global name', () => {
    expect(isRegistryEntry({ ...entry, type: 'module', entryGlobalName: 'cart_v2' })).toBe(true);
    expect(paths(validateRegistryEntry({ ...entry, type: 3, entryGlobalName: '' }))).toEqual([
      'type',
      'entryGlobalName',
    ]);
    expect(
      paths(validateRegistryEntry({ ...entry, type: 'wasm', entryGlobalName: 'a b' })),
    ).toEqual(['type', 'entryGlobalName']);
    expect(paths(validateRegistryEntry({ ...entry, entryGlobalName: 'x"];alert(1);//' }))).toEqual([
      'entryGlobalName',
    ]);
    for (const type of ['var', 'esm', 'commonjs2', 'system'])
      expect(isRegistryEntry({ ...entry, type })).toBe(true);
  });
});

describe('registry index', () => {
  const index = {
    shell: 'storefront',
    env: 'prod',
    remotes: [
      { name: 'cart', entry: 'https://cdn.example.com/cart/mf-manifest.json', routes: ['/cart'] },
      {
        name: 'catalog',
        entry: 'https://cdn.example.com/catalog/mf-manifest.json',
        routes: ['/products/*'],
      },
    ],
  };

  it('accepts a valid index', () => {
    expect(isRegistryIndex(index)).toBe(true);
  });

  it('accepts and checks remoteEntry and per-expose files on remotes', () => {
    const remote = {
      name: 'cart',
      entry: 'https://cdn.example.com/cart/mf-manifest.json',
      remoteEntry: 'https://cdn.example.com/cart/e.js',
      exposes: { './App': ['https://cdn.example.com/cart/a.js'] },
    };
    expect(isRegistryIndex({ remotes: [remote] })).toBe(true);
    expect(
      paths(validateRegistryIndex({ remotes: [{ ...remote, remoteEntry: 'x', exposes: [] }] })),
    ).toEqual(['remotes[0].remoteEntry', 'remotes[0].exposes']);
  });

  it('accepts the global names Module Federation produces', () => {
    const entry = { version: '1.0.0', manifestUrl: 'https://cdn.example.com/cart/m.json' };
    for (const entryGlobalName of ['cart', 'Cart_v2', 'my-app', '$shell', '_x1'])
      expect(isRegistryEntry({ ...entry, entryGlobalName })).toBe(true);
    for (const entryGlobalName of ['1cart', 'a b', 'a.b', '-a'])
      expect(isRegistryEntry({ ...entry, entryGlobalName })).toBe(false);
  });

  it('checks the entry type and global name on remotes', () => {
    const remote = { name: 'cart', entry: 'https://cdn.example.com/cart/m.json' };
    expect(
      isRegistryIndex({ remotes: [{ ...remote, type: 'module', entryGlobalName: 'c' }] }),
    ).toBe(true);
    expect(paths(validateRegistryIndex({ remotes: [{ ...remote, type: 'a b' }] }))).toEqual([
      'remotes[0].type',
    ]);
    expect(
      paths(
        validateRegistryIndex({ remotes: [{ ...remote, type: 'wasm', entryGlobalName: 'a b' }] }),
      ),
    ).toEqual(['remotes[0].type', 'remotes[0].entryGlobalName']);
  });

  it('catches duplicates, route collisions and bad entries', () => {
    const issues = validateRegistryIndex({
      remotes: [
        ...index.remotes,
        { name: 'cart', entry: 'https://x.example.com/m.json' },
        { name: 'promo', entry: 'not a url', routes: ['/cart'] },
        'oops',
      ],
    });
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'remotes[2].name: duplicate remote "cart"',
      'remotes[3].entry: must be an http(s) URL',
      'remotes[3].routes: route "/cart" is already claimed by "cart"',
      'remotes[4]: must be an object',
    ]);
    expect(validateRegistryIndex({})).toEqual([{ path: 'remotes', message: 'must be an array' }]);
    expect(validateRegistryIndex(1)).toHaveLength(1);
  });
});

describe('mfeflow.json', () => {
  const project = {
    version: 1,
    topology: 'monorepo',
    packageManager: 'pnpm',
    scope: '@shopco',
    apps: {
      storefront: { kind: 'shell', path: 'apps/storefront' },
      cart: { kind: 'remote', path: 'apps/cart' },
    },
    features: {
      'analytics-gtm': { version: '0.3.0', options: { consentDefault: 'denied' } },
      '@someone/extra': { version: '1.0.0' },
    },
  };

  it('accepts a valid project', () => {
    expect(isMfeflowProject(project)).toBe(true);
  });

  it('rejects bad projects', () => {
    expect(
      paths(
        validateMfeflowProject({
          version: 2,
          topology: 'mono',
          packageManager: 'yarn',
          scope: 'shopco',
          apps: { Cart: { kind: 'widget', path: 'x' }, bad: 1 },
          features: { 'Analytics GTM': { version: '1' }, x: 'no' },
        }),
      ),
    ).toEqual([
      'version',
      'topology',
      'packageManager',
      'scope',
      'apps.Cart',
      'apps.Cart.kind',
      'apps.bad',
      'apps',
      'features.Analytics GTM',
      'features.x',
    ]);
    expect(validateMfeflowProject('x')).toHaveLength(1);
  });

  it('publishes schema URLs', () => {
    expect(SCHEMA_URLS.mfe).toBe('https://mfeflow.dev/schema/mfe.json');
  });
});
