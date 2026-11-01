import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectFederation } from '.';
import { guardedDisk, isInside, MAX_FILE_BYTES, type Refusal } from './disk';

const config = (name: string): string =>
  `import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
export default { plugins: [pluginModuleFederation({ name: '${name}', exposes: { './A': './a' } })] };
`;
const importing = `import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import mf from './link/secret';
export default { plugins: [pluginModuleFederation(mf)] };
`;

let base: string;
let root: string;
let outside: string;

async function canLink(): Promise<boolean> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-adopt-probe-'));
  try {
    await fs.symlink(dir, path.join(dir, 'probe'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const canSymlink = await canLink();
const link = (target: string, at: string): Promise<void> => fs.symlink(target, at, 'dir');

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-adopt-')));
  root = path.join(base, 'project');
  outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
});

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe('isInside', () => {
  it('compares whole segments, so a folder named ..x is inside', () => {
    const r = path.resolve('/virtual/root');
    expect(isInside(r, r)).toBe(true);
    expect(isInside(r, path.join(r, '..x', 'a'))).toBe(true);
    expect(isInside(r, path.join(r, '..'))).toBe(false);
    expect(isInside(r, path.join(r, '..', 'other'))).toBe(false);
  });
});

describe('guardedDisk', () => {
  it('reads files inside the root and returns undefined for missing ones', async () => {
    await fs.writeFile(path.join(root, 'a.ts'), 'x');
    const disk = guardedDisk(root, []);
    expect(await disk.read(path.join(root, 'a.ts'))).toBe('x');
    expect(await disk.read(path.join(root, 'missing.ts'))).toBeUndefined();
    expect(await disk.read(path.join(root, 'a.ts', 'deeper'))).toBeUndefined();
  });

  it.skipIf(!canSymlink)('refuses a symlink that leads outside the root', async () => {
    await fs.writeFile(path.join(outside, 'secret.ts'), 'export default {};');
    await link(outside, path.join(root, 'link'));
    const refused: Refusal[] = [];
    const disk = guardedDisk(root, refused);
    expect(await disk.read(path.join(root, 'link', 'secret.ts'))).toBeUndefined();
    expect(await disk.listDirs(path.join(root, 'link'))).toEqual([]);
    expect(refused.map((r) => r.file)).toEqual(['link/secret.ts', 'link']);
  });

  it('refuses node_modules and files over the size cap', async () => {
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'a.ts'), 'x');
    await fs.writeFile(path.join(root, 'big.ts'), 'x'.repeat(MAX_FILE_BYTES + 1));
    const refused: Refusal[] = [];
    const disk = guardedDisk(root, refused);
    expect(await disk.read(path.join(root, 'node_modules', 'a.ts'))).toBeUndefined();
    expect(await disk.read(path.join(root, 'big.ts'))).toBeUndefined();
    expect(refused).toEqual([
      { file: 'node_modules/a.ts', reason: 'is inside node_modules, which is never read' },
      { file: 'big.ts', reason: 'is larger than 1 MB, so it is not read' },
    ]);
  });

  it('records a folder read as a file instead of throwing', async () => {
    await fs.mkdir(path.join(root, 'dir.ts'));
    const refused: Refusal[] = [];
    expect(await guardedDisk(root, refused).read(path.join(root, 'dir.ts'))).toBeUndefined();
    expect(refused[0]?.reason).toMatch(/^could not be read \(/);
  });
});

describe('detectFederation on a real folder', () => {
  it.skipIf(!canSymlink)(
    'does not follow an import through a symlink that leaves the project',
    async () => {
      await fs.writeFile(path.join(outside, 'secret.ts'), "export default { name: 'stolen' };");
      await fs.writeFile(path.join(root, 'rsbuild.config.ts'), importing);
      await link(outside, path.join(root, 'link'));
      const report = await detectFederation(root);
      expect(report.apps).toEqual([]);
      expect(report.notAdopted).toContainEqual({
        dir: '.',
        file: 'link/secret.ts',
        field: 'file',
        reason: 'is (or goes through) a link that leads outside the project',
      });
    },
  );

  it.skipIf(!canSymlink)(
    'does not enter a workspace folder that is a symlink out of the root',
    async () => {
      await fs.mkdir(path.join(outside, 'app'));
      await fs.writeFile(path.join(outside, 'app', 'package.json'), '{"name":"evil"}');
      await fs.writeFile(path.join(outside, 'app', 'rsbuild.config.ts'), config('evil'));
      await fs.writeFile(path.join(root, 'package.json'), '{"workspaces":["pkgs/app"]}');
      await fs.mkdir(path.join(root, 'pkgs'));
      await link(path.join(outside, 'app'), path.join(root, 'pkgs', 'app'));
      const report = await detectFederation(root);
      expect(report.apps).toEqual([]);
      expect(report.notAdopted.map((n) => n.file)).toContain('pkgs/app/package.json');
    },
  );

  it.skipIf(!canSymlink)(
    'reads an app when the scanned folder itself is reached through a symlink',
    async () => {
      await fs.writeFile(path.join(root, 'rsbuild.config.ts'), config('inside'));
      const alias = path.join(base, 'alias');
      await link(root, alias);
      expect((await detectFederation(alias)).apps.map((a) => a.name)).toEqual(['inside']);
    },
  );

  it('reports a config over the size cap and one that is a folder', async () => {
    await fs.writeFile(path.join(root, 'rsbuild.config.ts'), 'x'.repeat(MAX_FILE_BYTES + 1));
    await fs.mkdir(path.join(root, 'webpack.config.js'));
    const report = await detectFederation(root);
    expect(report.apps).toEqual([]);
    expect(report.notAdopted.map((n) => [n.file, n.reason.split(' (')[0]])).toEqual([
      ['rsbuild.config.ts', 'is larger than 1 MB, so it is not read'],
      ['webpack.config.js', 'could not be read'],
    ]);
  });
});
