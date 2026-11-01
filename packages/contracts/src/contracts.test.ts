import { describe, expect, it } from 'vitest';
import {
  isMfeflowProject,
  isMfeManifest,
  isPrivateHost,
  JSON_SCHEMAS,
  redactUrl,
  redactUrlsIn,
  isRegistryEntry,
  isRegistryIndex,
  MFE_NAME,
  SCHEMA_ALIASES,
  SCHEMA_URLS,
  validateMfeflowProject,
  validateMfeManifest,
  validateRegistryEntry,
  validateRegistryIndex,
} from '.';

const cart = {
  name: 'cart',
  owner: 'team-cart',
  contact: '#team-cart',
  shells: ['storefront'],
  routes: ['/cart'],
  exposes: ['./App', './MiniCart'],
  events: { publishes: [], consumes: ['cart.item-added.v1'] },
  analyticsEvents: ['cart_item_added'],
  budgets: { initialJsKb: 120, lcpMs: 2500 },
  platform: { react: '^19', '@mfeflow/runtime': '^0.1' },
};

const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('mfeflow.app.json event names', () => {
  it.each(['cart.item-added.v1', 'a.b.c.v3', 'checkout.order-placed.v12'])('accepts %s', (name) => {
    expect(validateMfeManifest({ ...cart, events: { publishes: [name], consumes: [] } })).toEqual(
      [],
    );
  });

  it.each([
    'cart.item-added',
    'cart.item-added.v0',
    'cart.item-added.1',
    'Cart.item.v1',
    'cart.item_added@1',
  ])('rejects %s', (name) => {
    expect(
      paths(validateMfeManifest({ ...cart, events: { publishes: [name], consumes: [] } })),
    ).toEqual(['events.publishes[0]']);
  });
});

describe('mfeflow.app.json', () => {
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

  it('keeps Module Federation names to words joined by single underscores', () => {
    for (const name of ['cart', 'cart2', 'order_history', 'a_b2_c'])
      expect(MFE_NAME.test(name)).toBe(true);
    // `cart_` and `cart` (or `a__b` and `a_b`) would turn into the same component name.
    for (const name of ['cart_', '_cart', 'a__b', 'a_1', 'Cart', '1a', ''])
      expect(MFE_NAME.test(name)).toBe(false);
    expect(paths(validateMfeManifest({ ...cart, name: 'cart_' }))).toEqual(['name']);
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
      'remotes[3].routes: route "/cart" of "promo" overlaps route "/cart" of "cart"',
      'remotes[4]: must be an object',
    ]);
    expect(validateRegistryIndex({})).toEqual([{ path: 'remotes', message: 'must be an array' }]);
    expect(validateRegistryIndex(1)).toHaveLength(1);
  });
});

