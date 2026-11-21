import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MfeflowError } from '@mfeflow/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, validateResult, type BuildResult } from '..';
import { removeDir, tempDir, testRuntime, type TestRuntime } from '../testing';
import { appContaining, defaultConcurrency, formatBuild, withStdoutOnStderr } from './build';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function project(...flags: string[]): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  await main(['init', 'app', '--yes', '--no-install', ...flags, '--cwd', cwd], testRuntime());
  return path.join(cwd, 'app');
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const names = (rt: TestRuntime, root: string): string[] =>
  rt.dev.procs.map((p) => path.basename(p.spec.cwd).replace(root, ''));

/** Starts `mfeflow build` and returns once `count` processes are running. */
async function start(root: string, count: number, ...argv: string[]) {
  const rt = testRuntime();
  const done = main(['build', ...argv, '--cwd', root], rt);
  await until(() => rt.dev.procs.length === count, `${String(count)} processes`);
  return { rt, done };
}

describe('mfeflow build at the project root', () => {
  it('builds the remotes first, in parallel, then the shell, each in its own folder', async () => {
    const root = await project();
    const { rt, done } = await start(root, 2, '--concurrency', '2');
    expect(names(rt, root)).toEqual(['catalog', 'cart']);
    for (const proc of rt.dev.procs) {
      expect(proc.spec.command).toBe(process.execPath);
      expect(path.basename(proc.spec.args[0] ?? '')).toBe('mfeflow.js');
      expect(proc.spec.args.slice(1)).toEqual(['build', '--dist', 'dist']);
    }
    rt.dev.procs[0]?.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rt.dev.procs).toHaveLength(2);
    rt.dev.procs[1]?.exit(0);
    await until(() => rt.dev.procs.length === 3, 'the shell');
    expect(names(rt, root)[2]).toBe('shell');
    rt.dev.procs[2]?.exit(0);
    expect(await done).toBe(0);
    const out = rt.io.out.join('\n');
    expect(out).toContain('3 built');
    expect(out).toMatch(/shell\s+shell\s+built/);
  });

  it('starts no more than --concurrency apps at once', async () => {
    const root = await project();
    const { rt, done } = await start(root, 1, '--concurrency', '1');
    expect(names(rt, root)).toEqual(['catalog']);
    rt.dev.procs[0]?.exit(0);
    await until(() => rt.dev.procs.length === 2, 'cart');
    expect(names(rt, root)).toEqual(['catalog', 'cart']);
    rt.dev.procs[1]?.exit(0);
    await until(() => rt.dev.procs.length === 3, 'shell');
    rt.dev.procs[2]?.exit(0);
    expect(await done).toBe(0);
  });

  it('defaults to at most four at once', () => {
    expect(defaultConcurrency()).toBeGreaterThanOrEqual(1);
    expect(defaultConcurrency()).toBeLessThanOrEqual(4);
  });

  it('stops scheduling after a failure, lets the running ones finish and exits 5', async () => {
    const root = await project();
    const { rt, done } = await start(root, 2, '--concurrency', '2');
    rt.dev.procs[0]?.exit(1);
    rt.dev.procs[1]?.exit(0);
    const code = await done;
    expect(code).toBe(5);
    expect(rt.dev.procs).toHaveLength(2);
    const out = rt.io.out.join('\n');
    expect(out).toMatch(/catalog\s+remote\s+failed/);
    expect(out).toMatch(/cart\s+remote\s+built/);
    expect(out).toMatch(/shell\s+shell\s+skipped/);
    expect(out).toContain('MFEFLOW_E310');
    expect(out).toContain('catalog exited with code 1');
  });

  it('does not start the next remote after a failure when running one at a time', async () => {
    const root = await project();
    const { rt, done } = await start(root, 1, '--concurrency', '1');
    rt.dev.procs[0]?.exit(2);
    expect(await done).toBe(5);
    expect(rt.dev.procs).toHaveLength(1);
    expect(rt.io.out.join('\n')).toMatch(/cart\s+remote\s+skipped/);
  });

  it('builds only the apps named by --only', async () => {
    const root = await project();
    const { rt, done } = await start(root, 1, '--only', 'shell');
    expect(names(rt, root)).toEqual(['shell']);
    rt.dev.procs[0]?.exit(0);
    expect(await done).toBe(0);
    expect(rt.io.out.join('\n')).not.toMatch(/catalog/);
  });

  it('refuses an app that is not in the project, with exit 2', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['build', '--only', 'nope', '--cwd', root], rt)).toBe(2);
    expect(rt.io.err.join('\n')).toContain('no such app');
    expect(rt.dev.procs).toHaveLength(0);
  });

  it.each(['0', '-1', '1.5', 'many'])('refuses --concurrency %s', async (value) => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['build', `--concurrency=${value}`, '--cwd', root], rt)).toBe(2);
    expect(rt.io.err.join('\n')).toContain('--concurrency');
  });

  it('prefixes each line with the app name and keeps partial lines together', async () => {
    const root = await project();
    const { rt, done } = await start(root, 1, '--concurrency', '1', '--only', 'catalog,cart');
    rt.dev.procs[0]?.print('hello ');
    rt.dev.procs[0]?.print('world\nsecond\n');
    rt.dev.procs[0]?.exit(0);
    await until(() => rt.dev.procs.length === 2, 'cart');
    rt.dev.procs[1]?.exit(0);
    await done;
    expect(rt.io.out).toContain('catalog | hello world');
    expect(rt.io.out).toContain('catalog | second');
  });

  it('reads the JS size of a built shell with the helper budget uses', async () => {
    const root = await project();
    const dist = path.join(root, 'apps/shell/dist');
    await fs.mkdir(path.join(dist, 'static'), { recursive: true });
    await fs.writeFile(path.join(dist, 'index.html'), '<script src="/static/a.js"></script>');
    await fs.writeFile(path.join(dist, 'static/a.js'), randomBytes(4096));
    const { rt, done } = await start(root, 1, '--only', 'shell');
    rt.dev.procs[0]?.exit(0);
    await done;
    expect(rt.io.out.join('\n')).toMatch(/shell\s+shell\s+built\s+\S+ s\s+4(\.\d)? KB/);
  });

  it('reports a folder that is not on disk and builds the rest', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/cart/package.json'));
    const { rt, done } = await start(root, 1, '--concurrency', '1');
    rt.dev.procs[0]?.exit(0);
    await until(() => rt.dev.procs.length === 2, 'shell');
    rt.dev.procs[1]?.exit(0);
    expect(await done).toBe(3);
    const out = rt.io.out.join('\n');
    expect(out).toMatch(/cart\s+remote\s+missing/);
    expect(out).toContain('MFEFLOW_E112');
  });

  it('looks for every bundler before it builds anything, and names the app and package', async () => {
    const root = await project();
    const rt = testRuntime();
    rt.bundler.checkFails.set(
      'cart',
      new MfeflowError('E308', '@rsbuild/core is not installed for cart'),
    );
    expect(await main(['build', '--cwd', root], rt)).toBe(5);
    expect(rt.bundler.checked.toSorted()).toEqual(['cart', 'catalog', 'shell']);
    expect(rt.dev.procs).toHaveLength(0);
    const out = rt.io.out.join('\n');
    expect(out).toContain('MFEFLOW_E308');
    expect(out).toContain('@rsbuild/core is not installed for cart');
    expect(out).toMatch(/cart\s+remote\s+failed/);
    expect(out).toMatch(/catalog\s+remote\s+skipped/);
  });

  it('rethrows a bundler lookup that is not a mfeflow error', async () => {
    const root = await project();
    const rt = testRuntime();
    rt.bundler.checkFails.set('cart', new Error('disk on fire'));
    expect(await main(['build', '--cwd', root], rt)).toBe(1);
    expect(rt.io.err.join('\n')).toContain('disk on fire');
  });

  it('reports an app that could not be started', async () => {
    const root = await project();
    const rt = testRuntime();
    rt.dev.spawn = () => {
      throw new Error('spawn ENOENT');
    };
    expect(await main(['build', '--only', 'shell', '--cwd', root], rt)).toBe(5);
    const out = rt.io.out.join('\n');
    expect(out).toMatch(/shell\s+\| could not start: spawn ENOENT/);
    expect(out).toContain('shell could not be started');
  });

  it('stops the running builds on Ctrl+C and exits 130', async () => {
    const root = await project();
    const { rt, done } = await start(root, 2, '--concurrency', '2');
    rt.dev.interrupt();
    expect(await done).toBe(130);
    expect(rt.dev.procs.every((p) => p.stopped)).toBe(true);
    expect(rt.dev.procs).toHaveLength(2);
    const out = rt.io.out.join('\n');
    expect(out).toMatch(/catalog\s+remote\s+stopped/);
    expect(out).toMatch(/shell\s+shell\s+skipped/);
  });

  it('prints the plan and builds nothing with --dry-run', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['build', '--dry-run', '--cwd', root], rt)).toBe(0);
    expect(rt.dev.procs).toHaveLength(0);
    expect(rt.io.out).toEqual(['remotes: catalog, cart', 'shell: shell']);
  });

  it('prints one valid JSON document on stdout and the build lines on stderr', async () => {
    const root = await project();
    const rt = testRuntime();
    const done = main(['build', '--json', '--only', 'catalog', '--cwd', root], rt);
    await until(() => rt.dev.procs.length === 1, 'catalog');
    rt.dev.procs[0]?.print('compiled\n');
    rt.dev.procs[0]?.exit(0);
    expect(await done).toBe(0);
    expect(rt.io.out).toHaveLength(1);
    const result = JSON.parse(rt.io.out[0] ?? '') as BuildResult;
    expect(validateResult(result)).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      command: 'build',
      interrupted: false,
      apps: [{ name: 'catalog', kind: 'remote', status: 'built', kb: null }],
    });
    expect(rt.io.err).toContain('catalog | compiled');
  });

  it('puts a failure in the JSON document with exit 5', async () => {
    const root = await project();
    const rt = testRuntime();
    const done = main(['build', '--json', '--only', 'catalog', '--cwd', root], rt);
    await until(() => rt.dev.procs.length === 1, 'catalog');
    rt.dev.procs[0]?.exit(1);
    expect(await done).toBe(5);
    const result = JSON.parse(rt.io.out[0] ?? '') as BuildResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toMatchObject({ code: 'MFEFLOW_E310', app: 'catalog' });
  });

  it('says so and exits 0 in a project with no apps', async () => {
    const cwd = await tempDir();
    dirs.push(cwd);
    await main(
      ['init', 'tools', '--kind', 'tooling', '--yes', '--no-install', '--cwd', cwd],
      testRuntime(),
    );
    const rt = testRuntime();
    expect(await main(['build', '--cwd', path.join(cwd, 'tools')], rt)).toBe(0);
    expect(rt.io.out.join('\n')).toContain('nothing to build');
  });

  it('refuses a flag it does not know', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['build', '--nope', '--cwd', root], rt)).toBe(2);
  });
});

