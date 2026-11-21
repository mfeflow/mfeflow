import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBaseHeadScript,
  BASE_PATH_GLOBAL,
  baseHeadScript,
  defaultRegistryUrlFor,
  normalizeBasePath,
  REGISTRY_URL_GLOBAL,
  resolveBasePath,
  resolveRegistryUrl,
} from './base';
import { headScripts, resetHeadScriptsForTests } from './head-scripts';

describe('normalizeBasePath', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['  ', '/'],
    ['/', '/'],
    ['demo', '/demo/'],
    ['/demo', '/demo/'],
    ['demo/', '/demo/'],
    ['/demo/', '/demo/'],
    ['/a//b/', '/a/b/'],
    ['/a/b', '/a/b/'],
    ['/my-repo.v2/', '/my-repo.v2/'],
  ])('turns %j into %j', (input, expected) => {
    expect(normalizeBasePath(input)).toBe(expected);
  });

  it.each([
    'https://acme.github.io/demo/',
    '//acme.github.io/demo',
    '//',
    '/demo?x=1',
    '/demo#top',
    '\\demo',
    '/a/../b',
    '/./a',
    '/my demo/',
    '/100%/',
    '/caf\u00e9/',
    '/<b>/',
    '/a"b/',
    '/a`b',
    '/{a}',
    '/a|b',
    '/a^b',
  ])('rejects %j', (input) => {
    expect(() => normalizeBasePath(input)).toThrow('basePath');
  });
});

describe('resolveBasePath', () => {
  it('prefers the option, then MFEFLOW_BASE_PATH, then the root', () => {
    expect(resolveBasePath('/a', { MFEFLOW_BASE_PATH: '/b' })).toBe('/a/');
    expect(resolveBasePath(undefined, { MFEFLOW_BASE_PATH: 'b' })).toBe('/b/');
    expect(resolveBasePath(undefined, {})).toBe('/');
    expect(resolveBasePath(undefined, { MFEFLOW_BASE_PATH: '' })).toBe('/');
  });
});

describe('resolveRegistryUrl', () => {
  it('is nothing unless the option or MFEFLOW_REGISTRY_URL names one, and MFE_ENV is not read', () => {
    expect(resolveRegistryUrl('/demo/', undefined, {})).toBeUndefined();
    expect(resolveRegistryUrl('/demo/', '  ', { MFEFLOW_REGISTRY_URL: '' })).toBeUndefined();
    expect(resolveRegistryUrl('/demo/', undefined, { MFE_ENV: 'prod' })).toBeUndefined();
  });

  it('puts a relative value under the base and keeps a rooted or absolute one as written', () => {
    expect(resolveRegistryUrl('/demo/', 'envs/prod/index.json', {})).toBe(
      '/demo/envs/prod/index.json',
    );
    expect(resolveRegistryUrl('/', 'envs/prod/index.json', {})).toBe('/envs/prod/index.json');
    expect(resolveRegistryUrl('/demo/', '/shared/index.json', {})).toBe('/shared/index.json');
    expect(resolveRegistryUrl('/demo/', 'https://cdn.example.com/i.json', {})).toBe(
      'https://cdn.example.com/i.json',
    );
  });

  it('prefers the option over MFEFLOW_REGISTRY_URL', () => {
    const env = { MFEFLOW_REGISTRY_URL: 'envs/dev/index.json' };
    expect(resolveRegistryUrl('/demo/', undefined, env)).toBe('/demo/envs/dev/index.json');
    expect(resolveRegistryUrl('/demo/', 'envs/prod/index.json', env)).toBe(
      '/demo/envs/prod/index.json',
    );
  });
});

describe('defaultRegistryUrlFor', () => {
  it('is <base>registry/index.json', () => {
    expect(defaultRegistryUrlFor('/demo/')).toBe('/demo/registry/index.json');
    expect(defaultRegistryUrlFor('/')).toBe('/registry/index.json');
  });
});

describe('the global names', () => {
  it('match the literals @mfeflow/runtime and @mfeflow/route-factory read', () => {
    expect(BASE_PATH_GLOBAL).toBe('__MFE_BASE_PATH__');
    expect(REGISTRY_URL_GLOBAL).toBe('__MFE_REGISTRY_URL__');
  });
});

describe('baseHeadScript', () => {
  it('sets both globals on window', () => {
    const window: Record<string, unknown> = {};
    vm.runInNewContext(baseHeadScript('/demo/', '/demo/envs/prod/index.json'), { window });
    expect(window[BASE_PATH_GLOBAL]).toBe('/demo/');
    expect(window[REGISTRY_URL_GLOBAL]).toBe('/demo/envs/prod/index.json');
  });

  it('cannot close the script tag or break on line separators', () => {
    const url = 'https://x.example/</script><script>alert(1)</script>\u2028\u2029.json';
    const source = baseHeadScript('/demo/', url);
    expect(source).not.toContain('<');
    expect(source).not.toContain('\u2028');
    expect(source).not.toContain('\u2029');
    const window: Record<string, unknown> = {};
    vm.runInNewContext(source, { window });
    expect(window[REGISTRY_URL_GLOBAL]).toBe(url);
  });
});

describe('applyBaseHeadScript', () => {
  afterEach(resetHeadScriptsForTests);

  it('registers nothing at the root without a registry URL, and returns the base', () => {
    expect(applyBaseHeadScript(undefined, undefined, {})).toBe('/');
    expect(headScripts()).toEqual([]);
  });

  it('registers the script for a base, or for a registry URL at the root', () => {
    expect(applyBaseHeadScript('demo', undefined, {})).toBe('/demo/');
    expect(headScripts()).toEqual([baseHeadScript('/demo/', '/demo/registry/index.json')]);
    applyBaseHeadScript(undefined, 'envs/prod/index.json', {});
    expect(headScripts()).toEqual([baseHeadScript('/', '/envs/prod/index.json')]);
  });

  it('removes the script when a reloaded config has no base any more', () => {
    applyBaseHeadScript('/demo/', undefined, {});
    expect(headScripts()).toHaveLength(1);
    applyBaseHeadScript(undefined, undefined, {});
    expect(headScripts()).toEqual([]);
  });

  it('replaces the script, not adds a second, when the base changes', () => {
    applyBaseHeadScript('/a/', undefined, {});
    applyBaseHeadScript('/b/', undefined, {});
    expect(headScripts()).toEqual([baseHeadScript('/b/', '/b/registry/index.json')]);
  });
});
