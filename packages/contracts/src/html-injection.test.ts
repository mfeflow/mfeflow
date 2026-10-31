import { describe, expect, it } from 'vitest';
import { injectIntoHead, registryInjection } from './html-injection.js';
import type { RegistryIndex } from './registry.js';

const index: RegistryIndex = {
  remotes: [
    {
      name: 'catalog',
      entry: 'https://x.test/mfe/catalog/mf-manifest.json',
      remoteEntry: 'https://x.test/mfe/catalog/e.js',
      exposes: {
        './App': ['https://x.test/mfe/catalog/a.css', 'https://x.test/mfe/catalog/a.js'],
      },
      routes: ['/catalog'],
    },
    {
      name: 'cart',
      entry: 'https://x.test/mfe/cart/mf-manifest.json',
      remoteEntry: 'https://x.test/mfe/cart/e.js',
      exposes: { './MiniCart': ['https://x.test/mfe/cart/m.js'] },
    },
    { name: 'legacy', entry: 'https://x.test/mfe/legacy/mf-manifest.json' },
  ],
};

describe('registryInjection', () => {
  it('inlines the registry without the preload lists and preloads the route’s files without crossorigin', () => {
    const html = registryInjection(index, [
      { remote: 'catalog', expose: './App' },
      { remote: 'cart', expose: './MiniCart' },
    ]);
    const script = /<script>window\.__MFE_REGISTRY__=(.*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(JSON.parse(script)).toEqual({
      remotes: [
        {
          name: 'catalog',
          entry: 'https://x.test/mfe/catalog/mf-manifest.json',
          remoteEntry: 'https://x.test/mfe/catalog/e.js',
          routes: ['/catalog'],
        },
        {
          name: 'cart',
          entry: 'https://x.test/mfe/cart/mf-manifest.json',
          remoteEntry: 'https://x.test/mfe/cart/e.js',
        },
        { name: 'legacy', entry: 'https://x.test/mfe/legacy/mf-manifest.json' },
      ],
    });
    expect(html.match(/<link [^>]*>/g)).toEqual([
      '<link rel="preload" as="script" href="https://x.test/mfe/catalog/e.js">',
      '<link rel="preload" as="style" href="https://x.test/mfe/catalog/a.css">',
      '<link rel="preload" as="script" href="https://x.test/mfe/catalog/a.js">',
      '<link rel="preload" as="script" href="https://x.test/mfe/cart/e.js">',
      '<link rel="preload" as="script" href="https://x.test/mfe/cart/m.js">',
    ]);
    expect(html).not.toContain('crossorigin');
  });

  it('skips unknown remotes, unknown exposes of known remotes, and repeats', () => {
    const html = registryInjection(index, [
      { remote: 'nope', expose: './App' },
      { remote: 'cart', expose: './Other' },
      { remote: 'cart', expose: './MiniCart' },
    ]);
    expect(html.match(/<link [^>]*>/g)).toEqual([
      '<link rel="preload" as="script" href="https://x.test/mfe/cart/e.js">',
      '<link rel="preload" as="script" href="https://x.test/mfe/cart/m.js">',
    ]);
    expect(registryInjection(index, []).includes('<link')).toBe(false);
  });

  it('preloads the manifest, with credentials matching fetch(), for a remote with no remoteEntry', () => {
    const html = registryInjection(index, [
      { remote: 'legacy', expose: './App' },
      { remote: 'legacy', expose: './Other' },
    ]);
    expect(html.match(/<link [^>]*>/g)).toEqual([
      '<link rel="preload" as="fetch" crossorigin href="https://x.test/mfe/legacy/mf-manifest.json">',
    ]);
  });

  it('uses modulepreload for the files of an ESM remote and keeps styles as preload', () => {
    const esm: RegistryIndex = {
      remotes: [
        {
          name: 'a',
          entry: 'https://x.test/a/m.json',
          remoteEntry: 'https://x.test/a/e.mjs',
          type: 'module',
          exposes: { './App': ['https://x.test/a/a.css', 'https://x.test/a/a.js'] },
        },
        {
          name: 'b',
          entry: 'https://x.test/b/m.json',
          remoteEntry: 'https://x.test/b/e.mjs',
          type: 'esm',
        },
      ],
    };
    const html = registryInjection(esm, [
      { remote: 'a', expose: './App' },
      { remote: 'b', expose: './App' },
    ]);
    expect(html.match(/<link [^>]*>/g)).toEqual([
      '<link rel="modulepreload" href="https://x.test/a/e.mjs">',
      '<link rel="preload" as="style" href="https://x.test/a/a.css">',
      '<link rel="modulepreload" href="https://x.test/a/a.js">',
      '<link rel="modulepreload" href="https://x.test/b/e.mjs">',
    ]);
  });

  it('inlines everything the runtime reads from the fetched index except the preload files', () => {
    const full: RegistryIndex = {
      remotes: [
        {
          name: 'cart',
          entry: 'https://x.test/cart/m.json',
          remoteEntry: 'https://x.test/cart/e.js',
          type: 'module',
          entryGlobalName: 'cart_g',
          version: '1.2.3',
          owner: 'checkout',
          routes: ['/cart'],
          exposes: { './App': ['https://x.test/cart/a.js'] },
        },
      ],
    };
    const script =
      /<script>window\.__MFE_REGISTRY__=(.*?)<\/script>/.exec(registryInjection(full, []))?.[1] ??
      '';
    const withoutExposes = full.remotes.map(({ exposes: _preloadOnly, ...rest }) => rest);
    expect(JSON.parse(script)).toEqual({ remotes: withoutExposes });
  });

  it('inlines the entry type and global name only when the registry has them', () => {
    const html = registryInjection(
      {
        remotes: [
          { name: 'a', entry: 'https://x.test/a.json', type: 'module', entryGlobalName: 'ag' },
          { name: 'b', entry: 'https://x.test/b.json' },
        ],
      },
      [],
    );
    expect(html).toContain(
      '{"name":"a","entry":"https://x.test/a.json","type":"module","entryGlobalName":"ag"}',
    );
    expect(html).toContain('{"name":"b","entry":"https://x.test/b.json"}');
  });

  it('cannot be broken out of by a hostile registry value', () => {
    const html = registryInjection(
      {
        remotes: [
          {
            name: 'evil',
            entry: 'https://x.test/</script><script>alert(1)</script>\u2028',
            remoteEntry: 'https://x.test/e.js?a="b"&c=<d>',
          },
        ],
      },
      [{ remote: 'evil', expose: './App' }],
    );
    expect(html.match(/<script>/gi)).toHaveLength(1);
    expect(html.match(/<\/script\s*>/gi)).toHaveLength(1);
    expect(html).not.toContain('\u2028');
    expect(html).toContain('href="https://x.test/e.js?a=&#34;b&#34;&#38;c=&#60;d&#62;"');
  });
});

describe('injectIntoHead', () => {
  it('goes right after the opening head tag, with or without attributes', () => {
    expect(injectIntoHead('<html><head><title>x</title></head></html>', '<i></i>')).toBe(
      '<html><head><i></i><title>x</title></head></html>',
    );
    expect(injectIntoHead('<HEAD lang="en"><meta></HEAD>', '<i></i>')).toBe(
      '<HEAD lang="en"><i></i><meta></HEAD>',
    );
  });

  it('goes after the charset meta so it stays inside the first 1024 bytes', () => {
    expect(
      injectIntoHead('<html><head><META charset="utf-8"><title>x</title></head>', '<i></i>'),
    ).toBe('<html><head><META charset="utf-8"><i></i><title>x</title></head>');
    expect(
      injectIntoHead(
        '<head><meta name="a"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>',
        '<i></i>',
      ),
    ).toBe(
      '<head><meta name="a"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><i></i></head>',
    );
  });

  it('ignores a charset meta outside the head, a <header> tag and unclosed tags', () => {
    expect(injectIntoHead('<header></header><head></head><meta charset="x">', '<i></i>')).toBe(
      '<header></header><head><i></i></head><meta charset="x">',
    );
    expect(injectIntoHead('<head><meta charset="x"', '<i></i>')).toBe(
      '<head><i></i><meta charset="x"',
    );
    expect(() => injectIntoHead('<head', '<i></i>')).toThrow(/no <head>/);
  });

  it('stays fast on a hostile page', () => {
    const start = Date.now();
    injectIntoHead(`<head ${' '.repeat(50_000)}>`, '<i></i>');
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('throws when there is no head', () => {
    expect(() => injectIntoHead('<body></body>', '<i></i>')).toThrow(/no <head>/);
  });
});
