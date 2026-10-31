import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashContent } from './hash';
import { emptyPlan, type Plan } from './plan';
import {
  findDiverged,
  findProjectRoot,
  loadProject,
  parseProject,
  recordPlan,
  saveProject,
  serializeProject,
  type MfeflowProject,
} from './project';
import { thrown } from './testing';

const project: MfeflowProject = {
  version: 1,
  topology: 'monorepo',
  packageManager: 'pnpm',
  scope: '@shopco',
  apps: { shell: { kind: 'shell', path: 'apps/shell' } },
  features: {},
};

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-project-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('hashContent', () => {
  it('ignores line-ending style', () => {
    expect(hashContent('a\r\nb\r\n')).toBe(hashContent('a\nb\n'));
    expect(hashContent('a')).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

describe('parseProject / serializeProject', () => {
  it('round-trips with the schema first and hashes sorted', () => {
    const text = serializeProject({
      ...project,
      files: { 'b.ts': hashContent('b'), 'a.ts': hashContent('a') },
    });
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.indexOf('$schema')).toBeLessThan(text.indexOf('"version"'));
    expect(text.indexOf('a.ts')).toBeLessThan(text.indexOf('b.ts'));
    expect(parseProject(text).files).toEqual({
      'a.ts': hashContent('a'),
      'b.ts': hashContent('b'),
    });
  });

  it('reports bad JSON as E103 and schema problems as E104 with the paths', () => {
    expect(thrown(() => parseProject('{')).code).toBe('MFEFLOW_E103');
    const bad = thrown(() => parseProject('{"version":2}'));
    expect(bad.code).toBe('MFEFLOW_E104');
    expect(bad.message).toContain('version must be 1');
    expect(thrown(() => serializeProject({ ...project, scope: 'nope' })).code).toBe('MFEFLOW_E104');
  });
});

describe('load / save', () => {
  it('saves and loads', async () => {
    await saveProject(root, project);
    expect(await loadProject(root)).toMatchObject({ scope: '@shopco' });
  });

  it('says E102 when there is no mfeflow.json', async () => {
    await expect(loadProject(root)).rejects.toMatchObject({ code: 'MFEFLOW_E102' });
  });

  it('finds the root from a nested folder', async () => {
    await saveProject(root, project);
    const nested = path.join(root, 'apps', 'shell');
    await fs.mkdir(nested, { recursive: true });
    expect(await findProjectRoot(nested)).toBe(root);
  });

  it('gives up at the filesystem root with E102', async () => {
    await expect(findProjectRoot(path.join(root, 'missing'))).rejects.toMatchObject({
      code: 'MFEFLOW_E102',
    });
  });
});

const plan = (changes: Plan['changes']): Plan => ({
  ...emptyPlan(),
  changes,
  features: [{ name: 'analytics-gtm', version: '0.3.0', options: { consent: 'denied' } }],
});

describe('recordPlan', () => {
  it('records the feature and hashes of tracked creates', () => {
    const next = recordPlan(
      project,
      plan([
        {
          path: 'a.ts',
          action: 'create',
          before: null,
          after: 'A',
          track: true,
          trust: 'first-party',
        },
        {
          path: 'b.ts',
          action: 'create',
          before: null,
          after: 'B',
          track: false,
          trust: 'first-party',
        },
      ]),
    );
    expect(next.features['analytics-gtm']).toEqual({
      version: '0.3.0',
      options: { consent: 'denied' },
    });
    expect(next.files).toEqual({ 'a.ts': hashContent('A') });
  });

  it('keeps hashes of tracked files in step with patches that start from the recorded content', () => {
    const tracked = { ...project, files: { 'a.ts': hashContent('A'), 'e.ts': hashContent('E') } };
    const next = recordPlan(
      tracked,
      plan([
        {
          path: 'a.ts',
          action: 'patch',
          before: 'A',
          after: 'A2',
          track: false,
          trust: 'first-party',
        },
        {
          path: 'e.ts',
          action: 'patch',
          before: 'E-edited-by-user',
          after: 'E2',
          track: false,
          trust: 'first-party',
        },
        {
          path: 'untracked.ts',
          action: 'patch',
          before: 'U',
          after: 'U2',
          track: false,
          trust: 'first-party',
        },
      ]),
    );
    expect(next.files).toEqual({ 'a.ts': hashContent('A2'), 'e.ts': hashContent('E') });
  });

  it('drops hashes of deleted files and omits an empty files map', () => {
    const tracked = { ...project, files: { 'a.ts': hashContent('A') } };
    const next = recordPlan(tracked, {
      ...emptyPlan(),
      changes: [
        {
          path: 'a.ts',
          action: 'delete',
          before: 'A',
          after: null,
          track: false,
          trust: 'first-party',
        },
      ],
    });
    expect(next.files).toBeUndefined();
  });

  it('records a feature without options', () => {
    const next = recordPlan(project, {
      ...emptyPlan(),
      features: [{ name: 'tsconfig', version: '1.0.0' }],
    });
    expect(next.features.tsconfig).toEqual({ version: '1.0.0' });
  });
});

describe('findDiverged', () => {
  it('reports edited and missing copied files only', async () => {
    await fs.writeFile(path.join(root, 'same.ts'), 'same\r\n');
    await fs.writeFile(path.join(root, 'edited.ts'), 'user change');
    const found = await findDiverged(root, {
      ...project,
      files: {
        'same.ts': hashContent('same\n'),
        'edited.ts': hashContent('original'),
        'gone.ts': hashContent('x'),
      },
    });
    expect(found).toEqual([
      { path: 'edited.ts', state: 'modified' },
      { path: 'gone.ts', state: 'missing' },
    ]);
  });

  it('returns nothing for a project without hashes', async () => {
    expect(await findDiverged(root, project)).toEqual([]);
  });
});
