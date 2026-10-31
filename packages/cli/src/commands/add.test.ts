import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProject } from '@mfeflow/core';
import type { FetchLike } from '@mfeflow/core';
import { main, validateResult, type AddResult } from '..';
import { readTree, removeDir, scriptedPrompter, tempDir, testRuntime } from '../testing';

let cwd = '';
let project = '';

beforeEach(async () => {
  cwd = await tempDir();
  project = path.join(cwd, 'app');
  const code = await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
  expect(code).toBe(0);
});
afterEach(async () => {
  await removeDir(cwd);
});

const add = (args: string[], rt = testRuntime()) =>
  main(['add', ...args, '--cwd', project], rt).then((code) => ({ code, rt }));

const load = async () =>
  parseProject(await fs.readFile(path.join(project, 'mfeflow.json'), 'utf8'));
const read = (file: string) => fs.readFile(path.join(project, file), 'utf8');

function jsonOf(out: string[]): AddResult {
  const value: unknown = JSON.parse(out.join(''));
  expect(validateResult(value)).toEqual([]);
  return value as AddResult;
}

describe('mfeflow add remote', () => {
  it('creates the app, its registry entries and its route, and records the app', async () => {
    const { code, rt } = await add(['remote', 'checkout', '--no-install']);
    expect(code).toBe(0);
    const tree = await readTree(project);
    expect(Object.keys(tree)).toEqual(
      expect.arrayContaining([
        'apps/checkout/package.json',
        'apps/checkout/rsbuild.config.ts',
        'apps/checkout/mfe.json',
        'apps/checkout/src/exposed/App.tsx',
        'apps/checkout/tsconfig.json',
        'apps/checkout/src/api/endpoints.ts',
        'registry/envs/dev/checkout.json',
        'registry/envs/staging/checkout.json',
        'registry/envs/prod/checkout.json',
        'apps/shell/src/remotes/checkout.tsx',
      ]),
    );
    expect(tree['apps/checkout/rsbuild.config.ts']).toContain("name: 'checkout'");
    expect(tree['apps/checkout/rsbuild.config.ts']).toContain('port: 4313');
    expect(tree['registry/envs/dev/checkout.json']).toContain(
      'http://localhost:4313/mf-manifest.json',
    );
    expect(tree['apps/shell/src/remotes/route-table.tsx']).toContain(
      "{ path: '/checkout', Component: CheckoutRoute },",
    );
    expect(tree['apps/shell/src/remotes/route-table.tsx']).toContain(
      "import { CheckoutRoute } from './checkout';",
    );
    const saved = await load();
    expect(saved.apps.checkout).toEqual({ kind: 'remote', path: 'apps/checkout', port: 4313 });
    expect(Object.keys(saved.features)).toEqual(['core', 'tsconfig', 'lint-oxlint', 'url-factory']);
    expect(saved.files?.['apps/checkout/src/exposed/App.tsx']).toMatch(/^sha256-/);
    expect(rt.io.out.join('\n')).toContain('Added checkout (remote).');
    expect(rt.system.installs).toEqual([]);
  });

  it('leaves the other apps and files exactly as they were', async () => {
    const before = await readTree(project);
    await add(['remote', 'checkout', '--no-install']);
    const after = await readTree(project);
    const changed = Object.keys(before).filter((file) => before[file] !== after[file]);
    expect(changed.toSorted()).toEqual(['apps/shell/src/remotes/route-table.tsx', 'mfeflow.json']);
  });

  it('installs afterwards, since the new app has dependencies', async () => {
    const { rt } = await add(['remote', 'checkout']);
    expect(rt.system.installs).toEqual([{ root: project, packageManager: 'pnpm', verbose: false }]);
  });

  it('takes a port, and refuses one that is taken or not a port (E107)', async () => {
    await add(['remote', 'checkout', '--port', '4400', '--no-install']);
    expect((await load()).apps.checkout?.port).toBe(4400);
    for (const port of ['4311', '0', '70000', 'abc', '43.5']) {
      const { code, rt } = await add([
        'remote',
        `r${port.replace('.', '')}`,
        '--port',
        port,
        '--no-install',
      ]);
      expect(code).toBe(2);
      expect(rt.io.err.join('\n')).toContain('--port');
    }
  });

  it('writes nothing on --dry-run and prints the diff', async () => {
    const before = await readTree(project);
    const { code, rt } = await add(['remote', 'checkout', '--dry-run']);
    expect(code).toBe(0);
    expect(await readTree(project)).toEqual(before);
    expect(rt.system.installs).toEqual([]);
    expect(rt.io.out.join('\n')).toContain('diff --mfeflow apps/checkout/mfe.json');
    expect(rt.io.out.join('\n')).toContain('+++ b/mfeflow.json');
  });

  it('prints schema-valid JSON', async () => {
    const { rt } = await add(['remote', 'checkout', '--json', '--no-install']);
    const result = jsonOf(rt.io.out);
    expect(result).toMatchObject({
      kind: 'remote',
      added: ['checkout'],
      skipped: [],
      dryRun: false,
    });
    expect(result.written).toContain('apps/checkout/package.json');
    const dry = await add(['remote', 'orders', '--json', '--dry-run']);
    expect(jsonOf(dry.rt.io.out)).toMatchObject({ dryRun: true, written: [] });
  });

  it('asks for the name when there is a terminal, and fails clearly when there is not', async () => {
    const rt = testRuntime({ prompter: scriptedPrompter(['orders', true]) });
    rt.io.interactive = true;
    expect((await add(['remote', '--no-install'], rt)).code).toBe(0);
    expect((await load()).apps).toHaveProperty('orders');
    const quiet = await add(['remote']);
    expect(quiet.code).toBe(2);
    expect(quiet.rt.io.err.join('\n')).toContain('add remote needs a name');
  });

  it.each(['catalog', 'shell', 'Bad-Name'])('refuses the name %s (E215)', async (name) => {
    const { code, rt } = await add(['remote', name, '--no-install']);
    expect(code).toBe(2);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E215');
  });

  it('fails outside a project with E102', async () => {
    const rt = testRuntime();
    expect(await main(['add', 'remote', 'x', '--cwd', cwd], rt)).toBe(3);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E102');
  });

  it('rolls back everything when the install fails', async () => {
    const before = await readTree(project);
    const rt = testRuntime();
    rt.system.install = () => Promise.reject(new Error('registry unreachable'));
    expect((await add(['remote', 'checkout'], rt)).code).toBe(4);
    expect(await readTree(project)).toEqual(before);
  });

  it('keeps a file of yours that is in the way and reports it (E207)', async () => {
    await fs.writeFile(path.join(project, 'apps/shell/src/remotes/checkout.tsx'), 'mine');
    const { code, rt } = await add(['remote', 'checkout', '--no-install']);
    expect(code).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E207');
    expect(await read('apps/shell/src/remotes/checkout.tsx')).toBe('mine');
  });
});

