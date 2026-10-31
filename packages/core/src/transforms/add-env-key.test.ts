import { describe, expect, it } from 'vitest';
import type { AddEnvKeyOp } from '@mfeflow/contracts';
import { parseJsonObject } from '../json';
import { thrown } from '../testing';
import { addEnvKey, addTurboEnv, dotenvKeys, envKeyFiles, schemaKeys } from './add-env-key';

const op = (extra: Partial<AddEnvKeyOp> = {}): AddEnvKeyOp => ({
  op: 'add-env-key',
  file: 'env.ts',
  key: 'GTM_ID',
  scope: 'runtime',
  schema: 'z.string().min(1)',
  ...extra,
});
const run = (source: string, file: string, extra: Partial<AddEnvKeyOp> = {}) =>
  addEnvKey(source, file, op(extra));

describe('add-env-key: server scope (env.ts)', () => {
  const env = `import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    PORT: z.coerce.number(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
`;

  it('adds the key to the server object with the schema as written', () => {
    expect(
      run(env, 'env.ts', { scope: 'server', key: 'API_ORIGIN', schema: 'z.string().url()' }),
    ).toBe(
      env.replace(
        'PORT: z.coerce.number(),',
        'PORT: z.coerce.number(),\n    API_ORIGIN: z.string().url(),',
      ),
    );
  });

  it('is idempotent', () => {
    const o = { scope: 'server', key: 'API_ORIGIN', schema: 'z.string().url()' } as const;
    const once = run(env, 'env.ts', o);
    expect(run(once, 'env.ts', o)).toBe(once);
  });

  it('fails with E208 when there is no createEnv server object', () => {
    expect(thrown(() => run('export const x = 1;\n', 'env.ts', { scope: 'server' })).code).toBe(
      'MFEFLOW_E208',
    );
  });

  it('adds a KEY=value line to .env.example, once', () => {
    const o = { scope: 'server', key: 'API_ORIGIN', value: 'https://api.example.com' } as const;
    const once = run('PORT=3000', '.env.example', o);
    expect(once).toBe('PORT=3000\nAPI_ORIGIN=https://api.example.com\n');
    expect(run(once, '.env.example', o)).toBe(once);
    expect(run('', '.env.example', { key: 'A' })).toBe('A=\n');
    expect(run('# A=1\n', '.env.example', { key: 'A', value: 'two words' })).toBe(
      '# A=1\nA="two words"\n',
    );
    expect(run('', '.env.example', { key: 'A', value: null })).toBe('A=\n');
  });
});

describe('add-env-key: runtime scope', () => {
  const schema = `import { z } from 'zod';

export const runtimeConfigSchema = z.object({
  API_URL: z.string().url(),
});
`;

  it('adds the key to the runtime-config schema object', () => {
    expect(run(schema, 'src/config/schema.ts')).toBe(
      schema.replace(
        'API_URL: z.string().url(),',
        'API_URL: z.string().url(),\n  GTM_ID: z.string().min(1),',
      ),
    );
  });

  it('works on a plain object and a custom name, quoting odd keys', () => {
    expect(
      run('export const cfg = {};\n', 'schema.ts', {
        object: 'cfg',
        key: 'a-b',
        schema: 'v.string()',
      }),
    ).toBe("export const cfg = {'a-b': v.string()};\n");
  });

  it('is idempotent, also for quoted keys', () => {
    const once = run(schema, 'schema.ts');
    expect(run(once, 'schema.ts')).toBe(once);
    const quoted = `export const runtimeConfigSchema = { 'GTM_ID': z.string() };\n`;
    expect(run(quoted, 'schema.ts')).toBe(quoted);
  });

  it('fails with E208 when the schema object is missing', () => {
    expect(thrown(() => run('export const x = {};\n', 'schema.ts')).code).toBe('MFEFLOW_E208');
  });

  describe('runtime-config.<env>.json', () => {
    const json = `{\n    "API_URL": "/api"\n}\n`;

    it('adds a placeholder, keeping indentation and final newline', () => {
      expect(run(json, 'runtime-config.dev.json', { value: 'GTM-XXXX' })).toBe(
        `{\n    "API_URL": "/api",\n    "GTM_ID": "GTM-XXXX"\n}\n`,
      );
      expect(run(json, 'runtime-config.dev.json')).toContain('"GTM_ID": ""');
      expect(run('{"a":1}', 'c.json', { value: null })).toBe('{\n  "a": 1,\n  "GTM_ID": null\n}');
    });

    it('is idempotent and never overwrites a value', () => {
      const existing = `{\n  "GTM_ID": "mine"\n}\n`;
      expect(run(existing, 'c.json', { value: 'other' })).toBe(existing);
    });

    it('adds keys that only exist on Object.prototype, and own keys are what counts as present', () => {
      for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
        const out = run('{\n  "a": 1\n}\n', 'c.json', { key });
        expect(Object.keys(parseJsonObject('c.json', out)), key).toEqual(['a', key]);
      }
      const own = '{"constructor":"mine"}\n';
      expect(run(own, 'c.json', { key: 'constructor', value: 'x' })).toBe(own);
    });

    it('fails with E208 on invalid JSON or a non-object', () => {
      expect(thrown(() => run('{', 'c.json')).code).toBe('MFEFLOW_E208');
      expect(thrown(() => run('[]', 'c.json')).code).toBe('MFEFLOW_E208');
      expect(thrown(() => run('null', 'c.json')).code).toBe('MFEFLOW_E208');
    });
  });
});

