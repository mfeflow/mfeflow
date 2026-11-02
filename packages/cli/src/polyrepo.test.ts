import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateMfeflowProject, validateRegistryEntry } from '@mfeflow/contracts';
import { findDiverged, loadProject } from '@mfeflow/core';
import { main, validateResult, type InitResult } from '.';
import {
  fakeSystem,
  git,
  gitSystem,
  posixPath,
  readTree,
  removeDir,
  scriptedPrompter,
  tempDir,
  testRuntime,
} from './testing';

const REMOTES = ['catalog', 'cart'];

/** Every file of the polyrepo except what git keeps for itself. */
async function files(org: string): Promise<Record<string, string>> {
  const tree = await readTree(org);
  return Object.fromEntries(Object.entries(tree).filter(([file]) => !file.includes('/.git/')));
}

async function jsonIn(org: string, file: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await fs.readFile(path.join(org, file), 'utf8'));
  return value as Record<string, unknown>;
}

describe('mfeflow init --topology polyrepo', () => {
  let parent = '';
  let org = '';
  let result: InitResult;
  let tree: Record<string, string>;

  beforeAll(async () => {
    parent = await tempDir();
    org = path.join(parent, 'acme');
    const rt = testRuntime();
    rt.system = gitSystem();
    const code = await main(
      [
        'init',
        'acme',
        '--topology',
        'polyrepo',
        '--remotes',
        REMOTES.join(','),
        '--yes',
        '--json',
      ].concat(['--no-install', '--cwd', parent]),
      rt,
    );
    expect(rt.io.err).toEqual([]);
    expect(code).toBe(0);
    result = JSON.parse(rt.io.out.join('')) as InitResult;
    tree = await files(org);
  });
  afterAll(async () => {
    await removeDir(parent);
  });

  it('makes a folder per repo: platform, shell and one for each remote', async () => {
    const top = new Set(Object.keys(tree).map((file) => file.split('/')[0]));
    expect([...top].toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      'cart',
      'catalog',
      'platform',
      'shell',
    ]);
    expect(result.repos?.map((r) => [r.name, r.repo])).toEqual([
      ['platform', 'platform'],
      ['shell', 'shell'],
      ['catalog', 'remote'],
      ['cart', 'remote'],
    ]);
  });

  it('puts the shared packages, reusable CI, Renovate preset and Changesets in platform', () => {
    const platform = Object.keys(tree)
      .filter((file) => file.startsWith('platform/'))
      .toSorted();
    expect(platform).toEqual(
      [
        '.changeset/README.md',
        '.changeset/config.json',
        '.github/workflows/ci.yml',
        '.github/workflows/release.yml',
        '.github/workflows/reusable-ci.yml',
        '.gitignore',
        '.nvmrc',
        'AGENTS.md',
        'README.md',
        'default.json',
        'mfeflow.json',
        'package.json',
        'packages/contracts/package.json',
        'packages/contracts/src/index.ts',
        'packages/contracts/tsconfig.json',
        'packages/tokens/package.json',
        'packages/tokens/src/index.ts',
        'packages/tokens/tsconfig.json',
        'pnpm-workspace.yaml',
        'renovate.json',
        'tsconfig.base.json',
      ]
        .map((file) => `platform/${file}`)
        .toSorted(),
    );
    const reusable = tree['platform/.github/workflows/reusable-ci.yml'] ?? '';
    expect(reusable).toContain('workflow_call:');
    expect(reusable).toContain('uses: actions/checkout@');
    expect(tree['platform/packages/contracts/package.json']).toContain('"name": "@acme/contracts"');
    expect(tree['platform/.changeset/config.json']).toContain('"access": "public"');
    const preset = JSON.parse(tree['platform/default.json'] ?? '') as {
      extends: string[];
      packageRules: { groupName: string }[];
    };
    expect(preset.extends).toEqual(['config:recommended']);
    expect(preset.packageRules.map((rule) => rule.groupName)).toContain('platform packages');
    expect(tree['platform/package.json']).toContain('"release": "pnpm build && changeset publish"');
  });

  it('gives the shell its app, registry and dev config, and each remote only its app', () => {
    const shell = Object.keys(tree).filter((file) => file.startsWith('shell/'));
    expect(shell).toEqual(
      expect.arrayContaining([
        'shell/apps/shell/rsbuild.config.ts',
        'shell/apps/shell/public/config/runtime-config.dev.json',
        'shell/apps/shell/src/remotes/catalog.tsx',
        'shell/apps/shell/src/remotes/cart.tsx',
        'shell/registry/envs/staging/catalog.json',
        'shell/registry/envs/prod/cart.json',
        'shell/.github/workflows/ci.yml',
        'shell/renovate.json',
      ]),
    );
    expect(shell).not.toContain('shell/registry/envs/dev/catalog.json');
    for (const remote of REMOTES) {
      const mine = Object.keys(tree).filter((file) => file.startsWith(`${remote}/`));
      expect(mine).toEqual(
        expect.arrayContaining([
          `${remote}/apps/${remote}/src/exposed/App.tsx`,
          `${remote}/apps/${remote}/rsbuild.config.ts`,
          `${remote}/.github/workflows/ci.yml`,
          `${remote}/renovate.json`,
        ]),
      );
      expect(mine.some((file) => file.includes('registry/'))).toBe(false);
      expect(mine.some((file) => file.startsWith(`${remote}/apps/shell`))).toBe(false);
    }
  });

  it('writes an mfeflow.json that validates in every repo, with the repo kind', async () => {
    const kinds: Record<string, string> = {
      platform: 'platform',
      shell: 'shell',
      catalog: 'remote',
      cart: 'remote',
    };
    for (const [dir, repo] of Object.entries(kinds)) {
      const project = await loadProject(path.join(org, dir));
      expect(validateMfeflowProject(project), dir).toEqual([]);
      expect(project).toMatchObject({ repo, topology: 'polyrepo', scope: '@acme' });
    }
    expect((await loadProject(path.join(org, 'platform'))).apps).toEqual({});
    expect((await loadProject(path.join(org, 'catalog'))).apps).toEqual({
      catalog: { kind: 'remote', path: 'apps/catalog', port: 4311 },
    });
    expect((await loadProject(path.join(org, 'cart'))).apps).toEqual({
      cart: { kind: 'remote', path: 'apps/cart', port: 4312 },
    });
    expect((await loadProject(path.join(org, 'shell'))).apps).toEqual({
      shell: { kind: 'shell', path: 'apps/shell', port: 4300 },
    });
    for (const dir of Object.keys(kinds)) {
      expect(
        await findDiverged(path.join(org, dir), await loadProject(path.join(org, dir))),
      ).toEqual([]);
    }
  });

  it('runs git init in each repo, so each is a repo of its own', async () => {
    const real = await fs.realpath(org);
    for (const dir of ['platform', 'shell', ...REMOTES]) {
      expect(posixPath(git(path.join(org, dir), 'rev-parse', '--show-toplevel'))).toBe(
        posixPath(path.join(real, dir)),
      );
    }
    expect(() => git(org, 'rev-parse', '--show-toplevel')).toThrow();
  });

  it('links the platform packages from the platform folder next to each repo', async () => {
    for (const dir of ['shell', 'catalog', 'cart']) {
      const app = dir;
      const pkg = (await jsonIn(org, `${dir}/apps/${app}/package.json`)) as {
        dependencies: Record<string, string>;
      };
      for (const name of ['contracts', 'tokens']) {
        const range = pkg.dependencies[`@acme/${name}`] ?? '';
        expect(range).toBe(`link:../../../platform/packages/${name}`);
        const target = path.resolve(org, dir, 'apps', app, range.slice('link:'.length));
        const linked = (await jsonIn(target, 'package.json')) as { name: string };
        expect(linked.name).toBe(`@acme/${name}`);
      }
    }
    const catalog = tree['shell/pnpm-workspace.yaml'] ?? '';
    expect(catalog).not.toContain('link:');
  });

  it('lists every remote with its dev server in the shell config, not in a registry folder', () => {
    expect(
      JSON.parse(tree['shell/apps/shell/public/config/runtime-config.dev.json'] ?? ''),
    ).toEqual({
      environment: 'dev',
      devRemotes: {
        catalog: 'http://localhost:4311/mf-manifest.json',
        cart: 'http://localhost:4312/mf-manifest.json',
      },
    });
    const config = tree['shell/apps/shell/rsbuild.config.ts'] ?? '';
    expect(config).toContain("'public/config/runtime-config.dev.json'");
    expect(config).toContain('readDevRemotes(devConfig)');
    expect(config).not.toContain('../../registry');
    expect(config).not.toContain('registryDir');
    for (const env of ['staging', 'prod']) {
      for (const remote of REMOTES) {
        const entry: unknown = JSON.parse(tree[`shell/registry/envs/${env}/${remote}.json`] ?? '');
        expect(validateRegistryEntry(entry)).toEqual([]);
      }
    }
  });

  it('points each repo at the reusable workflow and the Renovate preset of the org', () => {
    for (const dir of ['shell', ...REMOTES]) {
      expect(tree[`${dir}/.github/workflows/ci.yml`]).toContain(
        'uses: acme/platform/.github/workflows/reusable-ci.yml@main',
      );
    }
    for (const dir of ['platform', 'shell', ...REMOTES]) {
      expect(JSON.parse(tree[`${dir}/renovate.json`] ?? '')).toMatchObject({
        extends: ['github>acme/platform'],
      });
    }
  });

  it('names each root package after its repo, and a remote after the remote', () => {
    const name = (dir: string): string =>
      (JSON.parse(tree[`${dir}/package.json`] ?? '') as { name: string }).name;
    expect([name('platform'), name('shell'), name('catalog'), name('cart')]).toEqual([
      'acme-platform',
      'acme-shell',
      'acme-catalog',
      'acme-cart',
    ]);
  });

  it('reports every repo in the JSON result, with paths from the org folder', () => {
    expect(validateResult(result)).toEqual([]);
    expect(result.apps.map((app) => app.path)).toEqual([
      'shell/apps/shell',
      'catalog/apps/catalog',
      'cart/apps/cart',
    ]);
    expect(result.written).toContain('platform/packages/contracts/src/index.ts');
    expect(result.next).toEqual([
      'cd acme',
      'pnpm -C platform install',
      'pnpm -C shell install',
      'pnpm -C catalog install',
      'pnpm -C cart install',
      'pnpm -C platform build',
      'pnpm -C shell dev',
      'pnpm -C catalog dev   # in its own terminal',
      'pnpm -C cart dev   # in its own terminal',
    ]);
  });
});

