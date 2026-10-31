import { describe, expect, it } from 'vitest';
import { assetsFromManifest } from './manifest-assets.js';

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
    ['root-relative', '/static/cart/', 'https://cdn.example.com/static/cart/e.js'],
    ['relative', 'assets/', 'https://cdn.example.com/mfe/cart/1.2.0/assets/e.js'],
    ['absolute', 'https://static.example.com/c/', 'https://static.example.com/c/e.js'],
  ])('resolves a %s publicPath', (_label, publicPath, expected) => {
    const out = assetsFromManifest(
      { metaData: { publicPath, remoteEntry: { name: 'e.js', path: '' } } },
      url,
    );
    expect(out.remoteEntry).toBe(expected);
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
