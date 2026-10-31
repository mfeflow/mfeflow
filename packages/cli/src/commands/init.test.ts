import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateMfeflowProject, validateMfeManifest } from '@mfeflow/contracts';
import { parseProject } from '@mfeflow/core';
import { main, validateResult, type InitResult } from '..';
import { REPO, readTree, removeDir, scriptedPrompter, tempDir, testRuntime } from '../testing';
import { isolatedEnv } from '../system';
import { assertEmpty, scopeFor } from './init';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function workspace(): Promise<string> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

function jsonOf(out: string[]): InitResult {
  const value: unknown = JSON.parse(out.join(''));
  expect(validateResult(value)).toEqual([]);
  return value as InitResult;
}

describe('mfeflow init', () => {
  it('writes a shell, two remotes and the default features, and records them in mfeflow.json', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    expect(await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], rt)).toBe(0);
    const tree = await readTree(path.join(cwd, 'app'));
    expect(tree).not.toHaveProperty(['apps/shell/public/config/runtime-config.json']);
    expect(Object.keys(tree)).toEqual(
      expect.arrayContaining([
        'package.json',
        'pnpm-workspace.yaml',
        'turbo.json',
        'mfeflow.json',
        'AGENTS.md',
        'apps/shell/src/index.ts',
        'apps/shell/public/config/runtime-config.dev.json',
        'apps/catalog/src/exposed/App.tsx',
        'apps/cart/mfe.json',
        'registry/envs/dev/catalog.json',
        'registry/envs/prod/cart.json',
        '.oxlintrc.json',
        'apps/cart/src/api/endpoints.ts',
        'apps/cart/env.ts',
        'apps/shell/src/config/schema.ts',
        'vitest.config.ts',
      ]),
    );
    expect(tree).not.toHaveProperty(['lefthook.yml']);
    const project = parseProject(tree['mfeflow.json'] ?? '');
    expect(project.scope).toBe('@app');
    expect(Object.keys(project.features)).toEqual([
      'core',
      'tsconfig',
      'lint-oxlint',
      'url-factory',
      'env-t3',
      'testing',
    ]);
    expect(project.apps.cart).toEqual({ kind: 'remote', path: 'apps/cart', port: 4312 });
    expect(validateMfeflowProject(project)).toEqual([]);
    expect(rt.system.installs).toEqual([]);
    expect(rt.io.out.join('\n')).toContain('cd app');
  });

  it("names a remote's route so it cannot clash with the route table's own names", async () => {
    const cwd = await workspace();
    expect(
      await main(
        ['init', 'p', '--yes', '--no-install', '--remotes', 'app,route', '--cwd', cwd],
        testRuntime(),
      ),
    ).toBe(0);
    const table = await fs.readFile(
      path.join(cwd, 'p', 'apps/shell/src/remotes/route-table.tsx'),
      'utf8',
    );
    const declared = [
      ...table.matchAll(
        /^import (?:type )?\{([^}]*)\}|^export (?:interface|const|function) (\w+)/gm,
      ),
    ].flatMap((m) =>
      (m[1] ?? m[2] ?? '').split(',').map((n) => n.replace(/^\s*(?:type\s+)?/, '').trim()),
    );
    expect(declared.filter((name) => name !== '')).toEqual(
      [...new Set(declared)].filter((n) => n !== ''),
    );
  });

  it('keeps every .env.example tracked by git while ignoring .env and .env.*', async () => {
    const cwd = await workspace();
    expect(await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime())).toBe(
      0,
    );
    const project = path.join(cwd, 'app');
    execFileSync('git', ['init', '-q'], { cwd: project, env: isolatedEnv() });
    const ignored = (file: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', file], {
          cwd: project,
          env: isolatedEnv(),
        });
        return true;
      } catch {
        return false;
      }
    };
    for (const file of ['.env.example', 'apps/shell/.env.example', 'apps/cart/.env.example']) {
      expect(await fs.stat(path.join(project, file)).then(() => true), file).toBe(true);
      expect(ignored(file), file).toBe(false);
    }
    for (const file of ['.env', '.env.local', 'apps/shell/.env', 'apps/cart/.env.production']) {
      expect(ignored(file), file).toBe(true);
    }
  });

  it('installs with the package manager, from the project folder, when asked to', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    expect(await main(['init', 'app', '--yes', '--cwd', cwd, '--verbose'], rt)).toBe(0);
    expect(rt.system.installs).toEqual([
      { root: path.join(cwd, 'app'), packageManager: 'pnpm', verbose: true },
    ]);
    expect(rt.io.out.join('\n')).not.toContain('\n  pnpm install');
  });

  it('starts a git repository only when the hooks need one', async () => {
    const cwd = await workspace();
    const plain = testRuntime();
    await main(['init', 'a', '--yes', '--cwd', cwd], plain);
    expect(plain.system.gitInits).toEqual([]);
    const hooks = testRuntime();
    await main(
      ['init', 'b', '--yes', '--cwd', cwd, '--features', 'git-hooks', '--no-install'],
      hooks,
    );
    expect(hooks.system.gitInits).toEqual([path.join(cwd, 'b')]);
    expect(await fs.readFile(path.join(cwd, 'b', 'lefthook.yml'), 'utf8')).toContain('commitlint');
  });

  it('defaults to mfeflow-app when there is no folder and no terminal (npm create mfeflow -- --yes)', async () => {
    const cwd = await workspace();
    expect(await main(['init', '--yes', '--no-install', '--cwd', cwd], testRuntime())).toBe(0);
    const project = parseProject(
      await fs.readFile(path.join(cwd, 'mfeflow-app', 'mfeflow.json'), 'utf8'),
    );
    expect(project.scope).toBe('@mfeflow-app');
  });

  it('writes nothing on --dry-run, not even the folder, and runs no command', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    expect(
      await main(['init', 'app', '--dry-run', '--features', 'git-hooks', '--cwd', cwd], rt),
    ).toBe(0);
    expect(await fs.readdir(cwd)).toEqual([]);
    expect(rt.system.installs).toEqual([]);
    expect(rt.system.gitInits).toEqual([]);
    const out = rt.io.out.join('\n');
    expect(out).toContain('to create');
    expect(out).toContain('diff --mfeflow apps/shell/src/App.tsx');
    expect(out).toContain('+++ b/mfeflow.json');
    expect(out).toContain('Dry run: nothing was written.');
  });

  it('checks an existing empty folder on --dry-run and still leaves it empty', async () => {
    const cwd = await workspace();
    await fs.mkdir(path.join(cwd, 'app'));
    expect(await main(['init', 'app', '--dry-run', '--cwd', cwd], testRuntime())).toBe(0);
    expect(await fs.readdir(path.join(cwd, 'app'))).toEqual([]);
  });

  it('prints one schema-valid JSON document with --json, and nothing else on stdout', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    expect(await main(['init', 'app', '--json', '--yes', '--no-install', '--cwd', cwd], rt)).toBe(
      0,
    );
    expect(rt.io.out).toHaveLength(1);
    const result = jsonOf(rt.io.out);
    expect(result).toMatchObject({
      command: 'init',
      dryRun: false,
      scope: '@app',
      installed: false,
    });
    expect(result.apps.map((a) => a.name)).toEqual(['shell', 'catalog', 'cart']);
    expect(result.written).toContain('mfeflow.json');
    expect(result.diff).toBeUndefined();
    expect(result.plan.features.map((f) => f.name)).toEqual([
      'core',
      'tsconfig',
      'lint-oxlint',
      'url-factory',
      'env-t3',
      'testing',
    ]);
  });

  it('includes the diff in the --dry-run --json document', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    await main(['init', 'app', '--json', '--dry-run', '--cwd', cwd], rt);
    const result = jsonOf(rt.io.out);
    expect(result.dryRun).toBe(true);
    expect(result.written).toEqual([]);
    expect(result.diff).toContain('diff --mfeflow package.json');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('answers the same prompts as the flags do, and writes the same project', async () => {
    const cwd = await workspace();
    const byFlags = testRuntime();
    await main(
      [
        'init',
        'one',
        '--scope',
        '@acme',
        '--remotes',
        'checkout,orders',
        '--features',
        'git-hooks,url-factory',
        '--yes',
        '--no-install',
        '--cwd',
        cwd,
      ],
      byFlags,
    );
    const prompted = testRuntime({
      prompter: scriptedPrompter([
        'two',
        '@acme',
        'checkout,orders',
        ['git-hooks', 'url-factory'],
        true,
      ]),
    });
    prompted.io.interactive = true;
    expect(await main(['init', '--no-install', '--cwd', cwd], prompted)).toBe(0);
    expect(prompted.prompter).toMatchObject({
      asked: [
        'Where should the project go?',
        'npm scope for your packages',
        'Remotes, comma separated',
        'Features',
        'Write these changes?',
      ],
    });
    expect(await readTree(path.join(cwd, 'two'))).toEqual(await readTree(path.join(cwd, 'one')));
  });

  it('does not ask what a flag already answered, and never prompts with --yes', async () => {
    const cwd = await workspace();
    const rt = testRuntime({ prompter: scriptedPrompter([true]) });
    rt.io.interactive = true;
    await main(
      [
        'init',
        'app',
        '--scope',
        '@a',
        '--remotes',
        'x',
        '--features',
        'lint-oxlint',
        '--no-install',
        '--cwd',
        cwd,
      ],
      rt,
    );
    expect(rt.prompter).toMatchObject({ asked: ['Write these changes?'] });
    const quiet = testRuntime();
    quiet.io.interactive = true;
    expect(await main(['init', 'app2', '--yes', '--no-install', '--cwd', cwd], quiet)).toBe(0);
  });

  it('suggests a scope from the folder name', () => {
    expect(scopeFor('My Cool App!')).toBe('@my-cool-app');
    expect(scopeFor('/x/.hidden_')).toBe('@hidden');
    expect(scopeFor('---')).toBe('@app');
  });

  it('takes the default scope from the --cwd folder when the target is "."', async () => {
    const cwd = await workspace();
    const project = path.join(cwd, 'My Shop');
    await fs.mkdir(project);
    expect(scopeFor('.', project)).toBe('@my-shop');
    expect(
      await main(['init', '.', '--yes', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    const saved = parseProject(await fs.readFile(path.join(project, 'mfeflow.json'), 'utf8'));
    expect(saved.scope).toBe('@my-shop');
  });

  it('replays a preset, and lets flags override it', async () => {
    const cwd = await workspace();
    await fs.writeFile(
      path.join(cwd, 'stack.json'),
      JSON.stringify({ scope: '@preset', remotes: ['a', 'b'], features: ['git-hooks'] }),
    );
    const rt = testRuntime();
    await main(
      [
        'init',
        'app',
        '--preset',
        'stack.json',
        '--scope',
        '@flag',
        '--yes',
        '--no-install',
        '--cwd',
        cwd,
      ],
      rt,
    );
    const project = parseProject(await fs.readFile(path.join(cwd, 'app', 'mfeflow.json'), 'utf8'));
    expect(project.scope).toBe('@flag');
    expect(Object.keys(project.apps)).toEqual(['shell', 'a', 'b']);
    expect(Object.keys(project.features)).toEqual(['core', 'tsconfig', 'git-hooks']);
  });

  it('refuses a folder that already has files, and leaves them alone (E108)', async () => {
    const cwd = await workspace();
    await fs.mkdir(path.join(cwd, 'app'));
    await fs.writeFile(path.join(cwd, 'app', 'notes.txt'), 'mine');
    const rt = testRuntime();
    expect(await main(['init', 'app', '--yes', '--cwd', cwd], rt)).toBe(3);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E108');
    expect(await fs.readdir(path.join(cwd, 'app'))).toEqual(['notes.txt']);
  });

  it('says a file in the way is not a folder (E108)', async () => {
    const cwd = await workspace();
    await fs.writeFile(path.join(cwd, 'app'), 'a file');
    const rt = testRuntime();
    expect(await main(['init', 'app', '--yes', '--cwd', cwd], rt)).toBe(3);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E108');
    expect(rt.io.err.join('\n')).toContain('is not a folder');
    expect(await fs.readFile(path.join(cwd, 'app'), 'utf8')).toBe('a file');
  });

  it('reads a missing folder as empty, and names any other failure (E106)', async () => {
    const failing = (code: string) => () =>
      Promise.reject(Object.assign(new Error(`${code}: nope`), { code }));
    await expect(assertEmpty('/x/new', failing('ENOENT'))).resolves.toBeUndefined();
    await expect(assertEmpty('/x/file/new', failing('ENOTDIR'))).rejects.toMatchObject({
      code: 'MFEFLOW_E108',
    });
    await expect(assertEmpty('/x/locked', failing('EACCES'))).rejects.toThrow(
      /could not be read or written.*\/x\/locked.*EACCES/s,
    );
  });

  it.each([
    ['a scope without @', ['--scope', 'acme'], 2, 'MFEFLOW_E107'],
    ['npm', ['--package-manager', 'npm'], 2, 'MFEFLOW_E107'],
    ['another topology', ['--topology', 'polyrepo'], 2, 'MFEFLOW_E107'],
    ['a remote called shell', ['--remotes', 'shell'], 2, 'MFEFLOW_E215'],
    ['a repeated remote', ['--remotes', 'a,a'], 2, 'MFEFLOW_E215'],
    ['a badly named remote', ['--remotes', 'My-App'], 2, 'MFEFLOW_E215'],
    ['an unknown feature', ['--features', 'analytics-gtm'], 4, 'MFEFLOW_E201'],
    ['an option nothing declares', ['--option', 'core.nothing=1'], 4, 'MFEFLOW_E214'],
    ['an option for a feature not in this run', ['--option', 'git-hooks.x=1'], 4, 'MFEFLOW_E214'],
    ['a malformed option', ['--option', 'nothing'], 2, 'MFEFLOW_E107'],
    ['a missing preset', ['--preset', 'nope.json'], 3, 'MFEFLOW_E109'],
  ])('rejects %s without writing anything', async (_name, flags, code, error) => {
    const cwd = await workspace();
    const rt = testRuntime();
    expect(await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd, ...flags], rt)).toBe(
      code,
    );
    expect(rt.io.err.join('\n')).toContain(error);
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('puts the package manager failure in the message and leaves no folder behind (E213)', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    rt.system.install = () =>
      Promise.reject(new Error('pnpm install exited with 1\nERR_PNPM_NO_MATCHING_VERSION'));
    expect(await main(['init', 'app', '--yes', '--cwd', cwd], rt)).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E213');
    expect(rt.io.err.join('\n')).toContain('ERR_PNPM_NO_MATCHING_VERSION');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('removes the whole new folder when a real install leaves node_modules and .git behind', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    rt.system.install = async (root) => {
      await fs.mkdir(path.join(root, 'node_modules', '.pnpm'), { recursive: true });
      await fs.mkdir(path.join(root, '.git'));
      throw new Error('pnpm install exited with 1\nERR_PNPM_FETCH_404');
    };
    expect(await main(['init', 'deep/er/app', '--yes', '--cwd', cwd], rt)).toBe(4);
    const err = rt.io.err.join('\n');
    expect(err).toContain('ERR_PNPM_FETCH_404');
    expect(err).toContain('removed');
    expect(err).not.toContain('run pnpm install');
    expect(await fs.readdir(cwd)).toEqual([]);

    const again = testRuntime();
    expect(await main(['init', 'deep/er/app', '--yes', '--no-install', '--cwd', cwd], again)).toBe(
      0,
    );
  });

  it('empties an existing empty folder, and only that, when the install fails', async () => {
    const cwd = await workspace();
    await fs.mkdir(path.join(cwd, 'app'));
    const rt = testRuntime();
    rt.system.install = async (root) => {
      await fs.mkdir(path.join(root, 'node_modules'));
      await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), '');
      await fs.mkdir(path.join(root, '.git'));
      throw new Error('pnpm install exited with 1');
    };
    expect(await main(['init', 'app', '--yes', '--cwd', cwd, '--features', 'git-hooks'], rt)).toBe(
      4,
    );
    expect(await fs.readdir(path.join(cwd, 'app'))).toEqual([]);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E213');
  });

  it('links @mfeflow packages from a checkout with --local, and names a bad checkout (E110)', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    expect(
      await main(['init', 'app', '--yes', '--no-install', '--local', REPO, '--cwd', cwd], rt),
    ).toBe(0);
    const shell = JSON.parse(
      await fs.readFile(path.join(cwd, 'app', 'apps/shell/package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(shell.dependencies['@mfeflow/runtime']).toMatch(/^link:.*\/packages\/runtime$/);
    const bad = testRuntime();
    expect(await main(['init', 'other', '--yes', '--local', cwd, '--cwd', cwd], bad)).toBe(3);
    expect(bad.io.err.join('\n')).toContain('MFEFLOW_E110');
  });

  it('writes ^<cli version> for @mfeflow packages without --local', async () => {
    const cwd = await workspace();
    await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
    const shell = await fs.readFile(path.join(cwd, 'app', 'apps/shell/package.json'), 'utf8');
    expect(shell).toContain('"@mfeflow/runtime": "^0.0.0"');
  });

  it('reads MFEFLOW_LOCAL as --local', async () => {
    const cwd = await workspace();
    const rt = testRuntime();
    rt.io.env = { MFEFLOW_LOCAL: REPO };
    await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], rt);
    expect(await fs.readFile(path.join(cwd, 'app', 'apps/shell/package.json'), 'utf8')).toContain(
      'link:',
    );
  });

  it('generates manifests the contracts accept', async () => {
    const cwd = await workspace();
    await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
    for (const app of ['shell', 'catalog', 'cart']) {
      const manifest: unknown = JSON.parse(
        await fs.readFile(path.join(cwd, 'app', 'apps', app, 'mfe.json'), 'utf8'),
      );
      expect(validateMfeManifest(manifest)).toEqual([]);
    }
  });
});
