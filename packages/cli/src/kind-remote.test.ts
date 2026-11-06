import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateMfeflowProject } from '@mfeflow/contracts';
import { parseProject, type MfeflowProject } from '@mfeflow/core';
import { main, validateResult, type InitResult, type ReportResult } from '.';
import { loadAny } from './catalog';
import { coreFor, glueScope, isRemoteRepo } from './remote-only';
import {
  readTree,
  removeDir,
  scriptedPrompter,
  tempDir,
  testRuntime,
  type TestRuntime,
} from './testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function workspace(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  return cwd;
}

interface Run {
  code: number;
  out: string;
  err: string;
  rt: TestRuntime;
}

async function run(cwd: string, argv: string[], rt: TestRuntime = testRuntime()): Promise<Run> {
  const code = await main([...argv, '--cwd', cwd], rt);
  return { code, out: rt.io.out.join('\n'), err: rt.io.err.join('\n'), rt };
}

const SHELL_MANIFEST = {
  name: 'shell',
  shared: [{ name: 'react', version: '19.3.1', singleton: true }],
};

async function writeShell(cwd: string, name = 'shell.json'): Promise<string> {
  const file = path.join(cwd, name);
  await fs.writeFile(file, JSON.stringify(SHELL_MANIFEST));
  return file;
}

async function remoteRepo(cwd: string, ...flags: string[]): Promise<{ root: string } & Run> {
  const result = await run(cwd, [
    'init',
    'r',
    '--kind',
    'remote',
    '--scope',
    '@acme',
    '--yes',
    '--no-install',
    ...flags,
  ]);
  expect(result.err).toBe('');
  expect(result.code).toBe(0);
  return { ...result, root: path.join(cwd, 'r') };
}

async function projectOf(root: string): Promise<MfeflowProject> {
  return parseProject(await fs.readFile(path.join(root, 'mfeflow.json'), 'utf8'));
}

async function installAt(root: string, name: string, version: string): Promise<void> {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
}