describe('mfeflow build inside an app folder', () => {
  it('builds that app in this process through the bundler adapter, with no child', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['build', '--cwd', path.join(root, 'apps/catalog')], rt)).toBe(0);
    expect(rt.dev.procs).toHaveLength(0);
    expect(rt.bundler.built).toEqual([
      { name: 'catalog', dir: path.join(root, 'apps/catalog'), bundler: 'rsbuild' },
    ]);
    expect(rt.io.out[0]).toMatch(/^mfeflow: built catalog in \d+\.\d s$/);
  });

  it('works from a folder inside the app', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['build', '--cwd', path.join(root, 'apps/shell/src')], rt)).toBe(0);
    expect(rt.bundler.built.map((a) => a.name)).toEqual(['shell']);
  });

  it('prints one JSON document and keeps the bundler output off stdout', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['build', '--json', '--cwd', path.join(root, 'apps/catalog')], rt)).toBe(0);
    const result = JSON.parse(rt.io.out.join('')) as BuildResult;
    expect(validateResult(result)).toEqual([]);
    expect(result.apps.map((a) => a.name)).toEqual(['catalog']);
  });

  it('reports a failed build as MFEFLOW_E310 with exit 5', async () => {
    const root = await project();
    const rt = testRuntime();
    rt.bundler.buildFails = new Error('Rspack build failed.');
    expect(await main(['build', '--cwd', path.join(root, 'apps/catalog')], rt)).toBe(5);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E310');
  });

  it('keeps the code of a mfeflow error from the bundler', async () => {
    const root = await project();
    const rt = testRuntime();
    rt.bundler.buildFails = new MfeflowError('E309', 'catalog: nothing');
    expect(await main(['build', '--cwd', path.join(root, 'apps/catalog')], rt)).toBe(5);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E309');
  });

  it('refuses --only, which is a root option', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(
      await main(['build', '--only', 'shell', '--cwd', path.join(root, 'apps/catalog')], rt),
    ).toBe(2);
    expect(rt.bundler.built).toEqual([]);
  });

  it('refuses an app whose folder is empty', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/catalog/package.json'));
    const rt = testRuntime();
    expect(await main(['build', '--cwd', path.join(root, 'apps/catalog')], rt)).toBe(3);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E112');
  });

  it('uses the bundler mfeflow.json names', async () => {
    const root = await project('--bundler', 'vite');
    const rt = testRuntime();
    await main(['build', '--cwd', path.join(root, 'apps/catalog')], rt);
    expect(rt.bundler.built.map((a) => a.bundler)).toEqual(['vite']);
  });
});

