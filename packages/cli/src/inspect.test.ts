import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expandGlobs, versionIn } from './inspect';
import { removeDir, tempDir } from './testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function put(dir: string, name: string, version: string): Promise<void> {
  const at = path.join(dir, 'node_modules', ...name.split('/'));
  await fs.mkdir(at, { recursive: true });
  await fs.writeFile(path.join(at, 'package.json'), JSON.stringify({ name, version }));
}

async function layout(): Promise<{ outer: string; root: string; app: string }> {
  const outer = await tempDir();
  dirs.push(outer);
  const root = path.join(outer, 'project');
  const app = path.join(root, 'apps', 'cart');
  await fs.mkdir(app, { recursive: true });
  return { outer, root, app };
}

const view = (dir: string, deps: Record<string, string> = {}) => ({ dir, pkg: { deps } });

describe('versionIn', () => {
  it('reads the nearest install, walking up to the project root', async () => {
    const { root, app } = await layout();
    await put(root, 'react', '19.3.1');
    expect(await versionIn(view(app), 'react', root)).toBe('19.3.1');
    await put(app, 'react', '19.2.0');
    expect(await versionIn(view(app), 'react', root)).toBe('19.2.0');
  });

  it('does not walk above the project root', async () => {
    const { outer, root, app } = await layout();
    await put(outer, 'react', '17.0.2');
    expect(await versionIn(view(app, { react: '^19.0.0' }), 'react', root)).toBe('^19.0.0');
    expect(await versionIn(view(app), 'react', root)).toBeUndefined();
  });

  it('only looks up packages the app declares or the shared list names', async () => {
    const { root, app } = await layout();
    await put(app, 'left-pad', '1.0.0');
    await put(app, 'react', '19.3.1');
    expect(await versionIn(view(app), 'left-pad', root)).toBeUndefined();
    expect(await versionIn(view(app, { 'left-pad': '^1.0.0' }), 'left-pad', root)).toBe('1.0.0');
    expect(await versionIn({ dir: app, pkg: undefined }, 'react', root)).toBe('19.3.1');
  });
});

describe('expandGlobs', () => {
  async function folders(...rels: string[]): Promise<string> {
    const root = await tempDir();
    dirs.push(root);
    await Promise.all(rels.map((rel) => fs.mkdir(path.join(root, rel), { recursive: true })));
    return root;
  }

  it('expands dir/* and plain paths, once each', async () => {
    const root = await folders('apps/a', 'apps/b', 'packages/ui', 'node_modules/x');
    expect(await expandGlobs(root, ['apps/*', 'packages/ui', 'apps/a'])).toEqual([
      'apps/a',
      'apps/b',
      'packages/ui',
    ]);
  });

  it('applies ! exclusions, by path and by pattern', async () => {
    const root = await folders(
      'apps/a',
      'apps/b',
      'packages/ui',
      'packages/legacy',
      'tools/x/fixtures',
    );
    expect(
      await expandGlobs(root, ['apps/*', 'packages/*', 'tools/*', '!packages/legacy', '!apps/b']),
    ).toEqual(['apps/a', 'packages/ui', 'tools/x']);
    expect(await expandGlobs(root, ['apps/*', 'packages/*', '!**/l*'])).toEqual([
      'apps/a',
      'apps/b',
      'packages/ui',
    ]);
    expect(await expandGlobs(root, ['apps/*', 'tools/x/fixtures', '!tools/**'])).toEqual([
      'apps/a',
      'apps/b',
    ]);
  });

  it('does not let an exclusion match part of a name or an unrelated folder', async () => {
    const root = await folders('packages/ui', 'packages/ui-kit', 'other/ui');
    expect(await expandGlobs(root, ['packages/*', 'other/*', '!packages/ui'])).toEqual([
      'packages/ui-kit',
      'other/ui',
    ]);
  });
});
