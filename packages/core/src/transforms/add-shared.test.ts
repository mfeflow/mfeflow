import { describe, expect, it } from 'vitest';
import { thrown } from '../testing.js';
import { addShared } from './add-shared.js';

const run = (source: string, name: string, list?: string, file = 'singletons.ts') =>
  addShared(source, file, { op: 'add-shared', file, name, ...(list ? { list } : {}) });

describe('add-shared', () => {
  it('appends to a multi-line array and keeps comments', () => {
    const source = `export const singletons = [\n  'react',\n  'react-dom', // dom\n] as const;\n`;
    expect(run(source, 'zod')).toBe(
      `export const singletons = [\n  'react',\n  'react-dom', // dom\n  'zod',\n] as const;\n`,
    );
  });

  it('adds the missing comma when the last item has none', () => {
    expect(run(`export const singletons = [\n  'react'\n];\n`, 'zod')).toBe(
      `export const singletons = [\n  'react',\n  'zod'\n];\n`,
    );
  });

  it('appends to a one-line array, an empty array, and uses the file quote style', () => {
    expect(run(`export const singletons = ['react'];\n`, 'zod')).toBe(
      `export const singletons = ['react', 'zod'];\n`,
    );
    expect(run(`export const singletons = [];\n`, 'zod')).toBe(
      `export const singletons = ['zod'];\n`,
    );
    expect(run(`export const singletons = ["react"];\n`, 'zod')).toBe(
      `export const singletons = ["react", "zod"];\n`,
    );
  });

  it('finds an array under a config key and behind satisfies', () => {
    const config = `export default createShellConfig({\n  name: 'shell',\n  singletons: ['react'],\n});\n`;
    expect(run(config, 'zod')).toContain("singletons: ['react', 'zod']");
    expect(run(`export const list = ['a'] satisfies string[];\n`, 'b', 'list')).toBe(
      `export const list = ['a', 'b'] satisfies string[];\n`,
    );
  });

  it('is idempotent and leaves a listed package alone', () => {
    const source = `export const singletons = [\n  'react',\n];\n`;
    expect(run(source, 'react')).toBe(source);
    const once = run(source, 'zod');
    expect(run(once, 'zod')).toBe(once);
  });

  it('fails with E208 when the array is missing', () => {
    expect(thrown(() => run('export const other = [];\n', 'zod')).code).toBe('MFEFLOW_E208');
  });
});
