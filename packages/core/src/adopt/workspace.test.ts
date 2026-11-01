import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryFs } from './testing';
import { findAppDirs, globToRegExp, type WorkspaceProblem } from './workspace';

const root = path.resolve('/virtual/project');

async function dirs(files: Record<string, string>, problems: WorkspaceProblem[] = []) {
  const fs = memoryFs(root, files);
  return findAppDirs(root, fs.read, fs.listDirs, problems);
}

describe('findAppDirs', () => {
  it('is just the folder when there is no workspace', async () => {
    expect(await dirs({ 'package.json': '{}' })).toEqual(['.']);
  });

  it('expands pnpm workspace globs, needs a package.json, and honours negation', async () => {
    expect(
      await dirs({
        'pnpm-workspace.yaml':
          "packages:\n  - 'apps/*'\n  - './tools/cli/'\n  - '!apps/legacy-*'\n",
        'apps/shell/package.json': '{}',
        'apps/legacy-admin/package.json': '{}',
        'apps/notes/README.md': '',
        'tools/cli/package.json': '{}',
      }),
    ).toEqual(['.', 'apps/shell', 'tools/cli']);
  });

  it('walks ** but never into node_modules, build output or hidden folders', async () => {
    expect(
      await dirs({
        'package.json': JSON.stringify({ workspaces: { packages: ['packages/**'] } }),
        'packages/a/package.json': '{}',
        'packages/a/node_modules/dep/package.json': '{}',
        'packages/group/b/package.json': '{}',
        'packages/dist/package.json': '{}',
        'packages/dist-ssr/package.json': '{}',
        'packages/.cache/package.json': '{}',
      }),
    ).toEqual(['.', 'packages/a', 'packages/group/b']);
  });

  it('reads package.json workspaces as a list and ignores patterns that leave the folder', async () => {
    expect(
      await dirs({
        'package.json': JSON.stringify({ workspaces: ['../outside', 'node_modules/x', 'web'] }),
        'web/package.json': '{}',
      }),
    ).toEqual(['.', 'web']);
  });

  it('reports workspace files it cannot read', async () => {
    const problems: WorkspaceProblem[] = [];
    await dirs({ 'pnpm-workspace.yaml': 'packages: [', 'package.json': '{' }, problems);
    await dirs(
      { 'pnpm-workspace.yaml': 'packages: apps', 'package.json': '{"workspaces": 1}' },
      problems,
    );
    expect(problems).toEqual([
      { file: 'pnpm-workspace.yaml', reason: 'could not be parsed' },
      { file: 'package.json', reason: 'could not be parsed' },
      { file: 'pnpm-workspace.yaml', reason: 'packages is not a list' },
      { file: 'package.json', reason: 'workspaces is not a list' },
    ]);
  });

  it('treats a yaml file without packages as empty', async () => {
    expect(await dirs({ 'pnpm-workspace.yaml': 'catalog: {}\n' })).toEqual(['.']);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['apps/*', 'apps/shell', true],
    ['apps/*', 'apps/a/b', false],
    ['apps/**', 'apps/a/b', true],
    ['**/legacy', 'x/y/legacy', true],
    ['**/legacy', 'legacy', true],
    ['apps/**/web', 'apps/web', true],
    ['**', 'anything/at/all', true],
    ['a.b/*', 'axb/c', false],
  ])('%s matches %s: %s', (glob, dir, expected) => {
    expect(globToRegExp(glob).test(dir)).toBe(expected);
  });

  it('does not blow up on repeated ** and visits each folder once', async () => {
    const files: Record<string, string> = { 'package.json': '{"workspaces":["**/**/**/**"]}' };
    for (const a of 'abcd') for (const b of 'abcd') files[`${a}/${b}/package.json`] = '{}';
    let calls = 0;
    const fs = memoryFs(root, files);
    const found = await findAppDirs(root, fs.read, (dir) => {
      calls += 1;
      return fs.listDirs(dir);
    });
    expect(found).toHaveLength(17);
    expect(calls).toBeLessThan(40);
  });

  it('stops after 5000 folders and says so', async () => {
    const problems: WorkspaceProblem[] = [];
    const fs = memoryFs(root, { 'package.json': '{"workspaces":["**"]}' });
    await findAppDirs(
      root,
      fs.read,
      () => Promise.resolve(Array.from({ length: 6 }, (_, i) => `d${String(i)}`)),
      problems,
    );
    expect(problems.map((p) => p.reason)).toEqual([
      'has more than 5000 folders to search, so the workspace globs were cut short',
    ]);
  });

  it('reports a folder that cannot be listed and a package.json that cannot be read', async () => {
    const problems: WorkspaceProblem[] = [];
    const fs = memoryFs(root, {
      'package.json': '{"workspaces":["apps/*","libs/*"]}',
      'libs/x/package.json': '{}',
    });
    const found = await findAppDirs(
      root,
      (file) =>
        file.endsWith(path.join('libs', 'x', 'package.json'))
          ? Promise.reject(new Error('EISDIR: is a directory'))
          : fs.read(file),
      (dir) =>
        dir.endsWith('apps') ? Promise.reject(new Error('EACCES: denied')) : fs.listDirs(dir),
      problems,
    );
    expect(found).toEqual(['.']);
    expect(problems).toEqual([
      { file: 'apps', reason: 'could not be listed (EACCES: denied)' },
      { file: 'package.json', reason: 'could not be read (EISDIR: is a directory)' },
    ]);
  });
});
