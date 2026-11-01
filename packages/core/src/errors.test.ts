import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { errorDocsUrl } from '@mfeflow/contracts';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CATALOGUE,
  hasErrno,
  isMfeflowError,
  messageOf,
  MfeflowError,
  type ErrorCode,
} from './errors';

const isCode = (key: string): key is ErrorCode => key in ERROR_CATALOGUE;
const codes = Object.keys(ERROR_CATALOGUE).filter(isCode);

describe('error catalogue', () => {
  it('has well-formed codes in the documented ranges', () => {
    expect(codes.length).toBeGreaterThan(10);
    for (const code of codes) expect(code).toMatch(/^E[1-5]\d\d$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every code a title and a fix', () => {
    for (const code of codes) {
      expect(ERROR_CATALOGUE[code].title.length).toBeGreaterThan(8);
      expect(ERROR_CATALOGUE[code].fix.length).toBeGreaterThan(8);
    }
  });

  it('keeps feature errors in E2xx, registry errors in E4xx', () => {
    expect(codes.filter((c) => c.startsWith('E2')).length).toBeGreaterThan(5);
    expect(codes.filter((c) => c.startsWith('E4'))).toEqual(['E401', 'E402', 'E403', 'E404']);
  });
});

describe('error docs', () => {
  it('has a docs page stub for every code', () => {
    const docs = path.resolve(import.meta.dirname, '../../../apps/docs/docs/errors');
    const missing = codes.filter((code) => !existsSync(path.join(docs, `${code}.md`)));
    expect(missing).toEqual([]);
  });
});

describe('MfeflowError', () => {
  it('carries code, fix and docs link', () => {
    const error = new MfeflowError('E102', 'looked in /tmp');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('MfeflowError');
    expect(error.code).toBe('MFEFLOW_E102');
    expect(error.message).toBe('No mfeflow.json found: looked in /tmp');
    expect(error.docs).toBe(errorDocsUrl('E102'));
    expect(error.fix).toBe(ERROR_CATALOGUE.E102.fix);
  });

  it('formats as the three-line CLI message', () => {
    expect(new MfeflowError('E201', 'nope').format().split('\n')).toEqual([
      'MFEFLOW_E201 Feature not found: nope',
      `  Fix: ${ERROR_CATALOGUE.E201.fix}`,
      '  https://mfeflow.github.io/mfeflow/errors/E201',
    ]);
  });

  it('accepts a cause and a more specific fix', () => {
    const cause = new Error('boom');
    const error = new MfeflowError('E106', undefined, { cause, fix: 'try again' });
    expect(error.message).toBe(ERROR_CATALOGUE.E106.title);
    expect(error.cause).toBe(cause);
    expect(error.fix).toBe('try again');
  });

  it('is recognised by isMfeflowError', () => {
    expect(isMfeflowError(new MfeflowError('E201'))).toBe(true);
    expect(isMfeflowError(new Error('x'))).toBe(false);
  });
});

describe('helpers', () => {
  it('reads messages and errno codes', () => {
    expect(messageOf(new Error('a'))).toBe('a');
    expect(messageOf('b')).toBe('b');
    expect(hasErrno(Object.assign(new Error('x'), { code: 'ENOENT' }), 'ENOENT')).toBe(true);
    expect(hasErrno(new Error('x'), 'ENOENT')).toBe(false);
    expect(hasErrno('x', 'ENOENT')).toBe(false);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('testing.ts')
      ? [full]
      : [];
  });
}

describe('the engine throws only MfeflowError', () => {
  it('has no `throw new Error` in non-test source', () => {
    const offenders = sourceFiles(import.meta.dirname).filter((file) =>
      /throw new (Type|Range|Syntax)?Error\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('only throws codes that exist in the catalogue', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(import.meta.dirname)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/MfeflowError\(\s*'(E\d{3})'/g)) {
        used.add(m[1] ?? '');
      }
    }
    for (const code of used) expect(codes).toContain(code);
    expect(used.size).toBeGreaterThan(5);
  });
});
