import { describe, expect, it } from 'vitest';
import { thrown } from '../testing.js';
import { addEnvKey } from './add-env-key.js';

const run = (source: string, file: string, extra: object = {}) =>
  addEnvKey(source, file, { op: 'add-env-key', file, key: 'GTM_ID', ...extra });

describe('add-env-key in JSON', () => {
  const json = `{\n    "API_URL": "/api"\n}\n`;

  it('adds the key with its value, keeping indentation and final newline', () => {
    expect(run(json, 'runtime-config.json', { value: 'GTM-XXXX' })).toBe(
      `{\n    "API_URL": "/api",\n    "GTM_ID": "GTM-XXXX"\n}\n`,
    );
    expect(run(json, 'runtime-config.json')).toContain('"GTM_ID": ""');
    expect(run('{"a":1}', 'c.json', { value: null })).toBe('{\n  "a": 1,\n  "GTM_ID": null\n}');
  });

  it('is idempotent and does not overwrite an existing value', () => {
    const existing = `{\n  "GTM_ID": "mine"\n}\n`;
    expect(run(existing, 'c.json', { value: 'other' })).toBe(existing);
  });

  it('fails with E208 on invalid JSON or a non-object', () => {
    expect(thrown(() => run('{', 'c.json')).code).toBe('MFEFLOW_E208');
    expect(thrown(() => run('[]', 'c.json')).code).toBe('MFEFLOW_E208');
    expect(thrown(() => run('null', 'c.json')).code).toBe('MFEFLOW_E208');
  });
});

describe('add-env-key in TypeScript', () => {
  const ts = `export const runtimeConfig = {\n  API_URL: '/api',\n};\n`;

  it('adds a property to the object literal', () => {
    expect(run(ts, 'config.ts', { value: 'GTM-1' })).toBe(
      `export const runtimeConfig = {\n  API_URL: '/api',\n  GTM_ID: 'GTM-1',\n};\n`,
    );
    expect(run(ts, 'config.ts', { value: 3 })).toContain('GTM_ID: 3');
    expect(run(`const cfg = {};\n`, 'config.ts', { object: 'cfg', key: 'a-b' })).toBe(
      `const cfg = {'a-b': ''};\n`,
    );
  });

  it('is idempotent, also for quoted keys', () => {
    const once = run(ts, 'config.ts');
    expect(run(once, 'config.ts')).toBe(once);
    const quoted = `export const runtimeConfig = {\n  'GTM_ID': '',\n};\n`;
    expect(run(quoted, 'config.ts')).toBe(quoted);
  });

  it('fails with E208 when the object is missing', () => {
    expect(thrown(() => run('export const x = {};\n', 'config.ts')).code).toBe('MFEFLOW_E208');
  });
});
