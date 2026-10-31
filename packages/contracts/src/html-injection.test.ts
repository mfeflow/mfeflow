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
  it('inlines a trimmed registry and preloads the route’s files without crossorigin', () => {
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

  it('skips unknown remotes, remotes without an entry script, and repeats', () => {
    const html = registryInjection(index, [
      { remote: 'nope', expose: './App' },
      { remote: 'legacy', expose: './App' },
      { remote: 'cart', expose: './Other' },
      { remote: 'cart', expose: './MiniCart' },
    ]);
    expect(html.match(/<link [^>]*>/g)).toEqual([
      '<link rel="preload" as="script" href="https://x.test/mfe/cart/e.js">',
      '<link rel="preload" as="script" href="https://x.test/mfe/cart/m.js">',
    ]);
    expect(registryInjection(index, []).includes('<link')).toBe(false);
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
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
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

  it('throws when there is no head', () => {
    expect(() => injectIntoHead('<body></body>', '<i></i>')).toThrow(/no <head>/);
  });
});
