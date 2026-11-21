import { afterEach, describe, expect, it } from 'vitest';
import {
  basePath,
  BASE_PATH_GLOBAL,
  defaultRegistryUrl,
  REGISTRY_URL_GLOBAL,
  runtimeConfigUrl,
  stripBase,
  withBase,
} from './base';

afterEach(() => {
  Reflect.deleteProperty(globalThis, BASE_PATH_GLOBAL);
  Reflect.deleteProperty(globalThis, REGISTRY_URL_GLOBAL);
});

describe('without a base path', () => {
  it('changes nothing', () => {
    expect(basePath()).toBe('/');
    expect(withBase('/cart')).toBe('/cart');
    expect(withBase('/')).toBe('/');
    expect(stripBase('/cart')).toBe('/cart');
    expect(runtimeConfigUrl()).toBe('/config/runtime-config.json');
    expect(defaultRegistryUrl()).toBe('/registry/index.json');
  });

  it('ignores a global that is empty or not text', () => {
    Reflect.set(globalThis, BASE_PATH_GLOBAL, '');
    expect(basePath()).toBe('/');
    Reflect.set(globalThis, BASE_PATH_GLOBAL, 3);
    expect(basePath()).toBe('/');
  });
});

describe('under /demo/', () => {
  it('prefixes paths and strips the prefix from pathnames', () => {
    Reflect.set(globalThis, BASE_PATH_GLOBAL, '/demo/');
    expect(basePath()).toBe('/demo/');
    expect(withBase('/cart')).toBe('/demo/cart');
    expect(withBase('/')).toBe('/demo/');
    expect(withBase('https://x.test/a')).toBe('https://x.test/a');
    expect(stripBase('/demo/cart')).toBe('/cart');
    expect(stripBase('/demo/cart/42')).toBe('/cart/42');
    expect(stripBase('/demo/')).toBe('/');
    expect(stripBase('/demo')).toBe('/');
    expect(stripBase('/demonstration')).toBe('/demonstration');
    expect(stripBase('/other')).toBe('/other');
    expect(runtimeConfigUrl()).toBe('/demo/config/runtime-config.json');
  });

  it('adds missing slashes to a base set by hand', () => {
    Reflect.set(globalThis, BASE_PATH_GLOBAL, 'demo');
    expect(basePath()).toBe('/demo/');
  });

  it('uses the registry URL the build chose', () => {
    Reflect.set(globalThis, REGISTRY_URL_GLOBAL, '/demo/envs/prod/index.json');
    expect(defaultRegistryUrl()).toBe('/demo/envs/prod/index.json');
  });
});