describe('mfeflow add shell', () => {
  it('creates a shell that routes to every existing remote', async () => {
    const { code } = await add(['shell', 'admin', '--no-install']);
    expect(code).toBe(0);
    const routes = await read('apps/admin/src/remotes/route-table.tsx');
    expect(routes).toContain("{ path: '/catalog', Component: CatalogRoute },");
    expect(routes).toContain("{ path: '/cart', Component: CartRoute },");
    expect(await read('apps/admin/src/remotes/cart.tsx')).toContain('id="cart/App"');
    expect(await read('apps/admin/rsbuild.config.ts')).toContain('port: 4301');
    expect(await read('apps/admin/src/api/endpoints.ts')).toContain('createUrlFactory');
    expect((await load()).apps.admin).toEqual({ kind: 'shell', path: 'apps/admin', port: 4301 });
    expect(await fs.readdir(path.join(project, 'registry/envs/dev'))).toEqual([
      '.gitkeep',
      'cart.json',
      'catalog.json',
    ]);
  });

  it('puts a remote added later into every shell', async () => {
    await add(['shell', 'admin', '--no-install']);
    await add(['remote', 'checkout', '--no-install']);
    expect(await read('apps/admin/src/remotes/route-table.tsx')).toContain('CheckoutRoute');
    expect(await read('apps/shell/src/remotes/route-table.tsx')).toContain('CheckoutRoute');
  });
});

