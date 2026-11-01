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
});
