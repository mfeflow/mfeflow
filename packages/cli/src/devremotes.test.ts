import { describe, expect, it } from 'vitest';
import { devConfigText, portOf, readDevRemotes, withDevRemote } from './devremotes';
import { thrown } from './testing';

const config = devConfigText([
  { name: 'catalog', port: 4311 },
  { name: 'cart', port: 4312 },
]);

describe('devConfigText', () => {
  it('lists each remote by the manifest URL of its dev server', () => {
    expect(JSON.parse(config)).toEqual({
      environment: 'dev',
      devRemotes: {
        catalog: 'http://localhost:4311/mf-manifest.json',
        cart: 'http://localhost:4312/mf-manifest.json',
      },
    });
    expect(config.endsWith('\n')).toBe(true);
  });

  it('has an empty list for a shell with no remotes yet', () => {
    expect(JSON.parse(devConfigText([]))).toEqual({ environment: 'dev', devRemotes: {} });
  });
});

describe('readDevRemotes', () => {
  it('reads the list back', () => {
    expect(readDevRemotes(config)).toEqual({
      catalog: 'http://localhost:4311/mf-manifest.json',
      cart: 'http://localhost:4312/mf-manifest.json',
    });
  });

  it('is empty for a missing file, a missing key or a key that is not an object', () => {
    expect(readDevRemotes(undefined)).toEqual({});
    expect(readDevRemotes('{"environment":"dev"}')).toEqual({});
    expect(readDevRemotes('{"devRemotes":3}')).toEqual({});
    expect(readDevRemotes('[]')).toEqual({});
  });

  it('skips a value that is not a URL string', () => {
    expect(readDevRemotes('{"devRemotes":{"a":"http://x","b":4}}')).toEqual({ a: 'http://x' });
  });

  it('says so when the file is not JSON', () => {
    expect(thrown(() => readDevRemotes('{')).message).toContain('is not valid JSON');
  });
});

describe('withDevRemote', () => {
  it('adds a remote and keeps every other key', () => {
    const text = withDevRemote(
      '{"environment":"dev","gtmId":"G-1","devRemotes":{"a":"http://a"}}',
      {
        name: 'checkout',
        port: 4313,
      },
    );
    expect(JSON.parse(text)).toEqual({
      environment: 'dev',
      gtmId: 'G-1',
      devRemotes: { a: 'http://a', checkout: 'http://localhost:4313/mf-manifest.json' },
    });
  });

  it('starts the list when there is none', () => {
    expect(JSON.parse(withDevRemote('{}', { name: 'a', port: 4311 }))).toEqual({
      devRemotes: { a: 'http://localhost:4311/mf-manifest.json' },
    });
    expect(JSON.parse(withDevRemote('[]', { name: 'a', port: 4311 }))).toEqual({
      devRemotes: { a: 'http://localhost:4311/mf-manifest.json' },
    });
  });

  it('refuses a file that is not JSON instead of overwriting it', () => {
    expect(thrown(() => withDevRemote('{', { name: 'a', port: 1 })).message).toContain(
      'is not valid JSON',
    );
  });
});

describe('portOf', () => {
  it('reads the port of a dev URL', () => {
    expect(portOf('http://localhost:4311/mf-manifest.json')).toBe(4311);
  });

  it('is undefined when there is no port or no URL', () => {
    expect(portOf('https://cdn.example.com/mf-manifest.json')).toBeUndefined();
    expect(portOf('not a url')).toBeUndefined();
  });
});
