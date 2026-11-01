import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { validateMfeflowProject } from '@mfeflow/contracts';
import { findDiverged, loadProject } from '@mfeflow/core';
import { main, validateResult, type AddResult } from '..';
import {
  git,
  gitSystem,
  readTree,
  removeDir,
  scriptedPrompter,
  tempDir,
  testRuntime,
} from '../testing';

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map(removeDir));
});

let org = '';
let shell = '';

async function polyrepo(...extra: string[]): Promise<void> {
  const parent = await tempDir();
  dirs.push(parent);
  org = path.join(parent, 'acme');
  shell = path.join(org, 'shell');
  const code = await main(
    ['init', 'acme', '--topology', 'polyrepo', '--remotes', 'catalog,cart', '--yes'].concat(
      ['--no-install', '--cwd', parent],
      extra,
    ),
    testRuntime(),
  );
  expect(code).toBe(0);
}

beforeEach(async () => {
  await polyrepo();
});

const addTeamRepo = (cwd: string, args: string[], rt = testRuntime()) =>
  main(['add', 'team-repo', ...args, '--cwd', cwd], rt).then((code) => ({ code, rt }));

async function files(dir: string): Promise<Record<string, string>> {
  const tree = await readTree(dir);
  return Object.fromEntries(Object.entries(tree).filter(([file]) => !file.includes('.git/')));
}