describe('registry index route overlap', () => {
  const u = 'https://x.example.com/m.json';
  const messages = (remotes: unknown[]) =>
    validateRegistryIndex({ remotes }).map((i) => `${i.path}: ${i.message}`);

  it('names both remotes and both routes when a wildcard covers another remote route', () => {
    expect(
      messages([
        { name: 'checkout', entry: u, routes: ['/checkout/*'] },
        { name: 'payments', entry: u, routes: ['/checkout/pay'] },
      ]),
    ).toEqual([
      'remotes[1].routes: route "/checkout/pay" of "payments" overlaps route "/checkout/*" of "checkout"',
    ]);
  });

  it('catches a param route against a literal one, and lets one remote overlap itself', () => {
    expect(
      messages([
        { name: 'catalog', entry: u, routes: ['/p/:id', '/p/new'] },
        { name: 'promo', entry: u, routes: ['/p/42'] },
      ]),
    ).toEqual(['remotes[1].routes: route "/p/42" of "promo" overlaps route "/p/:id" of "catalog"']);
  });

  it('accepts hyphenated and upper-case global names, and keeps disjoint routes apart', () => {
    expect(
      messages([
        { name: 'my-app', entry: u, routes: ['/a/*'] },
        { name: 'Cart_2', entry: u, routes: ['/b'] },
      ]),
    ).toEqual([]);
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

  const withPort = (port: unknown) => ({
    ...project,
    apps: { ...project.apps, cart: { kind: 'remote', path: 'apps/cart', port } },
  });

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

  it('accepts the writer version and the repo kind, both optional', () => {
    expect(validateMfeflowProject({ ...project, cli: '0.5.0', repo: 'platform' })).toEqual([]);
    expect(validateMfeflowProject({ ...project, cli: '1.2.3-beta.1' })).toEqual([]);
    for (const repo of ['platform', 'shell', 'remote']) {
      expect(validateMfeflowProject({ ...project, repo }), repo).toEqual([]);
    }
  });

  it('rejects a bad writer version or repo kind', () => {
    expect(paths(validateMfeflowProject({ ...project, cli: 'latest' }))).toEqual(['cli']);
    expect(paths(validateMfeflowProject({ ...project, cli: 5 }))).toEqual(['cli']);
    expect(paths(validateMfeflowProject({ ...project, repo: 'mono' }))).toEqual(['repo']);
    expect(paths(validateMfeflowProject({ ...project, repo: 3 }))).toEqual(['repo']);
  });

  it('allows zero shells only in a remote repo', () => {
    const remoteOnly = { ...project, apps: { cart: project.apps.cart } };
    expect(paths(validateMfeflowProject(remoteOnly))).toEqual(['apps']);
    expect(paths(validateMfeflowProject({ ...remoteOnly, repo: 'platform' }))).toEqual(['apps']);
    expect(paths(validateMfeflowProject({ ...remoteOnly, repo: 'shell' }))).toEqual(['apps']);
    expect(validateMfeflowProject({ ...remoteOnly, repo: 'remote' })).toEqual([]);
  });

  it('checks the dev server port of an app', () => {
    expect(validateMfeflowProject(withPort(4311))).toEqual([]);
    expect(paths(validateMfeflowProject(withPort(0)))).toEqual(['apps.cart.port']);
    expect(paths(validateMfeflowProject(withPort(70000)))).toEqual(['apps.cart.port']);
    expect(paths(validateMfeflowProject(withPort(43.5)))).toEqual(['apps.cart.port']);
    expect(paths(validateMfeflowProject(withPort('4311')))).toEqual(['apps.cart.port']);
  });

  it('checks copied-file hashes and registries', () => {
    const hash = `sha256-${'a'.repeat(64)}`;
    expect(
      validateMfeflowProject({
        ...project,
        files: { 'apps/shell/src/a.ts': hash },
        registries: {
          '@acme': 'https://acme.dev/{name}.json',
          '@local': 'http://127.0.0.1:8080/{name}.json',
        },
      }),
    ).toEqual([]);
    expect(
      paths(
        validateMfeflowProject({
          ...project,
          files: { '../a.ts': hash, 'b.ts': 'sha256-short', 'c\\d.ts': hash },
          registries: {
            '@mfeflow': 'https://acme.dev/{name}.json',
            acme: 'https://acme.dev/{name}.json',
            '@ok': 'http://acme.dev/{name}.json',
            '@two': 'https://acme.dev/feature.json',
          },
        }),
      ),
    ).toEqual([
      'files.../a.ts',
      'files.b.ts',
      'files.c\\d.ts',
      'registries.@mfeflow',
      'registries.acme',
      'registries.@ok',
      'registries.@two',
    ]);
  });

  it('checks the local checkout path', () => {
    const withLocal = (local: unknown) => ({ ...project, local });
    for (const ok of [
      '../mfeflow',
      '../../a/b',
      '..',
      'vendor/mfeflow',
      '/abs/mfeflow',
      'C:/src/mfeflow',
    ]) {
      expect(validateMfeflowProject(withLocal(ok)), ok).toEqual([]);
    }
    for (const bad of [
      '',
      'C:x',
      'C:\\x',
      '/a/../b',
      'C:/a/./b',
      '//host/x',
      '..\\x',
      './a',
      'a/../b',
      'a//b',
      'a/',
      'a/..',
      4,
    ]) {
      expect(paths(validateMfeflowProject(withLocal(bad))), String(bad)).toEqual(['local']);
    }
  });

  it('checks the budget overrides', () => {
    const withBudget = (budget: unknown) => ({ ...project, budget });
    expect(
      validateMfeflowProject(withBudget({ shellKb: 40, remoteKb: 12, baselineKb: 90 })),
    ).toEqual([]);
    expect(paths(validateMfeflowProject(withBudget({ shellKb: 0, remoteKb: 'big' })))).toEqual([
      'budget.shellKb',
      'budget.remoteKb',
    ]);
    expect(paths(validateMfeflowProject(withBudget([])))).toEqual(['budget']);
  });

  it('checks the registry host and base URL', () => {
    const withRegistry = (registry: unknown) => ({ ...project, registry });
    for (const host of [
      'file:./site',
      'file:/srv/registry',
      'file:C:/site',
      's3://my-bucket',
      's3://my-bucket/a/b',
    ])
      expect(
        validateMfeflowProject(withRegistry({ host, baseUrl: 'http://localhost:4300' })),
      ).toEqual([]);
    for (const host of [
      './site',
      'file:',
      's3://',
      's3://key:secret@bucket',
      'https://x.test',
      's3://Bad_Bucket',
    ])
      expect(paths(validateMfeflowProject(withRegistry({ host })))).toEqual(['registry.host']);
    for (const baseUrl of [
      'cdn.example.com',
      'https://cdn.example.com/',
      'https://u:p@cdn.test',
      'https://cdn.test?x=1',
      'ftp://x.test',
      'https://cdn.test#',
      'https://cdn.test/a#frag',
      'http://cdn.test',
    ])
      expect(paths(validateMfeflowProject(withRegistry({ baseUrl })))).toEqual([
        'registry.baseUrl',
      ]);
    expect(paths(validateMfeflowProject(withRegistry([])))).toEqual(['registry']);
  });

  it('keeps the JSON schema in step with the registry check', () => {
    interface Pattern {
      pattern: string;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the schema's shape is fixed in json-schema.ts
    const schema = JSON_SCHEMAS.project as unknown as {
      properties: { registry: { properties: { host: Pattern; baseUrl: Pattern } } };
    };
    const { host, baseUrl } = schema.properties.registry.properties;
    expect(new RegExp(host.pattern).test('s3://my-bucket/prefix')).toBe(true);
    expect(new RegExp(host.pattern).test('s3://k:s@bucket')).toBe(false);
    expect(new RegExp(baseUrl.pattern).test('https://cdn.example.com')).toBe(true);
    expect(new RegExp(baseUrl.pattern).test('https://cdn.example.com/')).toBe(false);
    expect(new RegExp(baseUrl.pattern).test('https://u:p@cdn.test')).toBe(false);
    for (const ok of [
      'http://localhost',
      'http://localhost:4300',
      'http://127.0.0.1/x',
      'http://[::1]:80',
    ])
      expect(new RegExp(baseUrl.pattern).test(ok), ok).toBe(true);
    for (const bad of [
      'http://cdn.test',
      'https://cdn.test#',
      'https://cdn.test?a=1',
      'http://localhost.evil.test',
    ])
      expect(new RegExp(baseUrl.pattern).test(bad), bad).toBe(false);
  });

  it('publishes schema URLs', () => {
    expect(SCHEMA_URLS.mfe).toBe('https://mfeflow.github.io/mfeflow/schema/mfeflow-app.json');
  });

  it('keeps the old mfe.json schema URL as an alias of the app file schema', () => {
    expect(SCHEMA_ALIASES['https://mfeflow.github.io/mfeflow/schema/mfe.json']).toBe('mfe');
    for (const [alias, name] of Object.entries(SCHEMA_ALIASES)) {
      expect(Object.values(SCHEMA_URLS)).not.toContain(alias);
      expect(SCHEMA_URLS[name]).toBeDefined();
    }
  });

  it('accepts an app file whose $schema still names the old URL', () => {
    expect(
      validateMfeManifest({
        ...cart,
        $schema: 'https://mfeflow.github.io/mfeflow/schema/mfe.json',
      }),
    ).toEqual([]);
  });
});

describe('feature integrity in mfeflow.json', () => {
  const entry = (extra: object) => ({
    version: 1,
    topology: 'monorepo',
    packageManager: 'pnpm',
    scope: '@shopco',
    apps: { storefront: { kind: 'shell', path: 'apps/storefront' } },
    features: { '@someone/extra': { version: '1.0.0', ...extra } },
  });

  it('accepts a sha256 hash next to the feature', () => {
    const integrity = `sha256-${'ab'.repeat(32)}`;
    expect(validateMfeflowProject(entry({ integrity }))).toEqual([]);
  });

  it('rejects anything that is not a sha256 hash', () => {
    for (const bad of ['abc', 'sha1-abc', `sha256-${'AB'.repeat(32)}`, 7]) {
      expect(paths(validateMfeflowProject(entry({ integrity: bad }))), String(bad)).toEqual([
        'features.@someone/extra.integrity',
      ]);
    }
  });

  it('puts integrity in the published JSON schema', () => {
    const features = JSON_SCHEMAS.project.properties as Record<string, unknown>;
    expect(JSON.stringify(features.features)).toContain('integrity');
  });
});

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'app.localhost',
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '0.0.0.0',
    '[::1]',
    '[::]',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
    '[::ffff:7f00:1]',
    '[::ffff:c0a8:101]',
    '100.64.0.1',
    '100.100.100.200',
    '100.127.255.254',
    '192.0.0.1',
    '[::a9fe:a9fe]',
    '[::7f00:1]',
    '[64:ff9b::a9fe:a9fe]',
    '[64:ff9b::a00:1]',
    '[2002:a9fe:a9fe::1]',
    '[2002:c0a8:101::]',
    '[fec0::1]',
    '[febf::1]',
    'metadata.google.internal',
    'printer.local',
    'host.internal.',
  ])('is true for %s', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    'example.com',
    'acme.github.io',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '11.0.0.1',
    '[2606:4700::1111]',
    '[::ffff:808:808]',
    'localhost.example.com',
    '100.63.255.255',
    '100.128.0.1',
    '192.0.1.1',
    '[::808:808]',
    '[64:ff9b::808:808]',
    '[2002:808:808::1]',
    'internal.example.com',
    'local.dev',
  ])('is false for %s', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });

  it('agrees with what URL.hostname reports', () => {
    expect(isPrivateHost(new URL('http://[::1]:4010/x').hostname)).toBe(true);
    expect(isPrivateHost(new URL('http://0x7f.1/x').hostname)).toBe(true);
    expect(isPrivateHost(new URL('https://acme.dev/x').hostname)).toBe(false);
  });
});

