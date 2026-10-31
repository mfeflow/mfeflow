import { describe, expect, it } from 'vitest';
import { isRegistryEntry, isRegistryIndex } from './registry';
import { assetsFromManifest } from './manifest-assets';

const url = 'https://cdn.example.com/mfe/cart/1.2.0/mf-manifest.json';

const manifest = {
  metaData: { publicPath: 'auto', remoteEntry: { name: 'static/js/cart.3ef8.js', path: '' } },
  exposes: [
    {
      path: './App',
      assets: {
        js: { sync: ['static/js/async/app.js', 'static/js/async/shared.js'], async: ['x.js'] },
        css: { sync: ['static/css/app.css'], async: [] },
      },
    },
    { path: './MiniCart', assets: { js: { sync: ['static/js/async/shared.js'], async: [] } } },
    { path: './Empty' },
    { notAnExpose: true },
  ],
};

const meta = (extra: object) => ({
  metaData: { remoteEntry: { name: 'e.js', path: '' }, ...extra },
});

describe('assetsFromManifest', () => {
  it('resolves the entry and each expose’s sync files against the manifest URL', () => {
    expect(assetsFromManifest(manifest, url)).toEqual({
      remoteEntry: 'https://cdn.example.com/mfe/cart/1.2.0/static/js/cart.3ef8.js',
      exposes: {
        './App': [
          'https://cdn.example.com/mfe/cart/1.2.0/static/css/app.css',
          'https://cdn.example.com/mfe/cart/1.2.0/static/js/async/app.js',
          'https://cdn.example.com/mfe/cart/1.2.0/static/js/async/shared.js',
        ],
        './MiniCart': ['https://cdn.example.com/mfe/cart/1.2.0/static/js/async/shared.js'],
        './Empty': [],
      },
    });
  });

  it('prefers an absolute publicPath and joins a non-empty entry path', () => {
    const out = assetsFromManifest(
      {
        metaData: {
          publicPath: 'https://static.example.com/cart/',
          remoteEntry: { name: 'entry.js', path: 'js' },
        },
        exposes: [],
      },
      url,
    );
    expect(out.remoteEntry).toBe('https://static.example.com/cart/js/entry.js');
  });

  it('carries the entry type and the global name', () => {
    const out = assetsFromManifest(
      {
        metaData: {
          globalName: 'cart_v2',
          remoteEntry: { name: 'e.mjs', path: '', type: 'module' },
        },
      },
      url,
    );
    expect(out).toMatchObject({ type: 'module', entryGlobalName: 'cart_v2' });
    expect(assetsFromManifest(manifest, url)).not.toHaveProperty('type');
    expect(assetsFromManifest(manifest, url)).not.toHaveProperty('entryGlobalName');
  });

  it('keeps a global name with a hyphen or dollar, as Module Federation emits', () => {
    for (const globalName of ['my-app', '$shell', 'Cart_2']) {
      const out = assetsFromManifest(
        { metaData: { globalName, remoteEntry: { name: 'e.js', path: '' } } },
        url,
      );
      expect(out.entryGlobalName).toBe(globalName);
    }
  });

  it('rejects a global name or entry type the registry would refuse', () => {
    expect(() => assetsFromManifest(meta({ globalName: 'a b' }), url)).toThrow(/globalName "a b"/);
    expect(() => assetsFromManifest(meta({ globalName: 'x";' }), url)).toThrow(/globalName/);
    expect(() =>
      assetsFromManifest({ metaData: { remoteEntry: { name: 'e.js', type: 'wasm' } } }, url),
    ).toThrow(/type "wasm"/);
  });

  it('produces an entry the registry validators accept', () => {
    const out = assetsFromManifest(
      {
        metaData: {
          globalName: 'my-app_v2',
          publicPath: 'auto',
          remoteEntry: { name: 'e.mjs', path: '', type: 'module' },
        },
        exposes: [],
      },
      url,
    );
    expect(isRegistryEntry({ version: '1.0.0', manifestUrl: url, ...out })).toBe(true);
    expect(isRegistryIndex({ remotes: [{ name: 'cart', entry: url, ...out }] })).toBe(true);
  });

  it.each([
    ['empty', '', 'https://cdn.example.com/mfe/cart/1.2.0/e.js'],
    ['dot', '.', 'https://cdn.example.com/mfe/cart/1.2.0/e.js'],
    ['dot-slash', './js', 'https://cdn.example.com/mfe/cart/1.2.0/js/e.js'],
    ['plain', 'js', 'https://cdn.example.com/mfe/cart/1.2.0/js/e.js'],
    ['trailing slash', 'js/', 'https://cdn.example.com/mfe/cart/1.2.0/js/e.js'],
    ['leading slash', '/js', 'https://cdn.example.com/mfe/cart/1.2.0/js/e.js'],
    ['both slashes', '/js/', 'https://cdn.example.com/mfe/cart/1.2.0/js/e.js'],
    ['only a slash', '/', 'https://cdn.example.com/mfe/cart/1.2.0/e.js'],
  ])('joins the entry path like Module Federation does: %s', (_label, dir, expected) => {
    const out = assetsFromManifest({ metaData: { remoteEntry: { name: 'e.js', path: dir } } }, url);
    expect(out.remoteEntry).toBe(expected);
  });

  it.each([
    ['auto', 'auto', 'https://cdn.example.com/mfe/cart/1.2.0/e.js'],
    ['empty', '', 'https://cdn.example.com/mfe/cart/1.2.0/e.js'],
    ['absolute', 'https://static.example.com/c/', 'https://static.example.com/c/e.js'],
    ['protocol-relative', '//static.example.com/c/', 'https://static.example.com/c/e.js'],
    ['root-relative', '/static/cart/', 'https://shop.example.com/static/cart/e.js'],
    ['relative', 'assets/', 'https://shop.example.com/checkout/assets/e.js'],
    ['without a trailing slash', '/static/cart', 'https://shop.example.com/static/carte.js'],
  ])('resolves a %s publicPath', (_label, publicPath, expected) => {
    const out = assetsFromManifest(
      { metaData: { publicPath, remoteEntry: { name: 'e.js', path: '' } } },
      url,
      { pageUrl: 'https://shop.example.com/checkout/' },
    );
    expect(out.remoteEntry).toBe(expected);
  });

  it('resolves a relative publicPath against the page in the entry and every expose file', () => {
    const out = assetsFromManifest(
      {
        metaData: { publicPath: '/static/cart/', remoteEntry: { name: 'e.js', path: 'js' } },
        exposes: [{ path: './App', assets: { js: { sync: ['a.js'] }, css: { sync: ['a.css'] } } }],
      },
      url,
      { pageUrl: 'https://shop.example.com/' },
    );
    expect(out.remoteEntry).toBe('https://shop.example.com/static/cart/js/e.js');
    expect(out.exposes).toEqual({
      './App': [
        'https://shop.example.com/static/cart/a.css',
        'https://shop.example.com/static/cart/a.js',
      ],
    });
    expect(isRegistryEntry({ version: '1.0.0', manifestUrl: url, ...out })).toBe(true);
    expect(isRegistryIndex({ remotes: [{ name: 'cart', entry: url, ...out }] })).toBe(true);
  });

  it('keeps a remote with a relative publicPath manifest-only without a page URL, and says why', () => {
    const out = assetsFromManifest(
      { metaData: { publicPath: '/static/cart/', remoteEntry: { name: 'e.js', path: '' } } },
      url,
    );
    expect(out.remoteEntry).toBeUndefined();
    expect(out.exposes).toEqual({});
    expect(out.manifestOnly).toMatch(/pageUrl/);
  });

  it('rejects a page URL that is not http(s)', () => {
    expect(() =>
      assetsFromManifest({ metaData: { publicPath: '/s/', remoteEntry: { name: 'e.js' } } }, url, {
        pageUrl: 'file:///index.html',
      }),
    ).toThrow(/page URL/);
  });

  it('keeps a remote manifest-only when metaData.getPublicPath is set, and says why', () => {
    const out = assetsFromManifest(
      {
        metaData: {
          publicPath: 'auto',
          getPublicPath: 'return window.cdn + "/cart/"',
          remoteEntry: { name: 'e.js', path: '', type: 'module' },
          globalName: 'cart',
        },
        exposes: [{ path: './App', assets: { js: { sync: ['a.js'] } } }],
      },
      url,
    );
    expect(out.remoteEntry).toBeUndefined();
    expect(out.exposes).toEqual({});
    expect(out.manifestOnly).toMatch(/getPublicPath/);
  });

  it('ignores an empty getPublicPath', () => {
    const out = assetsFromManifest(
      { metaData: { getPublicPath: '', remoteEntry: { name: 'e.js', path: '' } } },
      url,
    );
    expect(out.remoteEntry).toBe('https://cdn.example.com/mfe/cart/1.2.0/e.js');
    expect(out.manifestOnly).toBeUndefined();
  });

  it('throws a clear error on a manifest it cannot use', () => {
    expect(() => assetsFromManifest(manifest, 'cart/mf-manifest.json')).toThrow(/not an http/);
    expect(() => assetsFromManifest(null, url)).toThrow(/must be an object/);
    expect(() => assetsFromManifest({}, url)).toThrow(/no metaData/);
    expect(() => assetsFromManifest({ metaData: { remoteEntry: {} } }, url)).toThrow(
      /remoteEntry has no name/,
    );
    expect(assetsFromManifest({ metaData: { remoteEntry: { name: 'e.js' } } }, url)).toEqual({
      remoteEntry: 'https://cdn.example.com/mfe/cart/1.2.0/e.js',
      exposes: {},
    });
  });
});