describe('mfeflow init --topology polyrepo, the other paths', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map(removeDir));
  });
  const fresh = async (): Promise<string> => {
    const dir = await tempDir();
    dirs.push(dir);
    return dir;
  };
  const init = (parent: string, ...args: string[]) => {
    const rt = testRuntime();
    return main(
      ['init', 'acme', '--topology', 'polyrepo', '--yes', '--no-install', '--cwd', parent, ...args],
      rt,
    ).then((code) => ({ code, rt }));
  };

  it('--dry-run shows the plan and writes nothing, not even the org folder', async () => {
    const parent = await fresh();
    const { code, rt } = await init(parent, '--dry-run', '--json');
    expect(code).toBe(0);
    expect(await fs.readdir(parent)).toEqual([]);
    const out = JSON.parse(rt.io.out.join('')) as InitResult;
    expect(validateResult(out)).toEqual([]);
    expect(out.dryRun).toBe(true);
    expect(out.written).toEqual([]);
    expect(out.plan.changes.map((c) => c.path)).toContain('platform/default.json');
    expect(out.diff).toContain('platform/');
  });

  it('--dry-run leaves an existing empty folder empty', async () => {
    const parent = await fresh();
    await fs.mkdir(path.join(parent, 'acme'));
    const { code } = await init(parent, '--dry-run');
    expect(code).toBe(0);
    expect(await fs.readdir(path.join(parent, 'acme'))).toEqual([]);
  });

  it('refuses a folder that already has files', async () => {
    const parent = await fresh();
    await fs.mkdir(path.join(parent, 'acme'));
    await fs.writeFile(path.join(parent, 'acme', 'notes.txt'), 'mine');
    const { code, rt } = await init(parent);
    expect(code).not.toBe(0);
    expect(rt.io.err.join('')).toContain('already has notes.txt');
  });

  it('refuses a remote called platform', async () => {
    const parent = await fresh();
    const { code, rt } = await init(parent, '--remotes', 'platform');
    expect(code).not.toBe(0);
    expect(rt.io.err.join('')).toContain('"platform" is a reserved name');
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it('refuses the features that would write files the polyrepo owns', async () => {
    const parent = await fresh();
    for (const feature of ['ci-github', 'env-t3']) {
      const { code, rt } = await init(parent, '--features', feature);
      expect(code).not.toBe(0);
      expect(rt.io.err.join('')).toContain(`--features ${feature}: not in a polyrepo yet`);
    }
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it('installs the repos one at a time, platform first, and starts no git of the monorepo kind', async () => {
    const parent = await fresh();
    const rt = testRuntime();
    const code = await main(
      ['init', 'acme', '--topology', 'polyrepo', '--yes', '--cwd', parent],
      rt,
    );
    expect(code).toBe(0);
    const roots = rt.system.installs.map((i) => path.relative(parent, i.root));
    expect(roots).toEqual([
      path.join('acme', 'platform'),
      path.join('acme', 'shell'),
      path.join('acme', 'catalog'),
      path.join('acme', 'cart'),
    ]);
    expect(rt.system.repoInits.map((root) => path.relative(parent, root))).toEqual(roots);
    expect(rt.system.gitInits).toEqual([]);
  });

  it('applies the features you choose to the shell and the remotes, not to platform', async () => {
    const parent = await fresh();
    const { code } = await init(parent, '--features', 'lint-oxlint');
    expect(code).toBe(0);
    const tree = await files(path.join(parent, 'acme'));
    expect(Object.keys(tree)).toEqual(
      expect.arrayContaining(['shell/.oxlintrc.json', 'catalog/.oxlintrc.json']),
    );
    expect(tree['platform/.oxlintrc.json']).toBeUndefined();
  });

  it('removes the repos it wrote, and the org folder, when a later repo fails', async () => {
    const parent = await fresh();
    const rt = testRuntime();
    let installs = 0;
    rt.system = {
      ...fakeSystem(),
      install: () => {
        installs += 1;
        return installs === 3 ? Promise.reject(new Error('network is down')) : Promise.resolve();
      },
    };
    const code = await main(
      ['init', 'acme', '--topology', 'polyrepo', '--yes', '--cwd', parent],
      rt,
    );
    expect(code).not.toBe(0);
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it('keeps an existing empty org folder when it takes the repos back', async () => {
    const parent = await fresh();
    await fs.mkdir(path.join(parent, 'acme'));
    const rt = testRuntime();
    rt.system = { ...fakeSystem(), install: () => Promise.reject(new Error('network is down')) };
    const code = await main(
      ['init', 'acme', '--topology', 'polyrepo', '--yes', '--cwd', parent],
      rt,
    );
    expect(code).not.toBe(0);
    expect(await fs.readdir(path.join(parent, 'acme'))).toEqual([]);
  });

  it('asks once for all the repos, and writes none when you say no', async () => {
    const parent = await fresh();
    const prompter = scriptedPrompter([false]);
    const rt = testRuntime({ prompter });
    rt.io.interactive = true;
    const code = await main(
      ['init', 'acme', '--topology', 'polyrepo', '--scope', '@acme', '--remotes', 'catalog'].concat(
        ['--features', 'lint-oxlint', '--no-install', '--cwd', parent],
      ),
      rt,
    );
    expect(code).not.toBe(0);
    expect(prompter.asked).toEqual(['Create these 3 repos?']);
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it('stays a monorepo by default and rejects other topologies', async () => {
    const parent = await fresh();
    const hybrid = testRuntime();
    expect(
      await main(['init', 'x', '--topology', 'hybrid', '--yes', '--cwd', parent], hybrid),
    ).not.toBe(0);
    expect(hybrid.io.err.join('')).toContain('only monorepo and polyrepo');
    const mono = testRuntime();
    expect(await main(['init', 'x', '--yes', '--no-install', '--cwd', parent], mono)).toBe(0);
    const project = await loadProject(path.join(parent, 'x'));
    expect(project.topology).toBe('monorepo');
    expect(project.repo).toBeUndefined();
  });

  it('rejects a remote name that is not a Module Federation name', async () => {
    const parent = await fresh();
    const { code, rt } = await init(parent, '--remotes', 'Bad Name');
    expect(code).not.toBe(0);
    expect(rt.io.err.join('')).toContain('E215');
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it('warns by name, and still succeeds, for repos git init did not make', async () => {
    const parent = await fresh();
    const rt = testRuntime();
    rt.system = { ...rt.system, initRepo: (root) => Promise.resolve(!root.endsWith('cart')) };
    const code = await main(
      ['init', 'acme', '--topology', 'polyrepo', '--yes', '--no-install', '--cwd', parent],
      rt,
    );
    expect(code).toBe(0);
    const out = rt.io.out.join('\n');
    expect(out).toContain('Warning: cart is not a git repo');
    expect(out).toContain('run git init there');
    expect(out).not.toContain('each with its own git repo');
  });

  it('removes the folders it made above the org folder when a late repo fails', async () => {
    const parent = await fresh();
    await fs.mkdir(path.join(parent, 'a'));
    const rt = testRuntime();
    rt.system = { ...fakeSystem(), install: () => Promise.reject(new Error('network is down')) };
    const code = await main(
      ['init', 'a/b/c', '--topology', 'polyrepo', '--yes', '--cwd', parent],
      rt,
    );
    expect(code).not.toBe(0);
    expect(await fs.readdir(path.join(parent, 'a'))).toEqual([]);
  });

  it('points CI and Renovate at --org, and says so', async () => {
    const parent = await fresh();
    const { code, rt } = await init(parent, '--org', 'Acme-Inc');
    expect(code).toBe(0);
    expect(rt.io.out.join('\n')).toContain("CI calls Acme-Inc/platform's reusable workflow");
    const tree = await files(path.join(parent, 'acme'));
    expect(tree['shell/.github/workflows/ci.yml']).toContain(
      'uses: Acme-Inc/platform/.github/workflows/reusable-ci.yml@main',
    );
    expect(tree['catalog/renovate.json']).toContain('github>Acme-Inc/platform');
    expect(tree['platform/default.json']).toContain('Acme-Inc');
    expect(tree['platform/.github/workflows/reusable-ci.yml']).toContain('Acme-Inc/platform');
  });

  it('defaults the owner to the scope without @, and names it after init', async () => {
    const parent = await fresh();
    const { rt } = await init(parent, '--scope', '@shopco');
    expect(rt.io.out.join('\n')).toContain("CI calls shopco/platform's reusable workflow");
  });

  it('rejects an --org that is not a GitHub owner, or one without a polyrepo', async () => {
    const parent = await fresh();
    const bad = await init(parent, '--org', 'not an owner');
    expect(bad.code).not.toBe(0);
    expect(bad.rt.io.err.join('')).toContain('must be a GitHub user or organization name');
    const mono = testRuntime();
    expect(await main(['init', 'x', '--org', 'acme', '--yes', '--cwd', parent], mono)).not.toBe(0);
    expect(mono.io.err.join('')).toContain('--org is for --topology polyrepo');
  });
});
