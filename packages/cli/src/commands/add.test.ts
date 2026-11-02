import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTrusted, integrityOf, parseProject } from '@mfeflow/core';
import type { FetchLike } from '@mfeflow/core';
import { inCatalogueOrder } from '../catalog';
import { main, validateResult, type AddResult } from '..';
import { REPO, readTree, removeDir, scriptedPrompter, tempDir, testRuntime } from '../testing';
import { readPackageJson } from '../version';

const CLI_VERSION = readPackageJson().version;

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
        'apps/checkout/mfeflow.app.json',
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
    expect(saved.cli).toBe(readPackageJson().version);
    expect(Object.keys(saved.features)).toEqual([
      'core',
      'tsconfig',
      'lint-oxlint',
      'url-factory',
      'env-t3',
      'testing',
    ]);
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
    expect(rt.io.out.join('\n')).toContain('diff --mfeflow apps/checkout/mfeflow.app.json');
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

  it('takes back the .git that add git-hooks created when the install fails', async () => {
    const before = await readTree(project);
    const rt = testRuntime();
    rt.system.gitInit = async (root) => {
      await fs.mkdir(path.join(root, '.git'));
      return true;
    };
    rt.system.install = () => Promise.reject(new Error('registry unreachable'));
    expect((await add(['git-hooks'], rt)).code).toBe(4);
    expect(await readTree(project)).toEqual(before);
    expect(await fs.readdir(project)).not.toContain('.git');
  });

  it('keeps a .git that was already there when the install fails', async () => {
    await fs.mkdir(path.join(project, '.git'));
    const rt = testRuntime();
    rt.system.install = () => Promise.reject(new Error('registry unreachable'));
    expect((await add(['git-hooks'], rt)).code).toBe(4);
    expect(await fs.readdir(project)).toContain('.git');
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

  it('runs git init for git-hooks, before the install, like init does', async () => {
    const rt = testRuntime();
    const events: string[] = [];
    rt.system.gitInit = (root) => {
      events.push(`git ${path.basename(root)}`);
      return Promise.resolve(true);
    };
    rt.system.install = () => {
      events.push('install');
      return Promise.resolve();
    };
    expect((await add(['git-hooks'], rt)).code).toBe(0);
    expect(events).toEqual(['git app', 'install']);
  });

  it('runs git init for git-hooks with --no-install too', async () => {
    const { code, rt } = await add(['git-hooks', '--no-install']);
    expect(code).toBe(0);
    expect(rt.system.gitInits).toEqual([project]);
  });

  it('does not run git init in a dry run', async () => {
    const { rt } = await add(['git-hooks', '--dry-run']);
    expect(rt.system.gitInits).toEqual([]);
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

  it('rejects an option for a feature that is not being added (E214)', async () => {
    const before = await readTree(project);
    const { code, rt } = await add(['git-hooks', '--option', 'git-hook.x=1']);
    expect(code).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E214');
    expect(await readTree(project)).toEqual(before);
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
  /** The feature at every URL except the index, which this registry does not have. */
  const fetchManifest: FetchLike = (url) =>
    Promise.resolve({
      ok: !url.endsWith('/index.json'),
      status: url.endsWith('/index.json') ? 404 : 200,
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
    const rt = testRuntime({ trust: ['@acme'], fetch: fetchManifest });
    const { code } = await add(['@acme/hello', '--no-install'], rt);
    expect(code).toBe(2);
    expect(rt.io.err.join('\n')).toContain('--yes');
    expect(await readTree(project)).toEqual(before);
  });

  it('previews it with --dry-run without --yes, since nothing is written', async () => {
    const before = await readTree(project);
    const rt = testRuntime({ trust: ['@acme'], fetch: fetchManifest });
    const { code } = await add(['@acme/hello', '--dry-run'], rt);
    expect(rt.io.err.join('\n')).toBe('');
    expect(code).toBe(0);
    expect(rt.io.out.join('\n')).toContain('src/hello.ts');
    expect(await readTree(project)).toEqual(before);
  });

  it('applies it with --yes, using the option given by --option', async () => {
    const rt = testRuntime({ trust: ['@acme'], fetch: fetchManifest });
    const { code } = await add(
      ['@acme/hello', '--yes', '--no-install', '--option', '@acme/hello.loud=true'],
      rt,
    );
    expect(rt.io.err.join('\n')).toBe('');
    expect(code).toBe(0);
    expect(await read('apps/shell/src/hello.ts')).toBe('export const hello = "true";\n');
  });

  it('asks the feature prompts and then for confirmation when a person is there', async () => {
    const rt = testRuntime({
      trust: ['@acme'],
      fetch: fetchManifest,
      prompter: scriptedPrompter([true, true]),
    });
    rt.io.interactive = true;
    expect((await add(['@acme/hello', '--no-install'], rt)).code).toBe(0);
    expect(rt.prompter).toMatchObject({ asked: ['Shout?', 'Write these changes?'] });
    expect(await read('apps/shell/src/hello.ts')).toContain('"true"');
  });

  it('reports a registry that is not configured (E210)', async () => {
    const { code, rt } = await add(
      ['@other/thing', '--yes'],
      testRuntime({ trust: ['@acme'], fetch: fetchManifest }),
    );
    expect(code).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E210');
  });

  describe('when a new app is added to a project that has it installed', () => {
    const serving =
      (version: string, urls: string[] = []): FetchLike =>
      (url) => {
        urls.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ ...manifest, version })),
        });
      };

    beforeEach(async () => {
      const { code } = await add(
        ['@acme/hello', '--yes', '--no-install'],
        testRuntime({ trust: ['@acme'], fetch: fetchManifest }),
      );
      expect(code).toBe(0);
    });

    it('asks for the same confirmation before applying it, and writes nothing without it', async () => {
      const before = await readTree(project);
      const rt = testRuntime({ trust: ['@acme'], fetch: fetchManifest });
      const { code } = await add(['shell', 'admin', '--no-install'], rt);
      expect(code).toBe(2);
      expect(rt.io.err.join('\n')).toContain('@acme/hello');
      expect(await readTree(project)).toEqual(before);
    });

    it('applies it to the new app with --yes when the registry still serves the recorded version', async () => {
      const rt = testRuntime({ trust: ['@acme'], fetch: fetchManifest });
      expect((await add(['shell', 'admin', '--yes', '--no-install'], rt)).code).toBe(0);
      expect(await read('apps/admin/src/hello.ts')).toContain('hello');
    });

    it('refuses, even with --yes, when the registry now serves another version (E401)', async () => {
      const before = await readTree(project);
      const rt = testRuntime({ trust: ['@acme'], fetch: serving('2.0.0') });
      const { code } = await add(['shell', 'admin', '--yes', '--no-install'], rt);
      expect(code).toBe(6);
      const err = rt.io.err.join('\n');
      expect(err).toContain('MFEFLOW_E401');
      expect(err).toContain('1.0.0');
      expect(err).toContain('2.0.0');
      expect(await readTree(project)).toEqual(before);
    });

    it('fetches the installed registry features together, not one after another', async () => {
      const file = path.join(project, 'mfeflow.json');
      const saved = parseProject(await fs.readFile(file, 'utf8'));
      saved.features['@acme/other'] = { version: '1.0.0' };
      delete saved.features['@acme/hello']?.integrity;
      await fs.writeFile(file, `${JSON.stringify(saved, null, 2)}\n`);
      let inFlight = 0;
      let peak = 0;
      const fetch: FetchLike = async (url) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        const name = url.endsWith('other.json') ? '@acme/other' : '@acme/hello';
        const files = [{ to: `src/${name.slice(6)}.ts`, target: 'shell', content: 'x' }];
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ ...manifest, name, files })),
        };
      };
      const rt = testRuntime({ trust: ['@acme'], fetch });
      expect((await add(['shell', 'admin', '--yes', '--no-install'], rt)).code).toBe(0);
      expect(peak).toBe(2);
      expect(await read('apps/admin/src/other.ts')).toBe('x');
    });

    it('asks a registry that can pin for the recorded version', async () => {
      const file = path.join(project, 'mfeflow.json');
      const saved = parseProject(await fs.readFile(file, 'utf8'));
      saved.registries = { '@acme': 'https://acme.dev/{name}/{version}.json' };
      await fs.writeFile(file, `${JSON.stringify(saved, null, 2)}\n`);
      const urls: string[] = [];
      const rt = testRuntime({ trust: ['@acme'], fetch: serving('1.0.0', urls) });
      expect((await add(['shell', 'admin', '--yes', '--no-install'], rt)).code).toBe(0);
      expect(urls).toEqual(['https://acme.dev/hello/1.0.0.json']);
    });
  });
});