describe('init --kind remote', () => {
  it('makes one remote named catalog by default, with no shell and no registry', async () => {
    const cwd = await workspace();
    const { root, out } = await remoteRepo(cwd);
    const project = await projectOf(root);
    expect(validateMfeflowProject(project)).toEqual([]);
    expect(project).toMatchObject({
      repo: 'remote',
      topology: 'monorepo',
      scope: '@acme',
      apps: { catalog: { kind: 'remote', path: 'apps/catalog', port: 4311 } },
    });
    expect(project.shell).toBeUndefined();
    expect(Object.keys(project.apps)).toEqual(['catalog']);
    expect(Object.keys(project.features).slice(0, 3)).toEqual(['core', 'remote-only', 'tsconfig']);
    const files = Object.keys(await readTree(root));
    expect(files.filter((f) => f.startsWith('apps/shell') || f.startsWith('registry/'))).toEqual(
      [],
    );
    expect(files).toContain('apps/catalog/mfeflow.app.json');
    expect(out).toContain('with 1 remote (catalog) and no shell');
  });

  it('reports no skipped shell parts for the files init writes itself', async () => {
    const cwd = await workspace();
    const { out } = await remoteRepo(cwd);
    expect(out).not.toContain('Skipped because');
    const json = await workspace();
    const { out: text } = await remoteRepo(json, '--json');
    const result = JSON.parse(text) as InitResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.plan.skipped).toEqual([]);
  });

  it('still reports the shell parts of a feature the user picked', async () => {
    const cwd = await workspace();
    const { out } = await remoteRepo(cwd, '--features', 'theming');
    expect(out).toContain('Add `theming` in the shell repo too.');
    expect(out).not.toContain('Add `url-factory`');
  });

  it('makes three remotes on consecutive ports and names the root package after the repo of remotes', async () => {
    const cwd = await workspace();
    const { root } = await remoteRepo(cwd, '--remotes', 'cart,checkout,orders');
    const project = await projectOf(root);
    expect(Object.entries(project.apps).map(([name, app]) => [name, app.port])).toEqual([
      ['cart', 4311],
      ['checkout', 4312],
      ['orders', 4313],
    ]);
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(pkg.name).toBe('acme-remotes');
    const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
    expect(readme).toContain('lives in another repo');
    expect(readme).not.toContain('apps/shell');
    const agents = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('holds remotes and no shell');
  });

  it('lists each remote in mfeflow.app.json with the shell it will run in', async () => {
    const cwd = await workspace();
    const { root } = await remoteRepo(cwd, '--remotes', 'cart');
    const app = JSON.parse(
      await fs.readFile(path.join(root, 'apps/cart/mfeflow.app.json'), 'utf8'),
    ) as { shells: string[] };
    expect(app.shells).toEqual(['shell']);
  });

  it('records an https shell address', async () => {
    const cwd = await workspace();
    const { root } = await remoteRepo(
      cwd,
      '--remotes',
      'cart',
      '--shell',
      'https://app.example.com/mf-manifest.json',
    );
    const project = await projectOf(root);
    expect(project.shell).toBe('https://app.example.com/mf-manifest.json');
    expect(validateMfeflowProject(project)).toEqual([]);
  });

  it('records a shell file relative to the new project, with forward slashes', async () => {
    const cwd = await workspace();
    await writeShell(cwd);
    const { root } = await remoteRepo(cwd, '--shell', 'shell.json');
    expect((await projectOf(root)).shell).toBe('../shell.json');
  });

  it('accepts a file: URL for the shell as given', async () => {
    const cwd = await workspace();
    const file = await writeShell(cwd);
    const url = `file://${file.replaceAll('\\', '/')}`;
    const { root } = await remoteRepo(cwd, '--shell', url);
    expect((await projectOf(root)).shell).toBe(url);
  });

  it('writes nothing on --dry-run and prints nothing about a shell it did not make', async () => {
    const cwd = await workspace();
    const { code, out } = await run(cwd, [
      'init',
      'r',
      '--kind',
      'remote',
      '--remotes',
      'cart,checkout',
      '--dry-run',
      '--no-install',
    ]);
    expect(code).toBe(0);
    expect(out).toContain('Dry run: nothing was written.');
    expect(out).not.toContain('apps/shell');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it('prints a valid --json result with the remotes only', async () => {
    const cwd = await workspace();
    const { code, out } = await run(cwd, [
      'init',
      'r',
      '--kind',
      'remote',
      '--remotes',
      'cart,checkout',
      '--yes',
      '--no-install',
      '--json',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(out) as InitResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.apps.map((a) => a.name)).toEqual(['cart', 'checkout']);
    expect(result.next).toEqual(['cd r', 'pnpm install', 'pnpm dev']);
  });

  it('writes the remote parts of shell-owned features and skips their shell parts', async () => {
    const cwd = await workspace();
    const { root } = await remoteRepo(
      cwd,
      '--remotes',
      'cart',
      '--features',
      'theming,i18n,tailwind,telemetry-otel,analytics-gtm,lint-oxlint',
    );
    const project = await projectOf(root);
    for (const name of ['theming', 'i18n', 'tailwind', 'telemetry-otel', 'analytics-gtm']) {
      expect(project.features[name], name).toBeDefined();
    }
    const tree = await readTree(root);
    expect(Object.keys(tree).some((f) => f.startsWith('apps/shell'))).toBe(false);
    const cart = JSON.parse(tree['apps/cart/package.json'] ?? '{}') as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(cart.dependencies).some((d) => d.includes('theme'))).toBe(true);
  });

  it('asks for the remotes and the shell at the prompt', async () => {
    const cwd = await workspace();
    await writeShell(cwd);
    const rt = testRuntime({
      prompter: scriptedPrompter([
        'r',
        '@acme',
        'cart,checkout',
        'shell.json',
        ['lint-oxlint'],
        true,
      ]),
    });
    rt.io.interactive = true;
    const { code } = await run(cwd, ['init', '--kind', 'remote', '--no-install'], rt);
    expect(code).toBe(0);
    expect(rt.prompter).toMatchObject({
      asked: [
        'Where should the project go?',
        'npm scope for your packages',
        'Remotes, comma separated',
        'Address of the deployed shell (https URL or file; empty to skip)',
        'Features',
        'Write these changes?',
      ],
    });
    const project = await projectOf(path.join(cwd, 'r'));
    expect(Object.keys(project.apps)).toEqual(['cart', 'checkout']);
    expect(project.shell).toBe('../shell.json');
  });

  it('records no shell when the prompt is left empty', async () => {
    const cwd = await workspace();
    const rt = testRuntime({
      prompter: scriptedPrompter(['r', '@acme', 'cart', '', ['lint-oxlint'], true]),
    });
    rt.io.interactive = true;
    expect((await run(cwd, ['init', '--kind', 'remote', '--no-install'], rt)).code).toBe(0);
    expect((await projectOf(path.join(cwd, 'r'))).shell).toBeUndefined();
  });

  it('reads the kind from a preset', async () => {
    const cwd = await workspace();
    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(
      preset,
      JSON.stringify({ kind: 'remote', scope: '@acme', remotes: ['cart'], features: [] }),
    );
    const { code } = await run(cwd, ['init', 'r', '--preset', preset, '--yes', '--no-install']);
    expect(code).toBe(0);
    const project = await projectOf(path.join(cwd, 'r'));
    expect(project.repo).toBe('remote');
    expect(Object.keys(project.apps)).toEqual(['cart']);
  });
});

describe('init --kind remote refuses', () => {
  it.each([
    [['--remotes', 'none'], /at least one remote/],
    [['--remotes', ''], /at least one remote/],
    [['--topology', 'polyrepo'], /one repo/],
    [['--packages', 'http'], /--packages is for --kind tooling/],
    [['--shell', 'http://app.example.com/m.json'], /must be https/],
    [['--shell', 'https://user:secret@app.example.com/m.json'], /credentials/],
    [['--shell', 'https://app.example.com/m.json?token=secret'], /credentials or a token/],
    [['--shell', 's3://bucket/m.json'], /https URL/],
    [['--shell', 'missing.json'], /no such file/],
  ])('%j with E107', async (flags, message) => {
    const cwd = await workspace();
    const { code, err } = await run(cwd, [
      'init',
      'r',
      '--kind',
      'remote',
      '--yes',
      '--no-install',
      ...flags,
    ]);
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E107');
    expect(err).toMatch(message);
    expect(err).not.toContain('secret');
    expect(await fs.readdir(cwd)).toEqual([]);
  });

  it.each([
    ['cart,cart', /listed twice/],
    ['shell', /reserved/],
  ])('--remotes %s with E215', async (remotes, message) => {
    const cwd = await workspace();
    const { code, err } = await run(cwd, [
      'init',
      'r',
      '--kind',
      'remote',
      '--remotes',
      remotes,
      '--yes',
      '--no-install',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('MFEFLOW_E215');
    expect(err).toMatch(message);
  });

  it.each(['remote', 'tooling'])(
    'a preset that says topology polyrepo with --kind %s, with E107',
    async (kind) => {
      const cwd = await workspace();
      await fs.writeFile(path.join(cwd, 'p.json'), JSON.stringify({ topology: 'polyrepo' }));
      const { code, err } = await run(cwd, [
        'init',
        'r',
        '--kind',
        kind,
        '--preset',
        'p.json',
        '--yes',
        '--no-install',
      ]);
      expect(code).toBe(2);
      expect(err).toContain('MFEFLOW_E107');
      expect(err).toContain('one repo');
      expect(await fs.readdir(cwd)).toEqual(['p.json']);
    },
  );

  it('--shell without --kind remote', async () => {
    const cwd = await workspace();
    const { code, err } = await run(cwd, [
      'init',
      'a',
      '--shell',
      'https://app.example.com/m.json',
      '--yes',
      '--no-install',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('--shell is for --kind remote');
  });

  it('an empty remotes answer at the prompt', async () => {
    const cwd = await workspace();
    const rt = testRuntime({ prompter: scriptedPrompter(['r', '@acme', '']) });
    rt.io.interactive = true;
    const { code, err } = await run(cwd, ['init', '--kind', 'remote', '--no-install'], rt);
    expect(code).toBe(2);
    expect(err).toContain('at least one remote');
  });
});

describe('a repo of remotes after init', () => {
  async function made(...flags: string[]): Promise<string> {
    const cwd = await workspace();
    return (await remoteRepo(cwd, '--remotes', 'cart,checkout', ...flags)).root;
  }

  it('validates with no errors and says the registry is elsewhere', async () => {
    const root = await made();
    const { code, out } = await run(root, ['validate']);
    expect(code).toBe(0);
    expect(out).toContain('the registry is in the shell repo');
  });

  it('doctor without a shell address keeps its one warning', async () => {
    const root = await made();
    const { code, out } = await run(root, ['doctor', '--json']);
    const result = JSON.parse(out) as ReportResult;
    expect(code).toBe(0);
    expect(result.summary.errors).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain(
      'shell is not in this repo, run `mfeflow doctor --against <url|file>`',
    );
    expect(result.against).toBeUndefined();
  });

  it('check-compat without a shell address keeps its warning', async () => {
    const root = await made();
    const { out } = await run(root, ['check-compat', '--json']);
    const result = JSON.parse(out) as ReportResult;
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain(
      'shell is not in this repo, pass --against <url|file>',
    );
  });

  it('doctor uses the recorded shell file and has no warning', async () => {
    const cwd = await workspace();
    await writeShell(cwd);
    const { root } = await remoteRepo(cwd, '--remotes', 'cart', '--shell', 'shell.json');
    await installAt(root, 'react', '19.3.1');
    const { code, out } = await run(root, ['doctor', '--json']);
    const result = JSON.parse(out) as ReportResult;
    expect(code).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.against).toBe('../shell.json');
  });

  it('doctor finds the recorded shell file from a folder inside the project', async () => {
    const cwd = await workspace();
    await writeShell(cwd);
    const { root } = await remoteRepo(cwd, '--remotes', 'cart', '--shell', 'shell.json');
    const { code, out } = await run(path.join(root, 'apps', 'cart'), ['doctor', '--json']);
    expect(code).toBe(0);
    expect((JSON.parse(out) as ReportResult).findings).toEqual([]);
  });

  it('check-compat checks against the recorded shell and fails on a skewed version', async () => {
    const cwd = await workspace();
    await writeShell(cwd);
    const { root } = await remoteRepo(cwd, '--remotes', 'cart', '--shell', 'shell.json');
    await installAt(root, 'react', '18.2.0');
    await installAt(root, 'react-dom', '18.2.0');
    const { code, out } = await run(root, ['check-compat', '--json']);
    const result = JSON.parse(out) as ReportResult;
    expect(code).toBe(5);
    expect(result.findings.some((f) => f.code === 'MFEFLOW_E302' && f.severity === 'error')).toBe(
      true,
    );
    expect(result.against).toBe('../shell.json');
  });

  it('an explicit --against wins over the recorded shell', async () => {
    const cwd = await workspace();
    await writeShell(cwd);
    const other = await writeShell(cwd, 'other.json');
    const { root } = await remoteRepo(cwd, '--remotes', 'cart', '--shell', 'shell.json');
    const { out } = await run(root, ['doctor', '--against', other, '--json']);
    expect((JSON.parse(out) as ReportResult).against).toBe(other);
  });

  it('a recorded shell that cannot be read is E307', async () => {
    const cwd = await workspace();
    const file = await writeShell(cwd);
    const { root } = await remoteRepo(cwd, '--remotes', 'cart', '--shell', 'shell.json');
    await fs.rm(file);
    const { code, err } = await run(root, ['doctor']);
    expect(code).toBe(5);
    expect(err).toContain('MFEFLOW_E307');
  });

  it('a recorded https shell is fetched like --against', async () => {
    const cwd = await workspace();
    const { root } = await remoteRepo(
      cwd,
      '--remotes',
      'cart',
      '--shell',
      'https://app.example.com/mf-manifest.json',
    );
    const asked: string[] = [];
    const rt = testRuntime({
      fetch: (url) => {
        asked.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(SHELL_MANIFEST)),
        });
      },
    });
    const { code, out } = await run(root, ['check-compat', '--json'], rt);
    expect(code).toBe(0);
    expect(asked).toEqual(['https://app.example.com/mf-manifest.json']);
    expect((JSON.parse(out) as ReportResult).against).toBe(
      'https://app.example.com/mf-manifest.json',
    );
  });

  it('add remote writes the app and no route or registry entry', async () => {
    const root = await made();
    const before = Object.keys(await readTree(root));
    const { code, err } = await run(root, ['add', 'remote', 'orders', '--no-install']);
    expect(err).toBe('');
    expect(code).toBe(0);
    const added = Object.keys(await readTree(root)).filter((f) => !before.includes(f));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((f) => f.startsWith('apps/orders/'))).toBe(true);
    const project = await projectOf(root);
    expect(project.apps.orders).toEqual({ kind: 'remote', path: 'apps/orders', port: 4313 });
    expect(await run(root, ['doctor', '--json'])).toMatchObject({ code: 0 });
  });

  it('dev runs the remotes and, with a recorded shell, says how to see one there', async () => {
    const cwd = await workspace();
    const { root } = await remoteRepo(
      cwd,
      '--remotes',
      'cart,checkout',
      '--shell',
      'https://app.example.com/mf-manifest.json',
    );
    const { code, out } = await run(root, ['dev', '--dry-run']);
    expect(code).toBe(0);
    expect(out).toContain('cart: pnpm run dev');
    expect(out).toContain('checkout: pnpm run dev');
    expect(out).not.toContain('shell:');
    const hint = out.split('\n').find((line) => line.includes('mfe-override'));
    expect(hint).toBe(
      'mfeflow: the shell is at https://app.example.com/mf-manifest.json. To see cart there, add ?mfe-override=cart@http://localhost:4311/mf-manifest.json to a page of that shell. This works only if that shell is a development build; production builds ignore overrides.',
    );
  });

  it('dev says nothing about a shell when none is recorded', async () => {
    const root = await made();
    const { code, out } = await run(root, ['dev', '--dry-run']);
    expect(code).toBe(0);
    expect(out).not.toContain('mfe-override');
  });

  it('upgrade --dry-run finds nothing to write, and does not bring back a registry or the core README', async () => {
    const root = await made();
    const before = await readTree(root);
    const { code, out } = await run(root, ['upgrade', '--dry-run', '--json']);
    expect(code).toBe(0);
    const result = JSON.parse(out) as {
      upToDate: boolean;
      created: string[];
      replaced: string[];
      removed: string[];
    };
    expect(result).toMatchObject({ upToDate: true, created: [], replaced: [], removed: [] });
    expect(await readTree(root)).toEqual(before);
  });

  it('upgrade does not treat an edited README as a missing or removed file', async () => {
    const root = await made();
    await fs.appendFile(path.join(root, 'README.md'), '\nour notes\n');
    const { code, out } = await run(root, ['upgrade', '--dry-run', '--json']);
    expect(code).toBe(0);
    const result = JSON.parse(out) as { created: string[]; removed: string[]; edited: string[] };
    expect(result.created).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});

describe('remote-only helpers', () => {
  it('knows a repo of remotes by its repo field alone', () => {
    expect(isRemoteRepo({ repo: 'remote' })).toBe(true);
    expect(isRemoteRepo({ repo: 'shell' })).toBe(false);
    expect(isRemoteRepo({})).toBe(false);
  });

  it('writes registry entries and routes only outside a repo of remotes', () => {
    expect(glueScope({})).toEqual({ registry: true, shells: ['shell'] });
    expect(glueScope({ repo: 'shell' })).toEqual({ registry: true, shells: ['shell'] });
    expect(glueScope({ repo: 'remote' })).toEqual({ registry: false, shells: [] });
  });

  it('leaves core alone for an app repo and drops the registry folders and root texts for remotes', async () => {
    const core = await loadAny('core', { roots: testRuntime().roots });
    expect(await coreFor({ scope: '@acme' }, core)).toBe(core);
    const trimmed = await coreFor({ repo: 'remote', scope: '@acme' }, core);
    const targets = (trimmed.manifest.files ?? []).map((f) => f.to);
    expect(targets.some((to) => to.startsWith('registry/'))).toBe(false);
    expect(targets).not.toContain('README.md');
    expect(targets).not.toContain('AGENTS.md');
    expect(targets).toContain('pnpm-workspace.yaml');
    expect(trimmed.manifest.version).toBe(core.manifest.version);
  });
});
