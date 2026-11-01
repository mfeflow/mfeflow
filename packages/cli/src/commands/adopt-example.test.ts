import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isMfeManifest, validateMfeflowProject, validateRegistryEntry } from '@mfeflow/contracts';
import { parseProject } from '@mfeflow/core';
import { main } from '..';
import { EXIT } from '../exit';
import { readTree, removeDir, REPO, tempDir, testRuntime } from '../testing';
import { readPackageJson } from '../version';

const EXAMPLE = path.join(REPO, 'examples', 'adopt-existing');
const BUILD_FILES = [
  'apps/shell/rsbuild.config.ts',
  'apps/catalog/rsbuild.config.ts',
  'apps/checkout/rspack.config.mjs',
];

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

/** A throwaway copy of the example without installed packages or build output. */
async function copyOfExample(): Promise<string> {
  const dir = await tempDir();
  dirs.push(dir);
  const target = path.join(dir, 'adopt-existing');
  await fs.cp(EXAMPLE, target, {
    recursive: true,
    filter: (source) => !/[\\/](node_modules|dist)$/.test(source),
  });
  return target;
}

async function run(root: string, command: string[]) {
  const rt = testRuntime();
  const code = await main([...command, '--cwd', root, '--no-install'], rt);
  return { code, out: rt.io.out.join('\n') };
}

describe('examples/adopt-existing', () => {
  it('is a plain Module Federation app that does not use mfeflow', async () => {
    const tree = await readTree(await copyOfExample());
    expect(tree).not.toHaveProperty(['mfeflow.json']);
    expect(Object.keys(tree).filter((file) => file.endsWith('mfeflow.app.json'))).toEqual([]);
    for (const file of Object.keys(tree).filter((name) => name.endsWith('package.json'))) {
      expect(tree[file]).not.toContain('@mfeflow/');
    }
  });

  it('is adopted into the expected project, app files and registry entries', async () => {
    const root = await copyOfExample();
    const { code, out } = await run(root, ['adopt', '--yes']);
    expect(code).toBe(EXIT.ok);
    expect(out).toContain('Your build config was not changed');
    const tree = await readTree(root);

    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(validateMfeflowProject(project)).toEqual([]);
    expect(project).toMatchObject({
      topology: 'monorepo',
      packageManager: 'pnpm',
      scope: '@plain',
      apps: {
        catalog: { kind: 'remote', path: 'apps/catalog', port: 3001 },
        checkout: { kind: 'remote', path: 'apps/checkout', port: 3002 },
        shell: { kind: 'shell', path: 'apps/shell', port: 3000 },
      },
    });

    const exposes = { catalog: ['./ProductList'], checkout: ['./Checkout'], shell: [] };
    for (const [name, expected] of Object.entries(exposes)) {
      const app: unknown = JSON.parse(tree[`apps/${name}/mfeflow.app.json`] ?? '');
      expect(isMfeManifest(app)).toBe(true);
      expect(app).toMatchObject({
        name,
        owner: 'unassigned',
        exposes: expected,
        platform: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        shells: name === 'shell' ? [] : ['shell'],
      });
    }

    for (const env of ['dev', 'staging', 'prod']) {
      for (const remote of ['catalog', 'checkout']) {
        const entry: unknown = JSON.parse(tree[`registry/envs/${env}/${remote}.json`] ?? '');
        expect(validateRegistryEntry(entry)).toEqual([]);
      }
    }
    expect(JSON.parse(tree['registry/envs/dev/catalog.json'] ?? '')).toMatchObject({
      manifestUrl: 'http://localhost:3001/mf-manifest.json',
    });
    expect(JSON.parse(tree['registry/envs/dev/checkout.json'] ?? '')).toMatchObject({
      manifestUrl: 'http://localhost:3002/mf-manifest.json',
    });
    expect(tree['apps/shell/package.json']).toContain(
      `"@mfeflow/runtime": "^${readPackageJson().version}"`,
    );
  });

  it('passes mfeflow validate after adopt', async () => {
    const root = await copyOfExample();
    expect((await run(root, ['adopt', '--yes'])).code).toBe(EXIT.ok);
    const { code, out } = await run(root, ['validate']);
    expect(code).toBe(EXIT.ok);
    expect(out).toContain('0 error(s)');
  });

  it('leaves every build file and source file as it was', async () => {
    const root = await copyOfExample();
    const before = await readTree(root);
    expect((await run(root, ['adopt', '--yes'])).code).toBe(EXIT.ok);
    const after = await readTree(root);
    for (const file of BUILD_FILES) expect(after[file]).toBe(before[file]);
    const changed = Object.keys(before).filter((file) => after[file] !== before[file]);
    expect(changed).toEqual(['apps/shell/package.json']);
  });

  it('writes nothing on a dry run', async () => {
    const root = await copyOfExample();
    const before = await readTree(root);
    const { code, out } = await run(root, ['adopt', '--dry-run']);
    expect(code).toBe(EXIT.ok);
    expect(out).toContain('10 to create, 1 to patch, 0 to delete');
    expect(await readTree(root)).toEqual(before);
  });
});
