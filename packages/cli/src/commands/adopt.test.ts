import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMfeManifest, validateMfeflowProject, validateRegistryEntry } from '@mfeflow/contracts';
import { hashContent, parseProject } from '@mfeflow/core';
import { emptyPlan, type FileChange } from '@mfeflow/core';
import { main, validateResult, type AdoptResult } from '..';
import { assertBuildConfigUntouched, assertNoProjectFile } from './adopt';
import { EXIT } from '../exit';
import { readTree, removeDir, REPO, scriptedPrompter, tempDir, testRuntime } from '../testing';
import { readPackageJson } from '../version';

const FIXTURES = path.join(REPO, 'packages', 'core', 'test-fixtures', 'adopt');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

/** A throwaway copy of a detector fixture, so no test ever writes into the repo. */
async function copyOf(fixture: string): Promise<string> {
  const dir = await tempDir();
  dirs.push(dir);
  const target = path.join(dir, fixture);
  await fs.cp(path.join(FIXTURES, fixture), target, { recursive: true });
  return target;
}

async function adopt(cwd: string, flags: string[] = [], rt = testRuntime()) {
  const code = await main(['adopt', '--cwd', cwd, '--no-install', ...flags], rt);
  return { code, rt };
}

function jsonOf(out: string[]): AdoptResult {
  const value: unknown = JSON.parse(out.join(''));
  expect(validateResult(value)).toEqual([]);
  return value as AdoptResult;
}

function dependenciesOf(tree: Record<string, string>, file: string): Record<string, unknown> {
  const pkg: unknown = JSON.parse(tree[file] ?? '{}');
  const deps =
    typeof pkg === 'object' && pkg !== null && 'dependencies' in pkg ? pkg.dependencies : {};
  return typeof deps === 'object' && deps !== null ? Object.fromEntries(Object.entries(deps)) : {};
}

async function hashFiles(root: string, files: string[]): Promise<Record<string, string>> {
  const tree = await readTree(root);
  return Object.fromEntries(files.map((file) => [file, hashContent(tree[file] ?? 'MISSING')]));
}

/** The build config files the detector itself lists, found with a dry run. */
async function listedBuildFiles(root: string): Promise<string[]> {
  const { rt } = await adopt(root, ['--dry-run', '--json']);
  return jsonOf(rt.io.out).buildConfig;
}

