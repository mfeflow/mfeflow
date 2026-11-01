import { describe, expect, it } from 'vitest';
import { DOCS_URL, errorDocsUrl, JSON_SCHEMAS, SCHEMA_URLS, type SchemaName } from './index';
import { ENV_KEY, JOB_ID, SCRIPT_NAME } from './feature';
import { SAFE_RELATIVE_PATH, isSafeRelativePath } from './validate';
import { CHECKOUT_PATH, REGISTRY_NAMESPACE, SEMVER, isCheckoutPath } from './project';

interface Node {
  pattern?: string;
  const?: unknown;
  additionalProperties?: unknown;
  propertyNames?: Node;
  properties: Record<string, Node>;
  items: Node;
  oneOf: Node[];
}
const props = (name: SchemaName): Record<string, Node> =>
  JSON_SCHEMAS[name].properties as Record<string, Node>;
const transformOp = (op: string): Node['properties'] => {
  const found = props('feature').transforms?.items.oneOf.find((n) => n.properties.op?.const === op);
  if (!found) throw new Error(`no ${op} in the feature schema`);
  return found.properties;
};

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
      const url = SCHEMA_URLS[name];
      expect(url.startsWith(`${DOCS_URL}/schema/`)).toBe(true);
      expect(url.slice(`${DOCS_URL}/schema/`.length)).toMatch(/^[a-z-]+\.json$/);
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

describe('schemas agree with the validators', () => {
  const unsafe = [
    '',
    '/a',
    'a/',
    'a//b',
    './a',
    'a/./b',
    '../a',
    'a/..',
    'a\\b',
    'a\0b',
    'C:/a',
    'c:a',
  ];
  const safe = ['a', 'a/b.json', '.hidden', '..a', 'a..', 'src/app/index.ts'];

  it('uses the validators own patterns', () => {
    const step = transformOp('add-workflow-step');
    const envKey = transformOp('add-env-key');
    expect(envKey.key?.pattern).toBe(ENV_KEY.source);
    expect(step.job?.pattern).toBe(JOB_ID.source);
    expect(props('feature').scripts?.items.properties.name?.pattern).toBe(SCRIPT_NAME.source);
    expect(props('project').registries?.propertyNames?.pattern).toBe(REGISTRY_NAMESPACE.source);
    expect(props('project').files?.propertyNames?.pattern).toBe(SAFE_RELATIVE_PATH.source);
    expect(props('project').local?.pattern).toBe(CHECKOUT_PATH.source);
    expect(props('project').cli?.pattern).toBe(SEMVER.source);
    expect(JSON.stringify(props('project').repo)).toBe('{"enum":["platform","shell","remote"]}');
  });

  it('allows the same literals in workflow step env and with', () => {
    const step = transformOp('add-workflow-step').step?.properties ?? {};
    expect(step.env?.additionalProperties).toEqual(step.with?.additionalProperties);
  });

  it('matches isSafeRelativePath', () => {
    for (const value of [...safe, ...unsafe]) {
      expect(SAFE_RELATIVE_PATH.test(value), value).toBe(isSafeRelativePath(value));
    }
  });

  it('accepts safe paths and rejects unsafe ones in the file schemas', () => {
    const pattern = new RegExp(props('feature').files?.items.properties.to?.pattern ?? '');
    for (const value of safe) expect(pattern.test(value), value).toBe(true);
    for (const value of unsafe) expect(pattern.test(value), value).toBe(false);
  });

  it('matches isCheckoutPath', () => {
    const samples = [
      '..',
      '../mfeflow',
      '../../a/b',
      '/abs/path',
      'C:/x/y',
      'a/b',
      '',
      '/',
      'a/../b',
      '../a/..',
      'a\\b',
      'x:y',
      '../a//b',
      './a',
    ];
    for (const value of samples)
      expect(CHECKOUT_PATH.test(value), value).toBe(isCheckoutPath(value));
  });
});
