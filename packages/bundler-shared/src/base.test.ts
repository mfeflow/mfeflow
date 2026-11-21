import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  BASE_PATH_GLOBAL,
  baseHeadScript,
  defaultRegistryUrlFor,
  normalizeBasePath,
  REGISTRY_URL_GLOBAL,
  resolveBasePath,
} from './base';

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

describe('defaultRegistryUrlFor', () => {
  it('is the index mfeflow deploy writes when the build names its environment', () => {
    expect(defaultRegistryUrlFor('/demo/', { MFE_ENV: 'prod' })).toBe('/demo/envs/prod/index.json');
  });

  it('is <base>registry/index.json without MFE_ENV', () => {
    expect(defaultRegistryUrlFor('/demo/', {})).toBe('/demo/registry/index.json');
    expect(defaultRegistryUrlFor('/demo/', { MFE_ENV: '' })).toBe('/demo/registry/index.json');
  });
});

describe('baseHeadScript', () => {
  it('sets both globals on window', () => {
    const window: Record<string, unknown> = {};
    vm.runInNewContext(baseHeadScript('/demo/', { MFE_ENV: 'prod' }), { window });
    expect(window[BASE_PATH_GLOBAL]).toBe('/demo/');
    expect(window[REGISTRY_URL_GLOBAL]).toBe('/demo/envs/prod/index.json');
  });
});
