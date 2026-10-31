import { describe, expect, it } from 'vitest';
import { DOCS_URL, errorDocsUrl, JSON_SCHEMAS, SCHEMA_URLS, type SchemaName } from './index';

const names = Object.keys(SCHEMA_URLS) as SchemaName[];

describe('docs URLs', () => {
  it('points at the GitHub Pages project site without a trailing slash', () => {
    expect(DOCS_URL).toBe('https://mfeflow.github.io/mfeflow');
  });

  it('builds error links under the docs URL', () => {
    expect(errorDocsUrl('E102')).toBe(`${DOCS_URL}/errors/E102`);
  });

  it('serves every schema as <name>.json under /schema/', () => {
    for (const name of names) {
      expect(SCHEMA_URLS[name]).toMatch(new RegExp(`^${DOCS_URL}/schema/[a-z-]+\\.json$`));
    }
  });
});

describe('JSON_SCHEMAS', () => {
  it('has one schema per published URL, with that URL as its $id', () => {
    expect(Object.keys(JSON_SCHEMAS).toSorted()).toEqual(names.toSorted());
    for (const name of names) expect(JSON_SCHEMAS[name].$id).toBe(SCHEMA_URLS[name]);
  });

  it('survives a JSON round trip and compiles every pattern', () => {
    const patterns: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'pattern' && typeof value === 'string') patterns.push(value);
          walk(value);
        }
      }
    };
    for (const name of names) {
      expect(JSON.parse(JSON.stringify(JSON_SCHEMAS[name]))).toEqual(JSON_SCHEMAS[name]);
      walk(JSON_SCHEMAS[name]);
    }
    expect(patterns.length).toBeGreaterThan(20);
    for (const pattern of patterns) expect(() => new RegExp(pattern)).not.toThrow();
  });

  it('declares $schema and lists only required fields it defines', () => {
    for (const name of names) {
      const schema = JSON_SCHEMAS[name];
      const properties = schema.properties as Record<string, unknown>;
      expect(properties.$schema).toBeDefined();
      for (const field of schema.required as string[]) expect(properties).toHaveProperty(field);
    }
  });

  it('accepts the fields the validators require', () => {
    expect(JSON_SCHEMAS.mfe.required).toEqual(['name', 'owner', 'shells', 'routes', 'exposes']);
    expect(JSON_SCHEMAS.project.required).toContain('apps');
    expect(JSON_SCHEMAS.feature.required).toEqual(['name', 'version']);
    expect(JSON_SCHEMAS.registryEntry.required).toEqual(['version', 'manifestUrl']);
    expect(JSON_SCHEMAS.registryIndex.required).toEqual(['remotes']);
  });
});
