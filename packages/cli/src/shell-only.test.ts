import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseProject } from '@mfeflow/core';
import { main, validateResult, type BudgetResult, type InitResult } from '.';
import { parseRemotes } from './commands/init';
import { readTree, removeDir, scriptedPrompter, tempDir, testRuntime } from './testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function workspace(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  return cwd;
}

async function init(
  cwd: string,
  ...argv: string[]
): Promise<{ code: number; out: string[]; err: string[] }> {
  const rt = testRuntime();
  const code = await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd, ...argv], rt);
  return { code, out: rt.io.out, err: rt.io.err };
}

async function shellOnly(): Promise<string> {
  const cwd = await workspace();
  expect((await init(cwd, '--remotes', 'none')).code).toBe(0);
  return path.join(cwd, 'app');
}

async function appNames(root: string): Promise<string[]> {
  const project = parseProject(await fs.readFile(path.join(root, 'mfeflow.json'), 'utf8'));
  return Object.keys(project.apps);
}

describe('parseRemotes', () => {
  it('reads empty and none as no remotes, and keeps a list', () => {
    expect(parseRemotes(undefined)).toBeUndefined();
    expect(parseRemotes('')).toEqual([]);
    expect(parseRemotes(' none ')).toEqual([]);
    expect(parseRemotes(['none'])).toEqual([]);
    expect(parseRemotes('a, b')).toEqual(['a', 'b']);
  });

  it('refuses none next to a name (E107)', () => {
    expect(() => parseRemotes('none,cart')).toThrow(/cannot be mixed/);
  });
});

describe('mfeflow init with only a shell', () => {
  it.each([
    ['--remotes none', ['--remotes', 'none']],
    ['--remotes ""', ['--remotes', '']],
    ['--remotes=', ['--remotes=']],
  ])('%s writes a monorepo with a shell and no remotes', async (_name, flags) => {
    const cwd = await workspace();
    const { code, out } = await init(cwd, ...flags);
    expect(code).toBe(0);
    const root = path.join(cwd, 'app');
    expect(await appNames(root)).toEqual(['shell']);
    const files = Object.keys(await readTree(root));
    expect(files).toContain('apps/shell/src/pages/Home.tsx');
    expect(
      files.filter((file) => file.startsWith('apps/') && !file.startsWith('apps/shell/')),
    ).toEqual([]);
    expect(files).not.toContain('registry/envs/dev/catalog.json');
    expect(out.join('\n')).toContain('Created');
    expect(out.join('\n')).toContain('only a shell');
    expect(out.join('\n')).toContain('mfeflow add remote <name>');
  });

  it('takes an empty list from a preset', async () => {
    const cwd = await workspace();
    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(preset, JSON.stringify({ remotes: [] }));
    expect((await init(cwd, '--preset', preset)).code).toBe(0);
    expect(await appNames(path.join(cwd, 'app'))).toEqual(['shell']);
  });

  it('reads none in a preset the same way', async () => {
    const cwd = await workspace();
    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(preset, JSON.stringify({ remotes: ['none'] }));
    expect((await init(cwd, '--preset', preset)).code).toBe(0);
    expect(await appNames(path.join(cwd, 'app'))).toEqual(['shell']);
  });

  it('lets an empty flag override a preset that lists remotes', async () => {
    const cwd = await workspace();
    const preset = path.join(cwd, 'preset.json');
    await fs.writeFile(preset, JSON.stringify({ remotes: ['a'] }));
    expect((await init(cwd, '--preset', preset, '--remotes', '')).code).toBe(0);
    expect(await appNames(path.join(cwd, 'app'))).toEqual(['shell']);
  });

  it('still creates catalog and cart when the flag is not given', async () => {
    const cwd = await workspace();
    expect((await init(cwd)).code).toBe(0);
    expect(await appNames(path.join(cwd, 'app'))).toEqual(['shell', 'catalog', 'cart']);
  });

  it('treats an empty answer at the prompt as no remotes', async () => {
    const cwd = await workspace();
    const prompter = scriptedPrompter(['app', '@app', '', [], true]);
    const rt = testRuntime({ prompter });
    rt.io.interactive = true;
    const code = await main(['init', '--no-install', '--cwd', cwd], rt);
    expect(code).toBe(0);
    expect(prompter.asked).toContain('Remotes, comma separated (empty for none)');
    expect(await appNames(path.join(cwd, 'app'))).toEqual(['shell']);
  });

  it('refuses none mixed with a name (E107)', async () => {
    const cwd = await workspace();
    const { code, err } = await init(cwd, '--remotes', 'none,cart');
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('MFEFLOW_E107');
    expect(err.join('\n')).toContain('cannot be mixed');
    await expect(fs.stat(path.join(cwd, 'app'))).rejects.toThrow();
  });

  it('reports one app in the JSON result and a dry run lists only the shell', async () => {
    const cwd = await workspace();
    const { code, out } = await init(cwd, '--remotes', 'none', '--dry-run', '--json');
    expect(code).toBe(0);
    const result = JSON.parse(out.join('')) as InitResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.apps.map((app) => app.name)).toEqual(['shell']);
    await expect(fs.stat(path.join(cwd, 'app'))).rejects.toThrow();
  });

  it('writes a shell page that says there are no remotes and how to add one', async () => {
    const root = await shellOnly();
    const home = await fs.readFile(path.join(root, 'apps/shell/src/pages/Home.tsx'), 'utf8');
    expect(home).toContain('No remotes yet. Add one with `mfeflow add remote &lt;name&gt;`.');
  });
});

