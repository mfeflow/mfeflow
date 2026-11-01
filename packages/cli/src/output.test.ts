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
            source: 'mfeflow',
            name: 'a',
            version: '1',
            description: 'd',
            always: true,
            default: true,
            installed: false,
          },
        ],
        registries: [
          {
            namespace: '@test',
            index: 'https://x/index.json',
            trusted: true,
            items: 1,
            error: null,
          },
          {
            namespace: '@down',
            index: 'https://y/index.json',
            trusted: false,
            items: 0,
            error: { code: 'MFEFLOW_E401', message: 'm', fix: 'f', docs: 'd' },
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
    expect(
      paths({ ok: true, command: 'features', search: 1, features: [1], registries: [] }),
    ).toEqual(['search', 'features[0]']);
    expect(
      paths({
        ok: true,
        command: 'features',
        search: null,
        features: [],
        registries: [
          { namespace: 1, index: 'i', trusted: true, items: 'x', error: 1 },
          { namespace: '@a', index: 'i', trusted: 'no', items: 0, error: { code: 1 } },
        ],
      }),
    ).toEqual([
      'registries[0].namespace',
      'registries[0].items',
      'registries[0].error',
      'registries[1].trusted',
      'registries[1].error.code',
      'registries[1].error.message',
      'registries[1].error.fix',
      'registries[1].error.docs',
    ]);
    const registry = {
      ok: true,
      command: 'registry',
      action: 'build',
      dryRun: false,
      root: null,
      changed: false,
      registries: [{ namespace: '@a', url: 'u', index: 'i', trusted: true }],
      build: {
        namespace: '@a',
        out: 'o',
        features: [{ name: '@a/x', version: '1' }],
        files: ['x'],
      },
    };
    expect(paths(registry)).toEqual([]);
    expect(paths({ ...registry, action: 'move', dryRun: 1, root: 3 })).toEqual([
      'action',
      'dryRun',
      'root',
    ]);
    expect(
      paths({ ...registry, registries: [{ namespace: 1 }], build: { features: [1], files: 1 } }),
    ).toEqual([
      'registries[0].namespace',
      'registries[0].url',
      'registries[0].index',
      'registries[0].trusted',
      'build.namespace',
      'build.out',
      'build.files',
      'build.features[0]',
    ]);
    expect(paths({ ...registry, build: 1 })).toEqual(['build']);
    expect(paths({ ...registry, root: '/p', build: null })).toEqual([]);
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
