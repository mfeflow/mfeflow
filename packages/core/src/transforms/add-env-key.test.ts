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

  it('sees a key that is already set with an export prefix or spaces around the =', () => {
    for (const line of ['export API_ORIGIN=x\n', 'API_ORIGIN = x\n', '  export  API_ORIGIN =\n']) {
      expect(run(line, '.env.example', { scope: 'server', key: 'API_ORIGIN' }), line).toBe(line);
    }
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

  describe('a schema per validator', () => {
    const many = { zod: 'z.string()', valibot: 'v.string()', arktype: "'string'" };

    it.each([
      ['zod', "import { z } from 'zod';", 'GTM_ID: z.string()'],
      ['zod', "import { z } from 'zod/v4';", 'GTM_ID: z.string()'],
      ['valibot', "import * as v from 'valibot';", 'GTM_ID: v.string()'],
      ['arktype', "import { type } from 'arktype';", "GTM_ID: 'string'"],
    ])('uses the %s text for a file importing %s', (_name, importLine, written) => {
      const source = `${importLine}\nexport const runtimeConfigSchema = {};\n`;
      expect(run(source, 'schema.ts', { schema: many })).toContain(written);
    });

    it('fails with E208 when the file uses a validator the map does not cover', () => {
      const source = "import { z } from 'zod';\nexport const runtimeConfigSchema = {};\n";
      const error = thrown(() => run(source, 'schema.ts', { schema: { valibot: 'v.string()' } }));
      expect(error.code).toBe('MFEFLOW_E208');
      expect(error.message).toContain('uses zod');
      const none = thrown(() =>
        run('export const runtimeConfigSchema = {};\n', 'schema.ts', { schema: many }),
      );
      expect(none.message).toContain('no known validator');
    });
  });

  describe('a list value', () => {
    it('is written as a JSON list in the config files and joined with commas in dotenv', () => {
      expect(run('{}', 'c.json', { value: ['https://a.test', 'https://b.test'] })).toBe(
        '{\n  "GTM_ID": [\n    "https://a.test",\n    "https://b.test"\n  ]\n}',
      );
      expect(run('', '.env.example', { scope: 'server', value: ['a', 'b'] })).toBe('GTM_ID=a,b\n');
      expect(run('{}', 'c.json', { value: [] })).toBe('{\n  "GTM_ID": []\n}');
    });
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
      "type({ a: 'string', 'b?': 'string' })",
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

  const optionalOf = (value: string) => {
    const keys = schemaKeys(
      `export const env = createEnv({ server: { K: ${value} } });`,
      'env.ts',
      'server',
    );
    return keys?.[0]?.optional;
  };

  it.each([
    ['z.string().optional()', true],
    ['z.string().nullish()', true],
    ["z.string().default('x')", true],
    ["z.string().catch('x')", true],
    ['z.optional(z.string())', true],
    ['v.optional(v.string())', true],
    ['v.nullish(v.string())', true],
    ["v.fallback(v.string(), 'x')", true],
    ['v.exactOptional(v.string())', true],
    ['optional(string())', true],
    ['z.string().optional() as z.ZodString', true],
    ["z.enum(['default', 'strict'])", false],
    ["z.enum(['optional', 'nullish'])", false],
    ["z.string().describe('may be undefined')", false],
    ["z.string().describe('has a default')", false],
    ["z.literal('optional')", false],
    ["z.string().refine((v) => v !== 'default')", false],
    ['v.pipe(v.string(), v.url())', false],
    ['z.string().optional().min(1)', false],
    ['z.string()', false],
  ])('reads optionality of %s from the outermost call: %s', (value, optional) => {
    expect(optionalOf(value)).toBe(optional);
  });

  it("reads an arktype 'key?' as an optional key named without the question mark", () => {
    const source = `export const runtimeConfigSchema = type({ a: 'string', 'b?': 'string', "c?": 'number', d: 'string | undefined', 'e-f?': 'string' });`;
    expect(schemaKeys(source, 'schema.ts', 'runtime')).toEqual([
      { name: 'a', optional: false },
      { name: 'b', optional: true },
      { name: 'c', optional: true },
      { name: 'd', optional: false },
      { name: 'e-f', optional: true },
    ]);
  });

  it("does not add an arktype key that exists as 'key?'", () => {
    const source = `export const runtimeConfigSchema = type({\n  'GTM_ID?': 'string',\n});\n`;
    expect(run(source, 'schema.ts', { schema: "'string'" })).toBe(source);
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
