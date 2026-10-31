import { emptyPlan } from '@mfeflow/core';
import { describe, expect, it } from 'vitest';
import { planReport, validateResult, type InitResult } from './output';

const plan = {
  features: [{ name: 'core', version: '0.1.0' }],
  changes: [{ path: 'a.ts', action: 'create' as const }],
  dependencies: [{ file: 'package.json', name: 'react', range: 'catalog:', dev: false }],
  scripts: [{ file: 'package.json', name: 'dev', command: 'x' }],
  warnings: [],
};

const init: InitResult = {
  ok: true,
  command: 'init',
  dryRun: false,
  root: '/x',
  scope: '@x',
  apps: [{ name: 'shell', kind: 'shell', path: 'apps/shell', port: 4300 }],
  plan,
  written: ['a.ts'],
  installed: false,
  next: ['pnpm dev'],
};

describe('planReport', () => {
  it('lists each feature once and drops file contents', () => {
    const full = {
      ...emptyPlan(),
      features: [
        { name: 'core', version: '1' },
        { name: 'core', version: '1' },
      ],
      changes: [
        {
          path: 'a',
          action: 'create' as const,
          before: null,
          after: 'secret',
          track: true,
          trust: 'first-party' as const,
        },
      ],
    };
    const report = planReport(full);
    expect(report.features).toEqual([{ name: 'core', version: '1' }]);
    expect(JSON.stringify(report)).not.toContain('secret');
  });
});

describe('validateResult', () => {
  it('accepts each kind of result', () => {
    expect(validateResult(init)).toEqual([]);
    expect(
      validateResult({
        ...init,
        command: 'add',
        kind: 'remote',
        added: ['x'],
        skipped: [],
        apps: undefined,
        scope: undefined,
        next: undefined,
      }),
    ).toEqual([]);
    expect(
      validateResult({
        ...init,
        command: 'add',
        kind: 'env-key',
        added: ['API_ORIGIN'],
        skipped: [],
        apps: undefined,
        scope: undefined,
        next: undefined,
      }),
    ).toEqual([]);
    expect(
      validateResult({
        ok: true,
        command: 'features',
        search: null,
        features: [
          {
            name: 'a',
            version: '1',
            description: 'd',
            always: true,
            default: true,
            installed: false,
          },
        ],
      }),
    ).toEqual([]);
    expect(
      validateResult({
        ok: false,
        exitCode: 2,
        error: { code: 'MFEFLOW_E107', message: 'm', fix: 'f', docs: 'd' },
      }),
    ).toEqual([]);
  });

  it('names what is wrong, by path', () => {
    const paths = (value: unknown) => validateResult(value).map((i) => i.path);
    expect(paths(null)).toEqual(['']);
    expect(paths({ ok: true, command: 'deploy' })).toEqual(['command']);
    expect(paths({ ...init, ok: 'yes' })).toEqual(['ok']);
    expect(
      paths({ ...init, root: 1, apps: [{ name: 'a', kind: 'other', path: 'p', port: 'x' }] }),
    ).toEqual(['root', 'apps[0].kind', 'apps[0].port']);
    expect(paths({ ...init, plan: { ...plan, changes: [{ path: 'a', action: 'move' }] } })).toEqual(
      ['plan.changes[0].action'],
    );
    expect(paths({ ...init, plan: 1 })).toEqual(['plan']);
    expect(paths({ ok: false, error: 1 })).toEqual(['error', 'exitCode']);
    expect(paths({ ok: true, command: 'features', search: 1, features: [1] })).toEqual([
      'search',
      'features[0]',
    ]);
    expect(paths({ ...init, command: 'add', kind: 'x', added: 'a', skipped: [] })).toEqual([
      'kind',
      'added',
    ]);
  });

  it('wants a diff on a dry run and no written files', () => {
    expect(validateResult({ ...init, dryRun: true, written: [] }).map((i) => i.path)).toEqual([
      'diff',
    ]);
    expect(validateResult({ ...init, dryRun: true, diff: 'd' }).map((i) => i.path)).toEqual([
      'written',
    ]);
    expect(validateResult({ ...init, dryRun: true, written: [], diff: 'd' })).toEqual([]);
    expect(validateResult({ ...init, diff: 3 }).map((i) => i.path)).toEqual(['diff']);
  });
});