describe('redactUrl', () => {
  it('stays fast on long query strings with no = in them', () => {
    const long = `https://r.test/{name}.json?${'%'.repeat(50_000)}`;
    const started = performance.now();
    expect(redactUrl(long)).toBe(long);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('keeps separators and values with = in them as they were', () => {
    expect(redactUrl('https://r.test/x?a=b=c;token=s&&d=')).toBe(
      'https://r.test/x?a=b=c;token=***&&d=',
    );
  });

  it('hides the value of token-like parameters and keeps the rest', () => {
    expect(redactUrl('https://r.dev/{name}.json?token=abc&v=2')).toBe(
      'https://r.dev/{name}.json?token=***&v=2',
    );
    for (const key of ['api_key', 'apikey', 'sig', 'Signature', 'auth', 'password', 'secret']) {
      expect(redactUrl(`https://r.dev/x?${key}=s3cret`), key).toBe(`https://r.dev/x?${key}=***`);
    }
    expect(redactUrl('https://r.dev/x?X-Amz-Signature=aa&X-Amz-Credential=bb&a=1')).toBe(
      'https://r.dev/x?X-Amz-Signature=***&X-Amz-Credential=***&a=1',
    );
  });

  it('also hides jwt, bearer, session, pat, access and code, but not look-alikes', () => {
    for (const key of ['jwt', 'bearer', 'session', 'pat', 'access', 'code', 'session_id']) {
      expect(redactUrl(`https://r.dev/x?${key}=s3cret`), key).toBe(`https://r.dev/x?${key}=***`);
    }
    expect(redactUrl('https://r.dev/x?path=/a&patch=1&codec=2&accessory=3')).toBe(
      'https://r.dev/x?path=/a&patch=1&codec=2&accessory=3',
    );
  });

  it('hides secrets in the fragment and after a semicolon', () => {
    expect(redactUrl('https://r.dev/x#access_token=abc&state=1')).toBe(
      'https://r.dev/x#access_token=***&state=1',
    );
    expect(redactUrl('https://r.dev/x?a=1;token=abc;b=2')).toBe(
      'https://r.dev/x?a=1;token=***;b=2',
    );
    expect(redactUrl('https://r.dev/x?a=1&sig=z#top')).toBe('https://r.dev/x?a=1&sig=***#top');
  });

  it('hides a user name and password', () => {
    expect(redactUrl('https://me:pw@r.dev/x')).toBe('https://***@r.dev/x');
  });

  it('leaves a URL without a secret as it is', () => {
    for (const url of ['https://r.dev/{name}.json', 'https://r.dev/x?page=2#top', 'not a url']) {
      expect(redactUrl(url)).toBe(url);
    }
  });

  it('cleans every URL in a sentence', () => {
    expect(redactUrlsIn('https://r.dev/a?token=1 answered 404, then http://x.dev/b?key=2')).toBe(
      'https://r.dev/a?token=*** answered 404, then http://x.dev/b?key=***',
    );
  });
});
