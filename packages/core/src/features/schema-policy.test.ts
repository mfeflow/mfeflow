import { describe, expect, it } from 'vitest';
import { thrown } from '../testing';
import { sanitizeSchema, sanitizeSchemas } from './schema-policy';

describe('sanitizeSchema', () => {
  it('re-emits plain validator call chains', () => {
    const cases: [string, string][] = [
      ['z.string().url()', 'z.string().url()'],
      ['z.string( ).url( )', 'z.string().url()'],
      ["z.enum([\"a\", 'b']).default('a')", "z.enum(['a', 'b']).default('a')"],
      ['z.coerce.number().int().min(-1).max(65535)', 'z.coerce.number().int().min(-1).max(65535)'],
      ['v.pipe(v.string(), v.minLength(1))', 'v.pipe(v.string(), v.minLength(1))'],
      ["type('string')", "type('string')"],
      [
        'z.object({ a: z.string(), "b-c": z.boolean() })',
        "z.object({ a: z.string(), 'b-c': z.boolean() })",
      ],
      ['z.literal(null)', 'z.literal(null)'],
      ['(z.string())', 'z.string()'],
    ];
    for (const [input, output] of cases) expect(sanitizeSchema(input, 'x'), input).toBe(output);
  });

  it('never carries comments or the text around the expression into the output', () => {
    const out = sanitizeSchema('z.string() /* }, EVIL: process.exit() */', 'x');
    expect(out).toBe('z.string()');
  });

  it('escapes string arguments', () => {
    const out = sanitizeSchema('z.string().regex("a\\"b\\n")', 'x');
    expect(out).toBe("z.string().regex('a\"b\\n')");
  });

  it('refuses the constructor gadget that reaches Function, and its relatives', () => {
    for (const schema of [
      'z.constructor.constructor("return process.mainModule")()',
      'z.constructor("return 1")()',
      'z.string().constructor',
      'z.string.call.constructor("x")()',
      'z.string.apply(null, [])',
      'z.string.bind(null)',
      'z.prototype',
      'z.__proto__',
      'z["constructor"]',
      'z.string()["url"]()',
    ]) {
      expect(thrown(() => sanitizeSchema(schema, 'x')).code, schema).toBe('MFEFLOW_E203');
    }
  });

  it('refuses anything that is not a literal-argument call chain on z, v or type', () => {
    for (const schema of [
      '',
      'z',
      'z.string',
      'fetch("https://evil.example")',
      'process.exit()',
      'eval("1")',
      'Function("1")()',
      'import("x")',
      'require("x")',
      'z.string(), evil()',
      'z.string().refine(() => true)',
      'z.string().refine(function () {})',
      'z.string(`x`)',
      'z.string().regex(/x/)',
      'z.string(x)',
      'z.string(undefined)',
      'z.string(...args)',
      'z?.string()',
      'z.string?.()',
      'z.object({ [key]: z.string() })',
      'z.object({ ...other })',
      'z.object({ a() {} })',
      'z.object({ get a() { return 1 } })',
      'await z.string()',
      'new z.string()',
      'z.string() ? 1 : 2',
      'z.string() + 1',
      '1n',
      'z.string();evil()',
      'z.string()\n;evil()',
      'a.b()',
      'z.String()',
      'z.string().url()!',
    ]) {
      expect(thrown(() => sanitizeSchema(schema, 'x')).code, schema).toBe('MFEFLOW_E203');
    }
  });

  it('caps size and depth', () => {
    const deep = `${'z.array('.repeat(40)}z.string()${')'.repeat(40)}`;
    expect(thrown(() => sanitizeSchema(deep, 'x')).code).toBe('MFEFLOW_E203');
    expect(thrown(() => sanitizeSchema(`z.literal('${'a'.repeat(2000)}')`, 'x')).code).toBe(
      'MFEFLOW_E203',
    );
  });
});

describe('sanitizeSchemas', () => {
  it('cleans a single text and every entry of a map', () => {
    expect(sanitizeSchemas('z.string().min(1)', 'x')).toBe('z.string().min(1)');
    expect(
      sanitizeSchemas({ zod: 'z.string()', valibot: 'v.pipe(v.string(), v.url())' }, 'x'),
    ).toEqual({
      zod: 'z.string()',
      valibot: 'v.pipe(v.string(), v.url())',
    });
  });

  it('refuses a map with one bad entry, naming the feature', () => {
    const error = thrown(() =>
      sanitizeSchemas({ zod: 'z.string()', valibot: 'process.exit(1)' }, 'evil'),
    );
    expect(error.code).toBe('MFEFLOW_E203');
    expect(error.message).toContain('evil');
  });
});
