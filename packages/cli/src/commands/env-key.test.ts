import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '@mfeflow/core';
import { main, validateResult, type AddResult } from '..';
import { readTree, removeDir, tempDir, testRuntime } from '../testing';
import { readPackageJson } from '../version';

let cwd = '';
let project = '';

beforeEach(async () => {
  cwd = await tempDir();
  project = path.join(cwd, 'app');
  expect(await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime())).toBe(0);
});
afterEach(async () => {
  await removeDir(cwd);
});

const envKey = (args: string[], rt = testRuntime()) =>
  main(['add', 'env-key', ...args, '--cwd', project], rt).then((code) => ({ code, rt }));
const read = (file: string) => fs.readFile(path.join(project, file), 'utf8');
const SERVER = ['--scope', 'server', '--schema', 'z.url()'];

describe('mfeflow add env-key --scope server', () => {
  it('adds the key to every app, its .env.example and turbo.json, but not to the root', async () => {
    const { code, rt } = await envKey(['API_ORIGIN', ...SERVER, '--value', 'https://api.test']);
    expect(code).toBe(0);
    for (const app of ['shell', 'catalog', 'cart']) {
      expect(await read(`apps/${app}/env.ts`)).toContain('API_ORIGIN: z.url(),');
      expect(await read(`apps/${app}/.env.example`)).toContain('API_ORIGIN=https://api.test');
    }
    expect(await read('env.ts')).not.toContain('API_ORIGIN:');
    expect(JSON.parse(await read('turbo.json'))).toMatchObject({ globalEnv: ['API_ORIGIN'] });
    expect(rt.io.out.join('\n')).toContain('Added API_ORIGIN to the server schema');
    expect(rt.system.installs).toEqual([]);
  });

  it('records the key under each env file it edited, so upgrade can ask about it later', async () => {
    await envKey(['API_ORIGIN', ...SERVER, '--value', 'https://api.test']);
    const recorded = parseProject(await read('mfeflow.json')).envKeys ?? {};
    expect(Object.keys(recorded).toSorted()).toEqual([
      'apps/cart/.env.example',
      'apps/cart/env.ts',
      'apps/catalog/.env.example',
      'apps/catalog/env.ts',
      'apps/shell/.env.example',
      'apps/shell/env.ts',
    ]);
    expect(Object.values(recorded).every((keys) => keys.join() === 'API_ORIGIN')).toBe(true);
  });

  it('records nothing on a dry run, and nothing for a key that was already there', async () => {
    await envKey(['A_KEY', ...SERVER, '--dry-run']);
    expect(parseProject(await read('mfeflow.json')).envKeys).toBeUndefined();
    await envKey(['A_KEY', ...SERVER]);
    const once = await read('mfeflow.json');
    await envKey(['A_KEY', ...SERVER]);
    expect(await read('mfeflow.json')).toBe(once);
  });

  it('keeps mfeflow.json free of drift, and the feature list as it was', async () => {
    await envKey(['API_ORIGIN', ...SERVER]);
    const rt = testRuntime();
    expect(await main(['doctor', '--json', '--cwd', project], rt)).toBe(0);
    expect(JSON.parse(rt.io.out.join(''))).toMatchObject({
      summary: { errors: 0, warnings: 0 },
    });
    expect(Object.keys(parseProject(await read('mfeflow.json')).features)).toContain('env-t3');
  });

  it('leaves mfeflow.json alone when the key is already there, with an older or no cli', async () => {
    await envKey(['API_ORIGIN', ...SERVER]);
    const { cli: _cli, ...unstamped } = parseProject(await read('mfeflow.json'));
    for (const text of [
      serializeProject(unstamped),
      serializeProject({ ...unstamped, cli: '0.0.1' }),
    ]) {
      await fs.writeFile(path.join(project, 'mfeflow.json'), text);
      const { rt } = await envKey(['API_ORIGIN', ...SERVER]);
      expect(await read('mfeflow.json')).toBe(text);
      expect(rt.io.out.join('\n')).toContain('nothing to do');
    }
  });

  it('raises cli when it writes, and never lowers it', async () => {
    const stored = parseProject(await read('mfeflow.json'));
    const write = (cli: string) =>
      fs.writeFile(path.join(project, 'mfeflow.json'), serializeProject({ ...stored, cli }));
    await write('0.0.1');
    await envKey(['FIRST_KEY', ...SERVER]);
    expect(parseProject(await read('mfeflow.json')).cli).toBe(readPackageJson().version);
    await write('99.0.0');
    await envKey(['SECOND_KEY', ...SERVER]);
    expect(parseProject(await read('mfeflow.json')).cli).toBe('99.0.0');
  });

  it('is idempotent: a second run says so and changes nothing', async () => {
    await envKey(['API_ORIGIN', ...SERVER]);
    const before = await readTree(project);
    const { code, rt } = await envKey(['API_ORIGIN', ...SERVER]);
    expect(code).toBe(0);
    expect(await readTree(project)).toEqual(before);
    expect(rt.io.out.join('\n')).toContain('API_ORIGIN is already in the server schema');
  });

  it('limits the key to one app, or to the root tooling', async () => {
    await envKey(['CART_ONLY', ...SERVER, '--app', 'cart']);
    expect(await read('apps/cart/env.ts')).toContain('CART_ONLY');
    expect(await read('apps/shell/env.ts')).not.toContain('CART_ONLY:');
    await envKey(['ROOT_ONLY', ...SERVER, '--group', 'root']);
    expect(await read('env.ts')).toContain('ROOT_ONLY');
    expect(await read('.env.example')).toContain('ROOT_ONLY=');
    expect(await read('apps/cart/env.ts')).not.toContain('ROOT_ONLY:');
  });

  it('refuses an app that does not exist, naming the choices', async () => {
    const { code, rt } = await envKey(['X', ...SERVER, '--app', 'nope']);
    expect(code).toBe(2);
    expect(rt.io.err.join('\n')).toContain('--app nope is not an app (shell, catalog, cart)');
  });

  it('--app names exactly one app even when the app is called like a group', async () => {
    expect(
      await main(['add', 'shell', 'admin', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    await envKey(['ONLY_SHELL', ...SERVER, '--app', 'shell']);
    expect(await read('apps/shell/env.ts')).toContain('ONLY_SHELL:');
    expect(await read('apps/admin/env.ts')).not.toContain('ONLY_SHELL:');
    expect(await read('apps/cart/env.ts')).not.toContain('ONLY_SHELL:');
    await envKey(['ONLY_ADMIN', ...SERVER, '--app', 'admin']);
    expect(await read('apps/admin/env.ts')).toContain('ONLY_ADMIN:');
    expect(await read('apps/shell/env.ts')).not.toContain('ONLY_ADMIN:');
  });

  it('--app does not accept root, and --group takes root, shell or remotes only', async () => {
    const root = await envKey(['X', ...SERVER, '--app', 'root']);
    expect(root.code).toBe(2);
    expect(root.rt.io.err.join('\n')).toContain('--app root is not an app');
    const bad = await envKey(['X', ...SERVER, '--group', 'cart']);
    expect(bad.code).toBe(2);
    expect(bad.rt.io.err.join('\n')).toContain('--group must be root, shell or remotes');
    const both = await envKey(['X', ...SERVER, '--app', 'cart', '--group', 'remotes']);
    expect(both.code).toBe(2);
    expect(both.rt.io.err.join('\n')).toContain('--app and --group cannot be used together');
  });

  it('--group remotes reaches every remote and no shell', async () => {
    await envKey(['REMOTE_ONLY', ...SERVER, '--group', 'remotes']);
    expect(await read('apps/cart/env.ts')).toContain('REMOTE_ONLY:');
    expect(await read('apps/catalog/env.ts')).toContain('REMOTE_ONLY:');
    expect(await read('apps/shell/env.ts')).not.toContain('REMOTE_ONLY:');
  });
});

describe('mfeflow add env-key --scope runtime', () => {
  const RUNTIME = ['--scope', 'runtime', '--schema', 'z.string().min(1)'];

  it('adds the key to the shell schema and to every runtime-config file', async () => {
    const { code } = await envKey(['GTM_ID', ...RUNTIME, '--value', 'GTM-ABC']);
    expect(code).toBe(0);
    expect(await read('apps/shell/src/config/schema.ts')).toContain('GTM_ID: z.string().min(1),');
    for (const name of ['.dev', '.staging', '.prod']) {
      const file = `apps/shell/public/config/runtime-config${name}.json`;
      expect(JSON.parse(await read(file)), file).toMatchObject({ GTM_ID: 'GTM-ABC' });
    }
    expect(await read('apps/cart/env.ts')).not.toContain('GTM_ID:');
    expect(JSON.parse(await read('turbo.json'))).not.toHaveProperty('globalEnv');
  });

  it('writes to exactly the shell named by --app when there are two', async () => {
    expect(
      await main(['add', 'shell', 'admin', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    const { code } = await envKey(['GTM_ID', ...RUNTIME, '--app', 'shell']);
    expect(code).toBe(0);
    expect(await read('apps/shell/src/config/schema.ts')).toContain('GTM_ID:');
    expect(await read('apps/admin/src/config/schema.ts')).not.toContain('GTM_ID:');
  });

  it('only lives in a shell', async () => {
    const { code, rt } = await envKey(['GTM_ID', ...RUNTIME, '--app', 'cart']);
    expect(code).toBe(2);
    expect(rt.io.err.join('\n')).toContain('--app cart is not a shell');
  });

  it('leaves a runtime-config file alone that already has the key', async () => {
    await fs.writeFile(
      path.join(project, 'apps/shell/public/config/runtime-config.prod.json'),
      '{\n  "environment": "prod",\n  "GTM_ID": "GTM-PROD"\n}\n',
    );
    await envKey(['GTM_ID', ...RUNTIME, '--value', 'GTM-DEV']);
    expect(await read('apps/shell/public/config/runtime-config.prod.json')).toContain('GTM-PROD');
    expect(await read('apps/shell/public/config/runtime-config.dev.json')).toContain('GTM-DEV');
  });
});

describe('mfeflow add env-key, when it cannot', () => {
  it.each([
    [['--scope', 'server'], '--schema is required'],
    [['--schema', 'z.url()'], '--scope must be server or runtime'],
    [['--scope', 'cloud', '--schema', 'z.url()'], '--scope must be server or runtime'],
  ])('rejects %j with a usage error', async (args, message) => {
    const { code, rt } = await envKey(['API_ORIGIN', ...args]);
    expect(code).toBe(2);
    expect(rt.io.err.join('\n')).toContain(message);
  });

  it('needs a key that is a plain name', async () => {
    for (const key of [[], ['has space'], ['9LIVES']]) {
      const code = await main(
        ['add', 'env-key', ...key, ...SERVER, '--cwd', project],
        testRuntime(),
      );
      expect(code).toBe(2);
    }
  });

  it('writes nothing for schema text that is not code (E208)', async () => {
    const before = await readTree(project);
    const { code, rt } = await envKey(['API_ORIGIN', '--scope', 'server', '--schema', 'z.url(']);
    expect(code).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E208');
    expect(await readTree(project)).toEqual(before);
  });

  it('says so when there is no app to put the key in, instead of "already present"', async () => {
    const file = path.join(project, 'mfeflow.json');
    const doc = JSON.parse(await fs.readFile(file, 'utf8')) as { apps: Record<string, unknown> };
    delete doc.apps.cart;
    delete doc.apps.catalog;
    await fs.writeFile(file, JSON.stringify(doc, null, 2));
    const before = await readTree(project);
    const { code, rt } = await envKey(['X', ...SERVER, '--group', 'remotes']);
    expect(code).toBe(2);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E107');
    expect(rt.io.err.join('\n')).toContain('the project has no remotes to add a key to');
    expect(await readTree(project)).toEqual(before);
  });

  it('asks for env-t3 first when the project does not have it', async () => {
    const bare = path.join(cwd, 'bare');
    await main(
      ['init', 'bare', '--yes', '--no-install', '--features=lint-oxlint', '--cwd', cwd],
      testRuntime(),
    );
    const rt = testRuntime();
    expect(await main(['add', 'env-key', 'A', ...SERVER, '--cwd', bare], rt)).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E206');
    expect(rt.io.err.join('\n')).toContain('mfeflow add env-t3');
  });
});

describe('mfeflow add env-key --dry-run and --json', () => {
  it('prints the diff and writes nothing', async () => {
    const before = await readTree(project);
    const { code, rt } = await envKey(['API_ORIGIN', ...SERVER, '--dry-run']);
    expect(code).toBe(0);
    expect(rt.io.out.join('\n')).toContain('+    API_ORIGIN: z.url(),');
    expect(rt.io.out.join('\n')).toContain('Dry run: nothing was written.');
    expect(await readTree(project)).toEqual(before);
  });

  it('reports a schema-valid result of kind env-key', async () => {
    const { rt } = await envKey(['API_ORIGIN', ...SERVER, '--json']);
    const value: unknown = JSON.parse(rt.io.out.join(''));
    expect(validateResult(value)).toEqual([]);
    expect(value).toMatchObject({ kind: 'env-key', added: ['API_ORIGIN'], skipped: [] });
    expect((value as AddResult).written).toContain('apps/shell/env.ts');
    const again = await envKey(['API_ORIGIN', ...SERVER, '--json']);
    expect(JSON.parse(again.rt.io.out.join(''))).toMatchObject({
      added: [],
      skipped: ['API_ORIGIN'],
    });
  });
});