describe('appContaining', () => {
  const app = (name: string, dir: string) => ({ name, dir }) as never;
  const apps = [app('a', path.join('/p', 'apps', 'a')), app('ab', path.join('/p', 'apps', 'ab'))];

  it('finds the app that holds the folder, and not a sibling that shares a prefix', () => {
    expect(appContaining(apps, path.join('/p', 'apps', 'a'))?.name).toBe('a');
    expect(appContaining(apps, path.join('/p', 'apps', 'a', 'src'))?.name).toBe('a');
    expect(appContaining(apps, path.join('/p', 'apps', 'ab', 'src'))?.name).toBe('ab');
  });

  it('is undefined at the project root and outside it', () => {
    expect(appContaining(apps, path.join('/p'))).toBeUndefined();
    expect(appContaining(apps, path.join('/elsewhere'))).toBeUndefined();
  });

  it('takes the deepest app when they nest', () => {
    const nested = [app('outer', path.join('/p', 'o')), app('inner', path.join('/p', 'o', 'i'))];
    expect(appContaining(nested, path.join('/p', 'o', 'i', 'src'))?.name).toBe('inner');
  });
});

const writer = (): unknown => Reflect.get(process.stdout, 'write');

describe('withStdoutOnStderr', () => {
  it('sends stdout writes to stderr while it runs, and puts stdout back after', async () => {
    const original = writer();
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    const value = await withStdoutOnStderr(() => {
      process.stdout.write('to stderr\n');
      return Promise.resolve(7);
    });
    expect(value).toBe(7);
    expect(written).toEqual(['to stderr\n']);
    expect(writer()).toBe(original);
    spy.mockRestore();
  });

  it('puts stdout back when the work fails', async () => {
    const original = writer();
    await expect(withStdoutOnStderr(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(writer()).toBe(original);
  });
});

describe('formatBuild', () => {
  it('lists each app with its status, time and size', () => {
    const text = formatBuild({
      ok: true,
      command: 'build',
      root: '/p',
      concurrency: 2,
      interrupted: false,
      findings: [],
      apps: [
        { name: 'shell', kind: 'shell', status: 'built', ms: 1234, kb: 40.5 },
        { name: 'cart', kind: 'remote', status: 'skipped', ms: null, kb: null },
      ],
    });
    expect(text).toMatch(/shell\s+shell\s+built\s+1\.2 s\s+40\.5 KB/);
    expect(text).toMatch(/cart\s+remote\s+skipped\s+-\s+-/);
  });
});