describe('mfeflow add <feature>', () => {
  it('adds a feature, records it, and installs', async () => {
    const { code, rt } = await add(['git-hooks']);
    expect(code).toBe(0);
    expect(await read('lefthook.yml')).toContain('commitlint');
    expect(await read('package.json')).toContain('"prepare": "lefthook install"');
    expect(Object.keys((await load()).features)).toContain('git-hooks');
    expect(rt.system.installs).toHaveLength(1);
    expect(rt.io.out.join('\n')).toContain('Added git-hooks.');
  });

  it('says so when a feature is already there, and writes nothing', async () => {
    const before = await readTree(project);
    const { code, rt } = await add(['url-factory']);
    expect(code).toBe(0);
    expect(rt.io.out.join('\n')).toContain('url-factory already added; nothing to do.');
    expect(await readTree(project)).toEqual(before);
    const json = await add(['url-factory', '--json']);
    expect(jsonOf(json.rt.io.out)).toMatchObject({ added: [], skipped: ['url-factory'] });
    const dry = await add(['url-factory', '--json', '--dry-run']);
    expect(jsonOf(dry.rt.io.out)).toMatchObject({ dryRun: true, diff: '' });
  });

  it('reports a feature that does not exist (E201) without touching files', async () => {
    const before = await readTree(project);
    const { code, rt } = await add(['nope']);
    expect(code).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E201');
    expect(await readTree(project)).toEqual(before);
  });

  it('needs a feature name, or asks which ones when there is a terminal', async () => {
    expect((await add([])).code).toBe(2);
    const rt = testRuntime({ prompter: scriptedPrompter([['git-hooks'], true]) });
    rt.io.interactive = true;
    expect((await add(['--no-install'], rt)).code).toBe(0);
    expect(Object.keys((await load()).features)).toContain('git-hooks');
    expect(rt.prompter).toMatchObject({ asked: ['Add which features?', 'Write these changes?'] });
  });

  it('writes nothing on --dry-run', async () => {
    const before = await readTree(project);
    const { code, rt } = await add(['git-hooks', '--dry-run']);
    expect(code).toBe(0);
    expect(await readTree(project)).toEqual(before);
    expect(rt.system.installs).toEqual([]);
    expect(rt.io.out.join('\n')).toContain('diff --mfeflow lefthook.yml');
  });

  it('refuses an option the feature does not have (E214) and a malformed preset', async () => {
    const { code, rt } = await add(['git-hooks', '--option', 'git-hooks.bogus=1', '--no-install']);
    expect(code).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E214');
    expect((await add(['git-hooks', '--preset', 'missing.json'])).code).toBe(3);
  });

  it('rejects flags it does not know', async () => {
    expect((await add(['git-hooks', '--frobnicate'])).code).toBe(2);
  });
});

describe('mfeflow add @namespace/feature', () => {
  const manifest = {
    name: '@acme/hello',
    version: '1.0.0',
    prompts: [{ name: 'loud', type: 'boolean', message: 'Shout?', default: false }],
    files: [
      {
        to: 'src/hello.ts',
        target: 'shell',
        content: 'export const hello = "{{options.loud}}";\n',
        template: true,
      },
    ],
  };
  const fetchManifest: FetchLike = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(manifest)),
    });

  beforeEach(async () => {
    const file = path.join(project, 'mfeflow.json');
    const saved = parseProject(await fs.readFile(file, 'utf8'));
    saved.registries = { '@acme': 'https://acme.dev/{name}.json' };
    await fs.writeFile(file, `${JSON.stringify(saved, null, 2)}\n`);
  });

  it('will not apply a registry feature without --yes when nobody can confirm', async () => {
    const before = await readTree(project);
    const rt = testRuntime({ fetch: fetchManifest });
    const { code } = await add(['@acme/hello', '--no-install'], rt);
    expect(code).toBe(2);
    expect(rt.io.err.join('\n')).toContain('--yes');
    expect(await readTree(project)).toEqual(before);
  });

  it('applies it with --yes, using the option given by --option', async () => {
    const rt = testRuntime({ fetch: fetchManifest });
    const { code } = await add(
      ['@acme/hello', '--yes', '--no-install', '--option', '@acme/hello.loud=true'],
      rt,
    );
    expect(rt.io.err.join('\n')).toBe('');
    expect(code).toBe(0);
    expect(await read('apps/shell/src/hello.ts')).toBe('export const hello = "true";\n');
  });

  it('asks the feature prompts and then for confirmation when a person is there', async () => {
    const rt = testRuntime({ fetch: fetchManifest, prompter: scriptedPrompter([true, true]) });
    rt.io.interactive = true;
    expect((await add(['@acme/hello', '--no-install'], rt)).code).toBe(0);
    expect(rt.prompter).toMatchObject({ asked: ['Shout?', 'Write these changes?'] });
    expect(await read('apps/shell/src/hello.ts')).toContain('"true"');
  });

  it('reports a registry that is not configured (E210)', async () => {
    const { code, rt } = await add(
      ['@other/thing', '--yes'],
      testRuntime({ fetch: fetchManifest }),
    );
    expect(code).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E210');
  });
});