describe('envKeyFiles', () => {
  it('lists the schema file and the files kept in sync with it', () => {
    expect(envKeyFiles(op({ scope: 'server' }))).toEqual(['env.ts', '.env.example']);
    expect(envKeyFiles(op({ scope: 'server', example: 'x/.env.sample' }))).toEqual([
      'env.ts',
      'x/.env.sample',
    ]);
    expect(envKeyFiles(op({ configFiles: ['a.dev.json', 'a.prod.json'] }))).toEqual([
      'env.ts',
      'a.dev.json',
      'a.prod.json',
    ]);
    expect(envKeyFiles(op())).toEqual(['env.ts']);
  });

  it('inserts inside the object when the closing brace shares the last property line', () => {
    const source = `export const env = createEnv({\n  server: {\n    PORT: z.number(),\n    HOST: z.string()},\n});\n`;
    expect(run(source, 'env.ts', { scope: 'server', key: 'GTM_ID' })).toBe(
      `export const env = createEnv({\n  server: {\n    PORT: z.number(),\n    HOST: z.string(),\n    GTM_ID: z.string().min(1)},\n});\n`,
    );
    const runtime = `export const runtimeConfigSchema = z.object({\n  API: z.string()});\n`;
    expect(run(runtime, 'src/config/schema.ts')).toBe(
      `export const runtimeConfigSchema = z.object({\n  API: z.string(),\n  GTM_ID: z.string().min(1)});\n`,
    );
  });
});

describe('schema text that is not code', () => {
  it('fails with E208 instead of writing a file that does not parse', () => {
    const env = 'export const env = createEnv({\n  server: {},\n});\n';
    const bad = thrown(() => run(env, 'env.ts', { scope: 'server', schema: 'z.string(' }));
    expect(bad.code).toBe('MFEFLOW_E208');
    expect(bad.message).toContain('GTM_ID');
  });
});

describe('schemaKeys', () => {
  const env = `export const env = createEnv({
  server: {
    API_ORIGIN: z.url(),
    NODE_ENV: z.enum(['a']).optional(),
    'QUOTED-KEY': z.string().default('x'),
    ...spread,
  },
});
`;

  it('lists server keys with whether a missing value is accepted', () => {
    expect(schemaKeys(env, 'env.ts', 'server')).toEqual([
      { name: 'API_ORIGIN', optional: false },
      { name: 'NODE_ENV', optional: true },
      { name: 'QUOTED-KEY', optional: true },
    ]);
  });

  it('lists runtime keys of z.object, v.object, type() and a plain object', () => {
    for (const init of [
      'z.object({ a: z.string(), b: z.string().optional() })',
      'v.object({ a: v.string(), b: v.optional(v.string()) })',
      "type({ a: 'string', b: 'string | undefined' })",
      '{ a: z.string(), b: z.nullish() }',
    ]) {
      expect(
        schemaKeys(`export const runtimeConfigSchema = ${init};`, 'schema.ts', 'runtime'),
      ).toEqual([
        { name: 'a', optional: false },
        { name: 'b', optional: true },
      ]);
    }
    expect(schemaKeys('export const cfg = { a: 1 };', 'schema.ts', 'runtime', 'cfg')).toEqual([
      { name: 'a', optional: false },
    ]);
  });

  it('returns undefined when the file has no such object', () => {
    expect(schemaKeys('export const x = 1;', 'env.ts', 'server')).toBeUndefined();
    expect(schemaKeys('export const x = 1;', 'schema.ts', 'runtime')).toBeUndefined();
  });
});

describe('dotenvKeys', () => {
  it('reads variable names, skipping comments, blanks and export prefixes', () => {
    expect(dotenvKeys('# A=1\n\nB=2\nexport C = 3\n  D=\nnot a line\n')).toEqual(['B', 'C', 'D']);
    expect(dotenvKeys('')).toEqual([]);
  });
});

describe('addTurboEnv', () => {
  const turbo = '{\n  "tasks": {\n    "build": { "dependsOn": ["^build"] }\n  }\n}\n';

  it('adds globalEnv in place, leaving the rest of the file as it was', () => {
    const once = addTurboEnv(turbo, 'turbo.json', 'API_ORIGIN');
    expect(once).toBe(
      '{\n  "tasks": {\n    "build": { "dependsOn": ["^build"] }\n  },\n  "globalEnv": ["API_ORIGIN"]\n}\n',
    );
    const twice = addTurboEnv(once, 'turbo.json', 'OTHER');
    expect(twice).toContain('"globalEnv": ["API_ORIGIN", "OTHER"]');
    expect(twice.startsWith(turbo.slice(0, -3))).toBe(true);
    expect(addTurboEnv(twice, 'turbo.json', 'OTHER')).toBe(twice);
  });

  it('works on an empty object and keeps a tab indent', () => {
    expect(addTurboEnv('{}\n', 'turbo.json', 'A')).toBe('{\n  "globalEnv": ["A"]\n}\n');
    expect(addTurboEnv('{\n\t"a": 1\n}', 'turbo.json', 'A')).toBe(
      '{\n\t"a": 1,\n\t"globalEnv": ["A"]\n}',
    );
  });

  it('breaks the list into lines once it no longer fits in 100 columns', () => {
    const keys = Array.from({ length: 9 }, (_, i) => `SOME_LONG_VARIABLE_NAME_${String(i)}`);
    const out = keys.reduce((source, key) => addTurboEnv(source, 'turbo.json', key), '{}\n');
    expect(out).toContain('"globalEnv": [\n    "SOME_LONG_VARIABLE_NAME_0",');
    expect(parseJsonObject('turbo.json', out).globalEnv).toEqual(keys);
  });

  it('fails with E208 on invalid JSON', () => {
    expect(thrown(() => addTurboEnv('{', 'turbo.json', 'A')).code).toBe('MFEFLOW_E208');
  });
});
