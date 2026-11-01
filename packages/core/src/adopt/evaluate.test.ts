import { describe, expect, it } from 'vitest';
import { parseSource } from '../transforms/ast';
import { evaluate, scopeOf, type Value } from './evaluate';

/** Evaluates the default export of `source`, written as a TypeScript file. */
function run(source: string): { ok: true; value: Value } | { ok: false; reason: string } {
  const scope = scopeOf(parseSource(source, 'config.ts'), 'config.ts');
  return evaluate(scope.exports.get('default'), scope);
}

describe('evaluate', () => {
  it.each([
    ["export default 'a';", 'a'],
    ['export default -1;', -1],
    ['export default `plain`;', 'plain'],
    ['export default null;', null],
    ['export default { a: [1, true], "b-c": "d" };', { a: [1, true], 'b-c': 'd' }],
    ['const port = 3000 as const; export default port;', 3000],
    ['const a = { x: 1 }; export default { ...a, y: 2 };', { x: 1, y: 2 }],
    ['const a = 1; const b = a; export default b!;', 1],
    ['const a = "v"; export default <string>a;', 'v'],
    ['const a = { x: 1 } satisfies object; export default a;', { x: 1 }],
  ])('reads %s', (source, value) => {
    expect(run(source)).toEqual({ ok: true, value });
  });

  it.each([
    ['export default `x${y}`;', 'is a template string with ${} parts'],
    ['export default getRemotes(env);', 'comes from a function call (getRemotes())'],
    ['export default config.build();', 'comes from a function call (config.build())'],
    [
      'export default Number(process.env.PORT) || 3000;',
      'reads an env variable (process.env.PORT)',
    ],
    ['export default parseInt(process.env.PORT);', 'reads an env variable (process.env.PORT)'],
    ["export default process.env['REMOTE'];", 'reads an env variable (process.env.REMOTE)'],
    ['export default process.env[key];', 'reads an env variable (process.env)'],
    [
      'export default import.meta.env.VITE_URL;',
      'reads an env variable (import.meta.env.VITE_URL)',
    ],
    ['export default new Map();', 'is built with new Map()'],
    ['export default () => 1;', 'is a function'],
    ['export default function () {}', 'is not a literal (FunctionDeclaration)'],
    ['export default deps.react;', 'is read from another value (deps.react)'],
    ['export default dev ? 1 : 2;', 'depends on a condition (a ? b : c)'],
    ['export default 1 + 2;', 'is computed with +'],
    ['export default await load();', 'is awaited'],
    ['export default !flag;', 'is not a literal (UnaryExpression)'],
    ['export default foo;', 'refers to foo, which is not a const in this file'],
    ["import imp from 'pkg'; export default imp;", "is imported (imp from 'pkg')"],
    ["const { a } = require('./a'); export default a;", "is imported (a from './a')"],
    ["const a = require('./a').b; export default a;", "is imported (a from './a')"],
    ['let v = 1; export default v;', 'refers to v, which is a let variable'],
    ['function f() {} export default f;', 'refers to f, which is a function or class'],
    ['const { a } = obj; export default a;', 'refers to a, which is a destructured value'],
    ['const a = b; const b = a; export default a;', 'refers to a, which refers back to itself'],
    [
      "import base from './base'; export default { ...base };",
      "spreads an imported object (base from './base')",
    ],
    ['export default { ...make() };', 'spreads a value that comes from a function call (make())'],
    [
      'export default { ...missing };',
      'spreads a value that refers to missing, which is not a const in this file',
    ],
    [
      'const list = [1]; export default { ...list };',
      'spreads a value that is not a literal (ArrayExpression)',
    ],
    ['export default { [key]: 1 };', 'has a computed key'],
    ['export default { m() {} };', 'm is a method'],
    ['export default { a: { b: process.env.B } };', 'a b reads an env variable (process.env.B)'],
    ['export default [1, , 2];', 'has an empty slot'],
    ['export default [...items];', 'spreads into an array'],
    ['export default [1, call()];', 'comes from a function call (call())'],
  ])('rejects %s', (source, reason) => {
    expect(run(source)).toEqual({ ok: false, reason });
  });

  it('reports a missing value', () => {
    expect(run('export const a = 1;')).toEqual({ ok: false, reason: 'is missing' });
  });
});

describe('scopeOf', () => {
  it('reads named, renamed and CommonJS exports', () => {
    const scope = scopeOf(
      parseSource('const a = 1; export const b = 2; export { a as c };', 'x.ts'),
      'x.ts',
    );
    expect([...scope.exports.keys()].toSorted()).toEqual(['b', 'c']);
    const cjs = scopeOf(parseSource('module.exports = { a: 1 };', 'x.cjs'), 'x.cjs');
    expect(cjs.exports.has('default')).toBe(true);
  });

  it('binds namespace imports', () => {
    const scope = scopeOf(parseSource("import * as ns from 'pkg';", 'x.ts'), 'x.ts');
    expect(scope.bindings.get('ns')).toEqual({ kind: 'import', source: 'pkg', imported: '*' });
  });
});