describe('mfeflow adopt', () => {
  it('adopts an rsbuild shell with a module-federation.config and loads its remote from outside the folder', async () => {
    const root = await copyOf('rsbuild-consumer');
    const { code, rt } = await adopt(root, ['--yes']);
    expect(code).toBe(EXIT.ok);
    const tree = await readTree(root);
    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(project).toMatchObject({
      topology: 'monorepo',
      packageManager: 'pnpm',
      cli: readPackageJson().version,
      apps: { consumer: { kind: 'shell', path: '.', port: 2000 } },
      features: {},
    });
    expect(project.scope).toMatch(/^@/);
    expect(validateMfeflowProject(project)).toEqual([]);
    const app: unknown = JSON.parse(tree['mfeflow.app.json'] ?? '');
    expect(isMfeManifest(app)).toBe(true);
    expect(app).toMatchObject({ name: 'consumer', owner: 'unassigned', routes: [], exposes: [] });
    expect(dependenciesOf(tree, 'package.json')['@mfeflow/runtime']).toBe(
      `^${readPackageJson().version}`,
    );
    expect(Object.keys(tree).some((file) => file.startsWith('registry/'))).toBe(false);
    expect(rt.io.out.join('\n')).toContain('provider');
  });

  it('adopts a webpack host', async () => {
    const root = await copyOf('webpack-esm');
    expect((await adopt(root, ['--yes'])).code).toBe(EXIT.ok);
    const tree = await readTree(root);
    expect(parseProject(tree['mfeflow.json'] ?? '').apps).toEqual({
      host: { kind: 'shell', path: '.', port: 8080 },
    });
    expect(tree['mfeflow.app.json']).toContain('"name": "host"');
  });

  it('adopts a workspace of an rsbuild shell, an rspack remote and a webpack remote', async () => {
    const root = await copyOf('monorepo');
    const { code, rt } = await adopt(root, ['--yes']);
    expect(code).toBe(EXIT.ok);
    const tree = await readTree(root);
    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(project.apps).toEqual({
      catalog: { kind: 'remote', path: 'apps/catalog', port: 3001 },
      checkout: { kind: 'remote', path: 'apps/checkout', port: 3002 },
      shell: { kind: 'shell', path: 'apps/shell', port: 3000 },
    });
    expect(project.scope).toBe('@shop');
    for (const name of ['shell', 'catalog', 'checkout']) {
      const app: unknown = JSON.parse(tree[`apps/${name}/mfeflow.app.json`] ?? '');
      expect(isMfeManifest(app)).toBe(true);
    }
    expect(JSON.parse(tree['apps/catalog/mfeflow.app.json'] ?? '')).toMatchObject({
      shells: ['shell'],
      exposes: ['./ProductList'],
      platform: { react: '^19.0.0' },
    });
    const dev: unknown = JSON.parse(tree['registry/envs/dev/catalog.json'] ?? '');
    expect(validateRegistryEntry(dev)).toEqual([]);
    expect(dev).toMatchObject({ manifestUrl: 'http://localhost:3001/mf-manifest.json' });
    for (const env of ['dev', 'staging', 'prod']) {
      for (const remote of ['catalog', 'checkout']) {
        expect(tree).toHaveProperty([`registry/envs/${env}/${remote}.json`]);
      }
    }
    expect(dependenciesOf(tree, 'apps/shell/package.json')).toHaveProperty(['@mfeflow/runtime']);
    expect(dependenciesOf(tree, 'apps/catalog/package.json')).toEqual({});
    expect(rt.io.out.join('\n')).toContain('routes are empty');
  });

  it.each(['monorepo', 'rsbuild-consumer', 'webpack-esm'])(
    'leaves a %s project that mfeflow validate accepts',
    async (fixture) => {
      const root = await copyOf(fixture);
      expect((await adopt(root, ['--yes'])).code).toBe(EXIT.ok);
      const check = testRuntime();
      expect(await main(['validate', '--cwd', root, '--json'], check)).toBe(EXIT.ok);
      expect(JSON.parse(check.io.out.join(''))).toMatchObject({ ok: true });
    },
  );

  it('refuses, and keeps the file, when mfeflow.json appears after the first check', async () => {
    const root = await copyOf('webpack-esm');
    const target = path.join(root, 'mfeflow.json');
    const original = fs.readFile.bind(fs);
    let reads = 0;
    const spy = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (args[0] === target && ++reads === 2) await fs.writeFile(target, '{"mine":true}\n');
      return original(...args);
    });
    try {
      const { code, rt } = await adopt(root, ['--yes']);
      expect(code).toBe(EXIT.project);
      expect(rt.io.err.join('\n')).toContain('MFEFLOW_E123');
    } finally {
      spy.mockRestore();
    }
    expect(await fs.readFile(target, 'utf8')).toBe('{"mine":true}\n');
  });

  it('has guards that stop a plan with mfeflow.json or a build config in it', () => {
    expect(() => assertNoProjectFile({ ...emptyPlan(), projectBefore: '{}' })).toThrow(
      /E123|already/,
    );
    expect(() => assertNoProjectFile({ ...emptyPlan(), projectBefore: null })).not.toThrow();
    const change: FileChange = {
      path: 'mf.options.ts',
      action: 'patch',
      before: 'a',
      after: 'b',
      track: false,
      trust: 'first-party',
    };
    const plan = { ...emptyPlan(), changes: [change] };
    expect(() => assertBuildConfigUntouched(plan, ['mf.options.ts'])).toThrow(/mf\.options\.ts/);
    expect(() => assertBuildConfigUntouched(plan, ['rsbuild.config.ts'])).not.toThrow();
  });

  it('never changes a build config file, even when it writes', async () => {
    for (const fixture of ['monorepo', 'rsbuild-consumer', 'webpack-esm']) {
      // oxlint-disable-next-line no-await-in-loop -- one temp copy at a time
      const root = await copyOf(fixture);
      // oxlint-disable-next-line no-await-in-loop -- hash, run, hash again
      const listed = await listedBuildFiles(root);
      // oxlint-disable-next-line no-await-in-loop -- as above
      const before = await hashFiles(root, listed);
      expect(listed.length).toBeGreaterThan(0);
      // oxlint-disable-next-line no-await-in-loop -- as above
      expect((await adopt(root, ['--yes'])).code).toBe(EXIT.ok);
      // oxlint-disable-next-line no-await-in-loop -- as above
      expect(await hashFiles(root, listed)).toEqual(before);
    }
  });

  it('says it left the build config alone and prints the snippet to paste', async () => {
    const root = await copyOf('webpack-esm');
    const { rt } = await adopt(root, ['--dry-run']);
    const out = rt.io.out.join('\n');
    expect(out).toContain('Your build config was not changed (webpack.config.mjs)');
    expect(out).toContain("'@mfeflow/runtime': { singleton: true },");
  });

  it('refuses when mfeflow.json exists and leaves everything as it is', async () => {
    const root = await copyOf('monorepo');
    await fs.writeFile(path.join(root, 'mfeflow.json'), '{}\n');
    const before = await readTree(root);
    const { code, rt } = await adopt(root, ['--yes']);
    expect(code).toBe(EXIT.project);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E123');
    expect(await readTree(root)).toEqual(before);
  });

  it('prints every part it did not carry over, with the reason', async () => {
    const root = await copyOf('rsbuild-consumer');
    const { code, rt } = await adopt(root, ['--dry-run']);
    expect(code).toBe(EXIT.ok);
    const out = rt.io.out.join('\n');
    expect(out).toContain('not carried over:');
    expect(out).toContain(
      'module-federation.config.ts shareStrategy: is set in the config but adopt does not carry it over',
    );
  });

  it('keeps going and exits 0 when some parts were not adopted', async () => {
    const root = await copyOf('monorepo');
    await fs.writeFile(
      path.join(root, 'apps', 'shell', 'rsbuild.config.mjs'),
      `import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { getRemotes } from './remotes.mjs';

export default defineConfig({
  server: { port: 3000 },
  plugins: [pluginModuleFederation({ name: 'shell', remotes: getRemotes(), shared: {} })],
});
`,
    );
    const { code, rt } = await adopt(root, ['--yes', '--json']);
    expect(code).toBe(EXIT.ok);
    const result = jsonOf(rt.io.out);
    expect(result.notAdopted).toContainEqual(
      expect.objectContaining({ dir: 'apps/shell', field: 'remotes' }),
    );
    expect(await readTree(root)).toHaveProperty(['mfeflow.json']);
  });

  it('answers --json with the documented shape', async () => {
    const root = await copyOf('monorepo');
    const { code, rt } = await adopt(root, ['--dry-run', '--json']);
    expect(code).toBe(EXIT.ok);
    const result = jsonOf(rt.io.out);
    expect(result).toMatchObject({
      ok: true,
      command: 'adopt',
      dryRun: true,
      written: [],
      installed: false,
      scope: '@shop',
      buildConfig: [
        'apps/catalog/rspack.config.ts',
        'apps/checkout/webpack.config.cjs',
        'apps/shell/rsbuild.config.mjs',
      ],
    });
    expect(result.apps.map((app) => app.name)).toEqual(['catalog', 'checkout', 'shell']);
    expect(result.plan.changes.map((c) => c.path)).toContain('mfeflow.json');
    expect(result.plan.dependencies).toEqual([
      expect.objectContaining({ file: 'apps/shell/package.json', name: '@mfeflow/runtime' }),
    ]);
    expect(result.diff).toContain('mfeflow.app.json');
    expect(result.snippet).toContain('@mfeflow/runtime');
    expect(Array.isArray(result.notAdopted)).toBe(true);
  });

  it('writes nothing on --dry-run', async () => {
    const root = await copyOf('monorepo');
    const before = await readTree(root);
    const { code, rt } = await adopt(root, ['--dry-run']);
    expect(code).toBe(EXIT.ok);
    expect(await readTree(root)).toEqual(before);
    expect(rt.io.out.join('\n')).toContain('Dry run: nothing was written.');
  });

  it('exits 2 and writes nothing without a terminal or --yes', async () => {
    const root = await copyOf('monorepo');
    const before = await readTree(root);
    const plain = await adopt(root);
    expect(plain.code).toBe(EXIT.usage);
    expect(plain.rt.io.err.join('\n')).toContain('--yes');
    const asJson = await adopt(root, ['--json']);
    expect(asJson.code).toBe(EXIT.usage);
    expect(JSON.parse(asJson.rt.io.out.join(''))).toMatchObject({
      ok: false,
      error: { code: 'MFEFLOW_E107' },
      exitCode: EXIT.usage,
    });
    expect(await readTree(root)).toEqual(before);
  });

  it('asks in a terminal and writes nothing when the answer is no', async () => {
    const root = await copyOf('monorepo');
    const before = await readTree(root);
    const prompter = scriptedPrompter([false]);
    const rt = testRuntime({ prompter });
    rt.io.interactive = true;
    const { code } = await adopt(root, [], rt);
    expect(code).toBe(EXIT.cancelled);
    expect(prompter.asked).toEqual(['Write these changes?']);
    expect(await readTree(root)).toEqual(before);
  });

  it('writes after a yes in a terminal and installs the new dependency', async () => {
    const root = await copyOf('webpack-esm');
    const rt = testRuntime({ prompter: scriptedPrompter([true]) });
    rt.io.interactive = true;
    const code = await main(['adopt', '--cwd', root], rt);
    expect(code).toBe(EXIT.ok);
    expect(rt.system.installs).toEqual([{ root, packageManager: 'pnpm', verbose: false }]);
    expect(await readTree(root)).toHaveProperty(['mfeflow.json']);
  });

  it('stops with E124 for a folder that holds only a remote', async () => {
    for (const fixture of ['rsbuild-provider', 'webpack-literal']) {
      // oxlint-disable-next-line no-await-in-loop -- one temp copy at a time
      const root = await copyOf(fixture);
      // oxlint-disable-next-line no-await-in-loop -- as above
      const before = await readTree(root);
      // oxlint-disable-next-line no-await-in-loop -- as above
      const { code, rt } = await adopt(root, ['--yes']);
      expect(code).toBe(EXIT.project);
      expect(rt.io.err.join('\n')).toContain('MFEFLOW_E124');
      // oxlint-disable-next-line no-await-in-loop -- as above
      expect(await readTree(root)).toEqual(before);
    }
  });

  it('stops with E124 when there is no Module Federation config at all', async () => {
    const root = await copyOf('dynamic-options');
    const { code, rt } = await adopt(root, ['--yes']);
    expect(code).toBe(EXIT.project);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E124');
  });

  it('keeps an app file that already exists', async () => {
    const root = await copyOf('webpack-esm');
    await fs.writeFile(path.join(root, 'mfeflow.app.json'), '{"name":"host"}\n');
    const { code, rt } = await adopt(root, ['--yes']);
    expect(code).toBe(EXIT.ok);
    expect((await readTree(root))['mfeflow.app.json']).toBe('{"name":"host"}\n');
    expect(rt.io.out.join('\n')).toContain('already exists');
  });

  it('refuses a yarn project', async () => {
    const root = await copyOf('webpack-esm');
    await fs.writeFile(path.join(root, 'yarn.lock'), '');
    const { code, rt } = await adopt(root, ['--yes']);
    expect(code).toBe(EXIT.usage);
    expect(rt.io.err.join('\n')).toContain('yarn');
  });

  it('records npm for an npm project', async () => {
    const root = await copyOf('webpack-esm');
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}\n');
    expect((await adopt(root, ['--yes'])).code).toBe(EXIT.ok);
    expect(parseProject((await readTree(root))['mfeflow.json'] ?? '').packageManager).toBe('npm');
  });
});