describe('a project linked with --local', () => {
  const linkedDir = () => path.join(cwd, 'linked');
  const dependenciesOf = (app: string) =>
    fs.readFile(path.join(linkedDir(), 'apps', app, 'package.json'), 'utf8');

  beforeEach(async () => {
    const code = await main(
      ['init', 'linked', '--yes', '--no-install', '--local', REPO, '--cwd', cwd],
      testRuntime(),
    );
    expect(code).toBe(0);
  });

  it('records the checkout, relative to the project', async () => {
    const recorded = parseProject(
      await fs.readFile(path.join(linkedDir(), 'mfeflow.json'), 'utf8'),
    );
    const real = await fs.realpath(linkedDir());
    const checkout = await fs.realpath(REPO);
    expect(recorded.local).toBe(path.relative(real, checkout).split(path.sep).join('/'));
  });

  it('keeps linking for later adds that pass no flag', async () => {
    const code = await main(
      ['add', 'remote', 'checkout', '--no-install', '--cwd', linkedDir()],
      testRuntime(),
    );
    expect(code).toBe(0);
    expect(await dependenciesOf('checkout')).toContain('"@mfeflow/rsbuild": "link:');
    expect(await dependenciesOf('checkout')).not.toContain(`^${CLI_VERSION}`);
  });

  it('keeps linking for a feature added without the flag', async () => {
    const code = await main(
      ['add', 'git-hooks', '--no-install', '--cwd', linkedDir()],
      testRuntime(),
    );
    expect(code).toBe(0);
    expect(await dependenciesOf('shell')).not.toContain(`^${CLI_VERSION}`);
  });

  it('goes back to the published packages with --local none', async () => {
    const code = await main(
      ['add', 'remote', 'checkout', '--local', 'none', '--no-install', '--cwd', linkedDir()],
      testRuntime(),
    );
    expect(code).toBe(0);
    expect(await dependenciesOf('checkout')).toContain(`"@mfeflow/rsbuild": "^${CLI_VERSION}"`);
    const recorded = parseProject(
      await fs.readFile(path.join(linkedDir(), 'mfeflow.json'), 'utf8'),
    );
    expect(recorded).not.toHaveProperty('local');
  });

  it('does not link a project that was not created with --local, unless asked', async () => {
    expect(await add(['remote', 'checkout', '--no-install']).then((r) => r.code)).toBe(0);
    expect(await read('apps/checkout/package.json')).toContain(
      `"@mfeflow/rsbuild": "^${CLI_VERSION}"`,
    );
    expect(await load()).not.toHaveProperty('local');
  });
});