describe('mfeflow add team-repo', () => {
  it('makes a repo next to the others and registers it in the shell', async () => {
    const rt = testRuntime();
    rt.system = gitSystem();
    const { code } = await addTeamRepo(shell, ['checkout', '--no-install'], rt);
    expect(code).toBe(0);

    const repo = path.join(org, 'checkout');
    const project = await loadProject(repo);
    expect(validateMfeflowProject(project)).toEqual([]);
    expect(project).toMatchObject({ repo: 'remote', topology: 'polyrepo', scope: '@acme' });
    expect(project.apps).toEqual({
      checkout: { kind: 'remote', path: 'apps/checkout', port: 4313 },
    });
    expect(Object.keys(await files(repo))).toEqual(
      expect.arrayContaining([
        'apps/checkout/src/exposed/App.tsx',
        '.github/workflows/ci.yml',
        'renovate.json',
        'mfeflow.json',
      ]),
    );
    expect(git(repo, 'rev-parse', '--show-toplevel')).toBe(
      path.join(await fs.realpath(org), 'checkout'),
    );

    const shellFiles = await files(shell);
    expect(
      JSON.parse(shellFiles['apps/shell/public/config/runtime-config.dev.json'] ?? ''),
    ).toEqual({
      environment: 'dev',
      devRemotes: {
        catalog: 'http://localhost:4311/mf-manifest.json',
        cart: 'http://localhost:4312/mf-manifest.json',
        checkout: 'http://localhost:4313/mf-manifest.json',
      },
    });
    expect(shellFiles['apps/shell/src/remotes/checkout.tsx']).toContain('checkout/App');
    expect(shellFiles['apps/shell/src/remotes/route-table.tsx']).toContain("path: '/checkout'");
    expect(shellFiles['registry/envs/staging/checkout.json']).toContain('team-checkout');
    expect(shellFiles['registry/envs/prod/checkout.json']).toBeDefined();
    expect(shellFiles['registry/envs/dev/checkout.json']).toBeUndefined();

    expect(await findDiverged(shell, await loadProject(shell))).toEqual([]);
    expect(await findDiverged(repo, project)).toEqual([]);
  });

  it('does not touch the shell record of which features and apps it has', async () => {
    const before = await loadProject(shell);
    await addTeamRepo(shell, ['checkout', '--no-install']);
    const after = await loadProject(shell);
    expect(after.apps).toEqual(before.apps);
    expect(after.features).toEqual(before.features);
  });

  it('--dry-run writes nothing in either place', async () => {
    const before = await files(org);
    const rt = testRuntime();
    const { code } = await addTeamRepo(shell, ['checkout', '--dry-run', '--json'], rt);
    expect(code).toBe(0);
    expect(await files(org)).toEqual(before);
    expect((await fs.readdir(org)).toSorted()).toEqual(['cart', 'catalog', 'platform', 'shell']);
    const result = JSON.parse(rt.io.out.join('')) as AddResult;
    expect(validateResult(result)).toEqual([]);
    expect(result).toMatchObject({ kind: 'team-repo', dryRun: true, added: ['checkout'] });
    expect(result.written).toEqual([]);
    expect(result.diff).toContain('checkout/');
  });

  it('reports what it made in the JSON result', async () => {
    const rt = testRuntime();
    const { code } = await addTeamRepo(shell, ['checkout', '--no-install', '--json'], rt);
    expect(code).toBe(0);
    const result = JSON.parse(rt.io.out.join('')) as AddResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.kind).toBe('team-repo');
    expect(result.created).toBe(path.join(org, 'checkout'));
    expect(result.root).toBe(shell);
    expect(result.written).toContain('checkout/apps/checkout/package.json');
    expect(result.written).toContain('shell/registry/envs/prod/checkout.json');
    expect(rt.system.repoInits).toEqual([path.join(org, 'checkout')]);
  });

  it('takes the port you give it, and the next free one after that', async () => {
    await addTeamRepo(shell, ['checkout', '--port', '4400', '--no-install']);
    expect((await loadProject(path.join(org, 'checkout'))).apps.checkout?.port).toBe(4400);
    await addTeamRepo(shell, ['search', '--no-install']);
    expect((await loadProject(path.join(org, 'search'))).apps.search?.port).toBe(4313);
  });

  it('installs the new repo only', async () => {
    const rt = testRuntime();
    await addTeamRepo(shell, ['checkout'], rt);
    expect(rt.system.installs.map((i) => i.root)).toEqual([path.join(org, 'checkout')]);
  });

  it('gives the new repo the first-party features the shell chose', async () => {
    await polyrepo('--features', 'lint-oxlint');
    await addTeamRepo(shell, ['checkout', '--no-install']);
    const tree = await files(path.join(org, 'checkout'));
    expect(tree['.oxlintrc.json']).toBeDefined();
    const project = await loadProject(path.join(org, 'checkout'));
    expect(Object.keys(project.features)).toEqual(
      expect.arrayContaining(['core', 'tsconfig', 'polyrepo', 'lint-oxlint']),
    );
  });

  it('warns when the platform repo is not next to the shell', async () => {
    await fs.rm(path.join(org, 'platform'), { recursive: true });
    const rt = testRuntime();
    const { code } = await addTeamRepo(shell, ['checkout', '--no-install', '--json'], rt);
    expect(code).toBe(0);
    const result = JSON.parse(rt.io.out.join('')) as AddResult;
    expect(result.plan.warnings.join('\n')).toContain('platform/ is not next to shell/');
  });

  it('asks once, and writes nothing when you say no', async () => {
    const prompter = scriptedPrompter([false]);
    const rt = testRuntime({ prompter });
    rt.io.interactive = true;
    const { code } = await addTeamRepo(shell, ['checkout', '--no-install'], rt);
    expect(code).not.toBe(0);
    expect(prompter.asked).toHaveLength(1);
    expect((await fs.readdir(org)).toSorted()).toEqual(['cart', 'catalog', 'platform', 'shell']);
  });

  it('asks for the name when none is given and there is a person to ask', async () => {
    const prompter = scriptedPrompter(['checkout', true]);
    const rt = testRuntime({ prompter });
    rt.io.interactive = true;
    const { code } = await addTeamRepo(shell, ['--no-install'], rt);
    expect(code).toBe(0);
    expect(prompter.asked).toEqual([
      'Name of the new team-repo',
      expect.stringContaining('Create '),
    ]);
    expect(await fs.readdir(org)).toContain('checkout');
  });

  it('needs a name when it cannot ask', async () => {
    const { code, rt } = await addTeamRepo(shell, ['--no-install']);
    expect(code).not.toBe(0);
    expect(rt.io.err.join('')).toContain('add team-repo needs a name');
  });

  it('refuses a name that is taken, reserved or not a Module Federation name', async () => {
    for (const [name, why] of [
      ['catalog', 'already an app'],
      ['shell', 'reserved'],
      ['platform', 'reserved'],
      ['Bad Name', 'not a Module Federation name'],
    ] as const) {
      const { code, rt } = await addTeamRepo(shell, [name, '--no-install']);
      expect(code, name).not.toBe(0);
      expect(rt.io.err.join(''), name).toContain(why);
    }
  });

  it('refuses a port another remote uses', async () => {
    const { code, rt } = await addTeamRepo(shell, ['checkout', '--port', '4311', '--no-install']);
    expect(code).not.toBe(0);
    expect(rt.io.err.join('')).toContain('already used by catalog');
  });

  it('refuses a folder that is already there', async () => {
    await fs.mkdir(path.join(org, 'checkout'));
    await fs.writeFile(path.join(org, 'checkout', 'notes.txt'), 'mine');
    const before = await files(shell);
    const { code, rt } = await addTeamRepo(shell, ['checkout', '--no-install']);
    expect(code).not.toBe(0);
    expect(rt.io.err.join('')).toContain('already has notes.txt');
    expect(await files(shell)).toEqual(before);
  });

  it('only works in the shell repo of a polyrepo', async () => {
    for (const cwd of [path.join(org, 'catalog'), path.join(org, 'platform')]) {
      const { code, rt } = await addTeamRepo(cwd, ['checkout', '--no-install']);
      expect(code).not.toBe(0);
      expect(rt.io.err.join('')).toContain('works in the shell repo of a polyrepo');
    }
    const parent = await tempDir();
    dirs.push(parent);
    await main(['init', 'mono', '--yes', '--no-install', '--cwd', parent], testRuntime());
    const { code, rt } = await addTeamRepo(path.join(parent, 'mono'), ['checkout']);
    expect(code).not.toBe(0);
    expect(rt.io.err.join('')).toContain('works in the shell repo of a polyrepo');
  });

  it('recreates the dev config when it was deleted', async () => {
    await fs.rm(path.join(shell, 'apps/shell/public/config/runtime-config.dev.json'));
    const { code } = await addTeamRepo(shell, ['checkout', '--no-install']);
    expect(code).toBe(0);
    const config = JSON.parse(
      await fs.readFile(
        path.join(shell, 'apps/shell/public/config/runtime-config.dev.json'),
        'utf8',
      ),
    ) as { devRemotes: Record<string, string> };
    expect(Object.keys(config.devRemotes)).toEqual(['checkout']);
  });

  it('takes the new repo back when the shell cannot be written', async () => {
    const rt = testRuntime();
    // The shell's own write fails at the install step; a feature-less add has none, so make the
    // shell read-only for the second write only by removing its mfeflow.json after planning.
    const { system } = rt;
    rt.system = {
      ...rt.system,
      initRepo: async (root) => {
        await fs.rm(path.join(shell, 'mfeflow.json'));
        return system.initRepo(root);
      },
    };
    const { code } = await addTeamRepo(shell, ['checkout', '--no-install'], rt);
    expect(code).not.toBe(0);
    expect(await fs.readdir(org)).not.toContain('checkout');
  });
});