describe('a polyrepo with only a shell', () => {
  it.each([['none'], ['']])(
    '--remotes "%s" writes the platform and shell repos only',
    async (value) => {
      const cwd = await workspace();
      const rt = testRuntime();
      const code = await main(
        [
          'init',
          'acme',
          '--topology',
          'polyrepo',
          '--remotes',
          value,
          '--yes',
          '--no-install',
          '--json',
          '--cwd',
          cwd,
        ],
        rt,
      );
      expect(code).toBe(0);
      const result = JSON.parse(rt.io.out.join('')) as InitResult;
      expect(result.repos?.map((repo) => repo.name)).toEqual(['platform', 'shell']);
      const org = path.join(cwd, 'acme');
      expect((await fs.readdir(org)).toSorted()).toEqual(['platform', 'shell']);
      const dev = JSON.parse(
        await fs.readFile(
          path.join(org, 'shell/apps/shell/public/config/runtime-config.dev.json'),
          'utf8',
        ),
      ) as { devRemotes: Record<string, unknown> };
      expect(dev.devRemotes).toEqual({});
      expect(result.next.some((line) => line.includes('dev   #'))).toBe(false);
    },
  );

  it('takes a team repo afterwards and lists it in the shell dev config', async () => {
    const cwd = await workspace();
    await main(
      [
        'init',
        'acme',
        '--topology',
        'polyrepo',
        '--remotes',
        'none',
        '--yes',
        '--no-install',
        '--cwd',
        cwd,
      ],
      testRuntime(),
    );
    const shell = path.join(cwd, 'acme/shell');
    const rt = testRuntime();
    const code = await main(['add', 'team-repo', 'checkout', '--no-install', '--cwd', shell], rt);
    expect(code).toBe(0);
    const dev = JSON.parse(
      await fs.readFile(
        path.join(shell, 'apps/shell/public/config/runtime-config.dev.json'),
        'utf8',
      ),
    ) as { devRemotes: Record<string, unknown> };
    expect(Object.keys(dev.devRemotes)).toEqual(['checkout']);
    expect(
      await fs.readFile(path.join(shell, 'apps/shell/src/remotes/route-table.tsx'), 'utf8'),
    ).toContain("path: '/checkout'");
    await expect(
      fs.stat(path.join(cwd, 'acme/checkout/apps/checkout/package.json')),
    ).resolves.toBeDefined();
  });
});

describe('commands on a shell-only project', () => {
  it('add remote writes the remote, its registry entries and the route', async () => {
    const root = await shellOnly();
    const rt = testRuntime();
    expect(await main(['add', 'remote', 'cart', '--no-install', '--cwd', root], rt)).toBe(0);
    const tree = await readTree(root);
    expect(Object.keys(tree)).toEqual(
      expect.arrayContaining([
        'apps/cart/package.json',
        'registry/envs/dev/cart.json',
        'apps/shell/src/remotes/cart.tsx',
      ]),
    );
    expect(tree['apps/shell/src/remotes/route-table.tsx']).toContain("path: '/cart'");
    expect(await appNames(root)).toEqual(['shell', 'cart']);
  });

  it('dev says there are no remotes and how to add one, and still runs the shell', async () => {
    const root = await shellOnly();
    const rt = testRuntime();
    expect(await main(['dev', '--dry-run', '--cwd', root], rt)).toBe(0);
    const lines = rt.io.out;
    expect(lines.join('\n')).toContain(
      'mfeflow: this project has no remotes yet. Add one with `mfeflow add remote <name>`.',
    );
    expect(lines.join('\n')).toContain('shell: ');
    expect(lines.join('\n')).toContain('dev registry: []');
  });

  it('dev keeps the line out of stdout with --json', async () => {
    const root = await shellOnly();
    const rt = testRuntime();
    expect(await main(['dev', '--dry-run', '--json', '--cwd', root], rt)).toBe(0);
    expect(rt.io.err.join('\n')).toContain('no remotes yet');
    expect(() => JSON.parse(rt.io.out.join('')) as unknown).not.toThrow();
  });

  it('dev stays quiet about remotes when the project has one', async () => {
    const cwd = await workspace();
    await init(cwd, '--remotes', 'cart');
    const rt = testRuntime();
    await main(['dev', '--dry-run', '--cwd', path.join(cwd, 'app')], rt);
    expect(rt.io.out.join('\n')).not.toContain('no remotes yet');
  });

  it('doctor and validate pass', async () => {
    const root = await shellOnly();
    for (const command of ['doctor', 'validate']) {
      const rt = testRuntime();
      expect(await main([command, '--json', '--cwd', root], rt)).toBe(0);
      const result = JSON.parse(rt.io.out.join('')) as { ok: boolean };
      expect(result.ok).toBe(true);
    }
  });

  it('upgrade --dry-run runs and writes nothing', async () => {
    const root = await shellOnly();
    const before = await readTree(root);
    const rt = testRuntime();
    expect(await main(['upgrade', '--dry-run', '--cwd', root], rt)).toBe(0);
    expect(await readTree(root)).toEqual(before);
  });

  it('budget measures the shell and has no remotes to report', async () => {
    const root = await shellOnly();
    const dist = path.join(root, 'apps/shell/dist');
    await fs.mkdir(path.join(dist, 'static/js'), { recursive: true });
    await fs.writeFile(
      path.join(dist, 'index.html'),
      '<html><script defer src="/static/js/0.js"></script></html>',
    );
    await fs.writeFile(path.join(dist, 'static/js/0.js'), randomBytes(2048));
    const rt = testRuntime();
    expect(await main(['budget', '--json', '--cwd', root], rt)).toBe(0);
    const result = JSON.parse(rt.io.out.join('')) as BudgetResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.shells.map((shell) => shell.name)).toEqual(['shell']);
    expect(result.remotes).toEqual([]);
  });
});