describe('inCatalogueOrder', () => {
  it('puts first-party features in catalogue order and the others last, as typed', () => {
    expect(inCatalogueOrder(['zeta', 'analytics-gtm', 'alpha', 'env-t3'])).toEqual([
      'env-t3',
      'analytics-gtm',
      'zeta',
      'alpha',
    ]);
  });
});

describe('mfeflow add @namespace/feature: trust and integrity', () => {
  const hello = (extra: object = {}) => ({
    name: '@acme/hello',
    version: '1.0.0',
    files: [{ to: 'src/hello.ts', target: 'shell', content: 'export const hello = 1;\n' }],
    ...extra,
  });
  const REMOTE = 'https://acme.dev/{name}.json';

  /** Serves `body` for the feature and `indexBody` (404 when absent) for the index. */
  const registry = (body: object, indexBody?: object, asked: string[] = []): FetchLike => {
    return (url) => {
      asked.push(url);
      const isIndex = url.endsWith('/index.json');
      const missing = isIndex && indexBody === undefined;
      return Promise.resolve({
        ok: !missing,
        status: missing ? 404 : 200,
        text: () => Promise.resolve(JSON.stringify(isIndex ? indexBody : body)),
      });
    };
  };

  async function setRegistries(registries: Record<string, string>): Promise<void> {
    const file = path.join(project, 'mfeflow.json');
    const saved = parseProject(await fs.readFile(file, 'utf8'));
    saved.registries = registries;
    await fs.writeFile(file, `${JSON.stringify(saved, null, 2)}\n`);
  }

  beforeEach(() => setRegistries({ '@acme': REMOTE }));

  it('records the sha256 of the feature.json next to the feature', async () => {
    const body = JSON.stringify(hello());
    const fetch: FetchLike = (url) =>
      Promise.resolve({
        ok: !url.endsWith('/index.json'),
        status: url.endsWith('/index.json') ? 404 : 200,
        text: () => Promise.resolve(body),
      });
    const { code } = await add(['@acme/hello', '--yes', '--no-install'], testRuntime({ fetch }));
    expect(code).toBe(0);
    const recorded = (await load()).features['@acme/hello'];
    expect(recorded).toEqual({ version: '1.0.0', integrity: integrityOf(body) });
    expect(recorded?.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('counts the explicit add of a public registry as consent to fetch the one feature', async () => {
    const asked: string[] = [];
    const rt = testRuntime({ fetch: registry(hello(), undefined, asked) });
    expect((await add(['@acme/hello', '--yes', '--no-install'], rt)).code).toBe(0);
    expect(asked).toEqual(['https://acme.dev/hello.json', 'https://acme.dev/index.json']);
  });

  it('refuses a loopback or private registry that is not trusted, without asking it', async () => {
    for (const template of ['http://127.0.0.1:4010/{name}.json', 'https://10.1.2.3/{name}.json']) {
      await setRegistries({ '@acme': template });
      const asked: string[] = [];
      const rt = testRuntime({ fetch: registry(hello(), undefined, asked) });
      const { code } = await add(['@acme/hello', '--yes', '--no-install'], rt);
      expect(code, template).toBe(6);
      expect(rt.io.err.join('\n')).toContain('MFEFLOW_E405');
      expect(asked).toEqual([]);
    }
  });

  it('fetches a loopback registry once it is trusted', async () => {
    const template = 'http://127.0.0.1:4010/{name}.json';
    await setRegistries({ '@acme': template });
    const rt = testRuntime({ fetch: registry(hello()) });
    await addTrusted(rt.configDir, { namespace: '@acme', template });
    expect((await add(['@acme/hello', '--yes', '--no-install'], rt)).code).toBe(0);
    const pinned = testRuntime({ fetch: registry(hello()), trust: [`@acme=${template}`] });
    expect((await add(['@acme/hello', '--yes', '--no-install'], pinned)).code).toBe(0);
  });

  it('does not let MFEFLOW_TRUST_REGISTRIES with only a namespace reach a private address', async () => {
    for (const template of [
      'https://169.254.169.254/{name}.json',
      'http://127.0.0.1:4010/{name}.json',
    ]) {
      await setRegistries({ '@acme': template });
      const asked: string[] = [];
      const rt = testRuntime({ fetch: registry(hello(), undefined, asked), trust: ['@acme'] });
      const { code } = await add(['@acme/hello', '--yes', '--no-install'], rt);
      expect(code, template).toBe(6);
      expect(rt.io.err.join('\n')).toContain('MFEFLOW_E405');
      expect(asked).toEqual([]);
    }
  });

  it('keeps a token from the cause out of --verbose output', async () => {
    const fetch: FetchLike = () =>
      Promise.reject(new Error('connect failed https://acme.dev/hello.json?token=hunter2'));
    const rt = testRuntime({ fetch });
    await add(['@acme/hello', '--yes', '--no-install', '--verbose'], rt);
    expect(rt.io.err.join('\n')).toContain('connect failed');
    expect(rt.io.err.join('\n')).not.toContain('hunter2');
  });

  it('is an error when the index lists another version than the feature.json, and writes nothing', async () => {
    const before = await readTree(project);
    const index = { items: [{ name: 'hello', version: '2.0.0', description: 'Hello' }] };
    const rt = testRuntime({ fetch: registry(hello(), index) });
    const { code } = await add(['@acme/hello', '--yes', '--no-install'], rt);
    expect(code).toBe(6);
    const err = rt.io.err.join('\n');
    expect(err).toContain('MFEFLOW_E402');
    expect(err).toContain('2.0.0');
    expect(await readTree(project)).toEqual(before);
  });

  it('shows what a feature adds to package.json as NEW PACKAGES', async () => {
    const withDependency = hello({
      dependencies: [{ name: 'left-pad', range: '^1.3.0', target: 'shell' }],
    });
    const rt = testRuntime({ fetch: registry(withDependency) });
    expect((await add(['@acme/hello', '--dry-run'], rt)).code).toBe(0);
    const out = rt.io.out.join('\n');
    expect(out).toContain('NEW PACKAGES from a third-party feature (1):');
    expect(out).toContain('left-pad@');
    expect(out).toContain('pnpm 10 and later blocks them');
  });

  describe('when the feature is installed and a new app is added', () => {
    const served = hello();
    beforeEach(async () => {
      const rt = testRuntime({ fetch: registry(served) });
      expect((await add(['@acme/hello', '--yes', '--no-install'], rt)).code).toBe(0);
    });

    it('goes ahead when the registry still serves the same bytes', async () => {
      const rt = testRuntime({ fetch: registry(served), trust: ['@acme'] });
      expect((await add(['shell', 'admin', '--yes', '--no-install'], rt)).code).toBe(0);
    });

    const changed = hello({ description: 'quietly changed' });

    it('says so and pins the hash when an installed feature has none recorded', async () => {
      const file = path.join(project, 'mfeflow.json');
      const saved = parseProject(await fs.readFile(file, 'utf8'));
      delete saved.features['@acme/hello']?.integrity;
      await fs.writeFile(file, `${JSON.stringify(saved, null, 2)}\n`);
      const rt = testRuntime({ fetch: registry(served), trust: ['@acme'] });
      expect((await add(['shell', 'admin', '--yes', '--no-install'], rt)).code).toBe(0);
      expect(rt.io.out.join('\n')).toContain('@acme/hello has no integrity hash');
      expect((await load()).features['@acme/hello']?.integrity).toBe(
        integrityOf(JSON.stringify(served)),
      );
    });

    it('stops with E406 when the registry now serves other content, and writes nothing', async () => {
      const before = await readTree(project);
      const rt = testRuntime({ fetch: registry(changed), trust: ['@acme'] });
      const { code } = await add(['shell', 'admin', '--yes', '--no-install'], rt);
      expect(code).toBe(6);
      const err = rt.io.err.join('\n');
      expect(err).toContain('MFEFLOW_E406');
      expect(err).toContain('--accept-changed-content');
      expect(await readTree(project)).toEqual(before);
    });

    it('takes the new content with --accept-changed-content and records its hash', async () => {
      const rt = testRuntime({ fetch: registry(changed), trust: ['@acme'] });
      const args = ['shell', 'admin', '--yes', '--no-install', '--accept-changed-content'];
      expect((await add(args, rt)).code).toBe(0);
      expect((await load()).features['@acme/hello']?.integrity).toBe(
        integrityOf(JSON.stringify(changed)),
      );
    });

    it('does not fetch a registry the user has not trusted, even a public one', async () => {
      const before = await readTree(project);
      const asked: string[] = [];
      const rt = testRuntime({ fetch: registry(served, undefined, asked) });
      const { code } = await add(['shell', 'admin', '--yes', '--no-install'], rt);
      expect(code).toBe(6);
      expect(rt.io.err.join('\n')).toContain('MFEFLOW_E405');
      expect(rt.io.err.join('\n')).toContain('mfeflow registry trust');
      expect(asked).toEqual([]);
      expect(await readTree(project)).toEqual(before);
    });
  });
});
