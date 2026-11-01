import { describe, expect, it } from 'vitest';
import {
  isFeatureRegistryIndex,
  isLoopbackHttp,
  registryIndexUrl,
  registryTemplateProblem,
  validateFeatureRegistryIndex,
} from './feature-registry';
import { JSON_SCHEMAS } from './json-schema';

const item = { name: 'hello', version: '1.0.0', description: 'Says hello' };

describe('registryTemplateProblem', () => {
  it.each([
    'https://example.com/{name}.json',
    'https://example.com/r/{version}/{name}.json',
    'https://example.com/api?feature={name}&v={version}',
    'http://127.0.0.1:8080/{name}.json',
    'http://localhost/{name}.json',
    'http://[::1]:3000/{name}.json',
  ])('accepts %s', (template) => {
    expect(registryTemplateProblem(template)).toBeUndefined();
  });

  it.each([
    ['https://example.com/feature.json', 'must contain {name}'],
    ['https://example.com/{name}/{id}.json', 'only {name} and {version}'],
    ['https://example.com/{name}/x{.json', 'unmatched'],
    ['https://{name}.example.com/x.json', 'placeholder in the host'],
    ['not a url {name}', 'not a URL'],
    ['http://example.com/{name}.json', 'must be https'],
    ['http://localhost@evil.com/{name}.json', 'must be https'],
    ['http://127.0.0.1.nip.io/{name}.json', 'must be https'],
    ['http://localhost.evil.com/{name}.json', 'must be https'],
    ['ftp://example.com/{name}.json', 'must be an https URL'],
    ['file:///tmp/{name}.json', 'must be an https URL'],
    ['https://user:pass@example.com/{name}.json', 'user name or password'],
  ])('refuses %s', (template, why) => {
    expect(registryTemplateProblem(template)).toContain(why);
  });
});

describe('isLoopbackHttp', () => {
  it('matches the parsed host, never a prefix of the text', () => {
    expect(isLoopbackHttp(new URL('http://127.0.0.1:1/'))).toBe(true);
    expect(isLoopbackHttp(new URL('http://[::1]/'))).toBe(true);
    expect(isLoopbackHttp(new URL('https://127.0.0.1/'))).toBe(false);
    expect(isLoopbackHttp(new URL('http://127.0.0.2/'))).toBe(false);
    expect(isLoopbackHttp(new URL('http://localhost@evil.com/'))).toBe(false);
  });
});

describe('registryIndexUrl', () => {
  it.each([
    ['https://x.dev/r/{name}.json', 'https://x.dev/r/index.json'],
    ['https://x.dev/{name}.json', 'https://x.dev/index.json'],
    ['https://x.dev/r/{name}/{version}.json', 'https://x.dev/r/index.json'],
    ['https://x.dev/a/b/{version}/{name}.json', 'https://x.dev/a/b/index.json'],
    ['https://x.dev/api?feature={name}', 'https://x.dev/index.json'],
    ['http://127.0.0.1:9/{name}.json', 'http://127.0.0.1:9/index.json'],
  ])('puts the index of %s at %s', (template, expected) => {
    expect(registryIndexUrl(template)).toBe(expected);
  });
});

describe('validateFeatureRegistryIndex', () => {
  it('accepts items with and without keywords', () => {
    expect(
      validateFeatureRegistryIndex({
        $schema: 'x',
        items: [item, { ...item, name: 'other', keywords: ['a', 'b'] }],
      }),
    ).toEqual([]);
    expect(isFeatureRegistryIndex({ items: [] })).toBe(true);
  });

  it.each([
    [null, '(root)'],
    [{}, 'items'],
    [{ items: [1] }, 'items[0]'],
    [{ items: [{ ...item, name: '@test/hello' }] }, 'items[0].name'],
    [{ items: [{ ...item, name: 'Hello' }] }, 'items[0].name'],
    [{ items: [{ ...item, version: undefined }] }, 'items[0].version'],
    [{ items: [{ ...item, description: 'a\u001b[31mred' }] }, 'items[0].description'],
    [{ items: [{ ...item, description: 'x'.repeat(301) }] }, 'items[0].description'],
    [{ items: [{ ...item, keywords: 'a' }] }, 'items[0].keywords'],
    [{ items: [{ ...item, keywords: ['a\u0007'] }] }, 'items[0].keywords[0]'],
    [{ items: [{ ...item, keywords: Array.from({ length: 21 }, () => 'k') }] }, 'keywords'],
    [{ items: [item, item] }, 'items[1].name'],
  ])('refuses %j', (value, path) => {
    const issues = validateFeatureRegistryIndex(value);
    expect(issues.map((i) => i.path || '(root)').join(' ')).toContain(path);
    expect(isFeatureRegistryIndex(value)).toBe(false);
  });

  it('refuses more items than a terminal could show', () => {
    const items = Array.from({ length: 1001 }, (_, i) => ({ ...item, name: `f${String(i)}` }));
    expect(validateFeatureRegistryIndex({ items })[0]?.message).toContain('more than 1000');
  });

  it('has a JSON Schema that requires the same fields', () => {
    expect(JSON_SCHEMAS.featureRegistryIndex.required).toEqual(['items']);
  });
});
