import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, validateResult, type DevResult } from '..';
import { fakeIo, removeDir, tempDir, testRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function project(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
  return path.join(cwd, 'app');
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Starts `mfeflow dev` and returns once `count` processes are up. */
async function start(root: string, count: number, ...argv: string[]) {
  const rt = testRuntime();
  const done = main(['dev', ...argv, '--cwd', root], rt);
  await until(() => rt.dev.procs.length === count, `${String(count)} processes`);
  return { rt, done };
}

const registryOf = async (
  root: string,
): Promise<{ remotes: { name: string; entry: string; version: string }[] }> =>
  JSON.parse(await fs.readFile(path.join(root, '.mfeflow/dev-registry.json'), 'utf8')) as never;

describe('mfeflow dev', () => {
  it('starts the shell and every remote in its folder, with the registry file in the environment', async () => {
    const root = await project();
    const { rt, done } = await start(root, 3);
    expect(rt.dev.procs.map((p) => path.relative(root, p.spec.cwd))).toEqual([
      path.join('apps', 'shell'),
      path.join('apps', 'catalog'),
      path.join('apps', 'cart'),
    ]);
    for (const proc of rt.dev.procs) {
      expect(proc.spec.command).toBe('pnpm');
      expect(proc.spec.args).toEqual(['run', 'dev']);
      expect(proc.spec.env.MFEFLOW_DEV_REGISTRY).toBe(
        path.join(root, '.mfeflow/dev-registry.json'),
      );
    }
    expect((await registryOf(root)).remotes).toEqual([
      { name: 'cart', entry: 'http://localhost:4312/mf-manifest.json', version: 'dev' },
      { name: 'catalog', entry: 'http://localhost:4311/mf-manifest.json', version: 'dev' },
    ]);
    expect(rt.dev.watched[0]?.map((p) => path.relative(root, p))).toEqual([
      'mfeflow.json',
      path.join('registry', 'envs', 'dev'),
    ]);
    rt.dev.interrupt();
    expect(await done).toBe(130);
    expect(rt.dev.procs.every((p) => p.stopped)).toBe(true);
  });

  it('prefixes each line with its app, joins split chunks and drops blank lines', async () => {
    const root = await project();
    const { rt, done } = await start(root, 3);
    const [shell, catalog] = rt.dev.procs;
    shell?.print('ready in 1.2 s\n\n');
    catalog?.print('compil');
    catalog?.print('ed ok\r\nsecond');
    catalog?.print(' line\n');
    rt.dev.interrupt();
    await done;
    expect(rt.io.out).toContain('shell   | ready in 1.2 s');
    expect(rt.io.out).toContain('catalog | compiled ok');
    expect(rt.io.out).toContain('catalog | second line');
    expect(rt.io.out.filter((l) => l.endsWith('| '))).toEqual([]);
  });

  it('colours the prefix when the terminal does, unless NO_COLOR is set', async () => {
    const root = await project();
    const colour = testRuntime();
    colour.io = fakeIo({ interactive: true });
    const run = main(['dev', '--cwd', root], colour);
    await until(() => colour.dev.procs.length === 3, 'processes');
    colour.dev.procs[0]?.print('hi\n');
    expect(colour.dev.procs[0]?.spec.env.FORCE_COLOR).toBe('1');
    colour.dev.interrupt();
    await run;
    expect(colour.io.out.some((l) => l.includes('\u001B[36mshell'))).toBe(true);

    const plain = testRuntime();
    plain.io = fakeIo({ interactive: true, env: { NO_COLOR: '1' } });
    const second = main(['dev', '--cwd', root], plain);
    await until(() => plain.dev.procs.length === 3, 'processes');
    plain.dev.procs[0]?.print('hi\n');
    plain.dev.interrupt();
    await second;
    expect(plain.io.out.some((l) => l.includes('\u001B'))).toBe(false);
  });

  it('runs only the apps --only names, and still lists every remote for the shell', async () => {
    const root = await project();
    const { rt, done } = await start(root, 2, '--only', 'shell,catalog');
    expect(rt.dev.procs.map((p) => path.basename(p.spec.cwd))).toEqual(['shell', 'catalog']);
    expect((await registryOf(root)).remotes.map((r) => r.name)).toEqual(['cart', 'catalog']);
    rt.dev.interrupt();
    await done;
  });

  it('refuses an unknown app in --only, an unknown flag and a project with nothing to run', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['dev', '--only', 'checkout', '--cwd', root], rt)).toBe(2);
    expect(rt.io.err.join('\n')).toContain(
      '--only checkout: no such app (apps: shell, catalog, cart)',
    );
    expect(await main(['dev', '--onlyy', 'x', '--cwd', root], testRuntime())).toBe(2);
    await fs.rm(path.join(root, 'apps'), { recursive: true });
    const none = testRuntime();
    expect(await main(['dev', '--cwd', root], none)).toBe(2);
    expect(none.io.err.join('\n')).toContain('nothing to run');
    expect(none.dev.procs).toEqual([]);
  });

  describe('--remote', () => {
    it('points a remote at your server, does not start it, and accepts an origin or a manifest URL', async () => {
      const root = await project();
      const { rt, done } = await start(
        root,
        1,
        '--remote',
        'cart=http://localhost:3001',
        '--remote',
        'catalog=http://127.0.0.1:3002/x/mf-manifest.json',
      );
      expect(rt.dev.procs.map((p) => path.basename(p.spec.cwd))).toEqual(['shell']);
      expect((await registryOf(root)).remotes).toEqual([
        { name: 'cart', entry: 'http://localhost:3001/mf-manifest.json', version: 'override' },
        { name: 'catalog', entry: 'http://127.0.0.1:3002/x/mf-manifest.json', version: 'override' },
      ]);
      rt.dev.interrupt();
      await done;
    });

    it('refuses other hosts unless --allow-origin names them', async () => {
      const root = await project();
      const rt = testRuntime();
      expect(
        await main(['dev', '--remote', 'cart=https://dev.example.com', '--cwd', root], rt),
      ).toBe(2);
      expect(rt.io.err.join('\n')).toContain('pass --allow-origin https://dev.example.com');
      expect(rt.dev.procs).toEqual([]);
      const { rt: ok, done } = await start(
        root,
        2,
        '--remote',
        'cart=https://dev.example.com',
        '--allow-origin',
        'https://dev.example.com',
      );
      expect((await registryOf(root)).remotes.find((r) => r.name === 'cart')?.entry).toBe(
        'https://dev.example.com/mf-manifest.json',
      );
      ok.dev.interrupt();
      await done;
    });

    it('is not fooled by a lookalike host', async () => {
      const root = await project();
      for (const url of [
        'http://localhost.evil.test',
        'http://evil.test/localhost',
        'http://user@evil.test',
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- one at a time
        expect(await main(['dev', '--remote', `cart=${url}`, '--cwd', root], testRuntime())).toBe(
          2,
        );
      }
    });

    it('refuses a malformed flag, an unknown remote, a shell, a bad URL and a bad origin', async () => {
      const root = await project();
      const bad = [
        ['--remote', 'cart'],
        ['--remote', 'checkout=http://localhost:1'],
        ['--remote', 'shell=http://localhost:1'],
        ['--remote', 'cart=not a url'],
        ['--remote', 'cart=ftp://localhost/x'],
        ['--remote', 'cart=https://a.test', '--allow-origin', 'nope'],
      ];
      for (const argv of bad) {
        const rt = testRuntime();
        // oxlint-disable-next-line no-await-in-loop -- one at a time
        expect(await main(['dev', ...argv, '--cwd', root], rt), argv.join(' ')).toBe(2);
        expect(rt.dev.procs).toEqual([]);
      }
    });
  });

  it('starts nothing and says which ports are taken', async () => {
    const root = await project();
    const rt = testRuntime();
    rt.dev.busy.add(4300).add(4312);
    expect(await main(['dev', '--cwd', root], rt)).toBe(5);
    const text = rt.io.err.join('\n');
    expect(text).toContain('MFEFLOW_E306');
    expect(text).toContain('4300 is in use (shell); 4312 is in use (cart)');
    expect(rt.dev.procs).toEqual([]);
  });

  describe('when the project changes', () => {
    it('starts a remote that was added and rewrites the registry, without a restart', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      expect(
        await main(['add', 'remote', 'checkout', '--no-install', '--cwd', root], testRuntime()),
      ).toBe(0);
      rt.dev.change();
      await until(() => rt.dev.procs.length === 4, 'checkout');
      expect(path.basename(rt.dev.procs[3]?.spec.cwd ?? '')).toBe('checkout');
      expect((await registryOf(root)).remotes.map((r) => r.name)).toEqual([
        'cart',
        'catalog',
        'checkout',
      ]);
      expect(rt.io.out.join('\n')).toContain('mfeflow: starting checkout on 4313');
      expect(rt.io.out.join('\n')).toContain('dev registry updated (cart, catalog, checkout)');
      rt.dev.interrupt();
      await done;
    });

    it('does not start the same app twice, or an app outside --only', async () => {
      const root = await project();
      const { rt, done } = await start(root, 1, '--only', 'shell');
      expect(
        await main(['add', 'remote', 'checkout', '--no-install', '--cwd', root], testRuntime()),
      ).toBe(0);
      rt.dev.change();
      rt.dev.change();
      await until(
        () => rt.io.out.some((l) => l.includes('dev registry updated')),
        'registry update',
      );
      expect(rt.dev.procs).toHaveLength(1);
      rt.dev.interrupt();
      await done;
    });

    it('stops an app that left mfeflow.json', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      const file = path.join(root, 'mfeflow.json');
      const doc = JSON.parse(await fs.readFile(file, 'utf8')) as { apps: Record<string, unknown> };
      delete doc.apps.cart;
      await fs.writeFile(file, JSON.stringify(doc));
      rt.dev.change();
      await until(() => rt.dev.procs[2]?.stopped === true, 'cart to stop');
      expect((await registryOf(root)).remotes.map((r) => r.name)).toEqual(['catalog']);
      rt.dev.interrupt();
      await done;
    });

    it('keeps what runs when mfeflow.json is broken mid-edit', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      await fs.writeFile(path.join(root, 'mfeflow.json'), '{ "version": ');
      rt.dev.change();
      await until(() => rt.io.out.some((l) => l.includes('keeping what is running')), 'message');
      expect(rt.dev.procs.some((p) => p.stopped)).toBe(false);
      rt.dev.interrupt();
      await done;
    });

    it('skips a new remote whose port is taken and says so', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      await main(['add', 'remote', 'checkout', '--no-install', '--cwd', root], testRuntime());
      rt.dev.busy.add(4313);
      rt.dev.change();
      await until(
        () => rt.io.out.some((l) => l.includes('not starting checkout: port 4313 is in use')),
        'message',
      );
      expect(rt.dev.procs).toHaveLength(3);
      rt.dev.interrupt();
      await done;
    });

    it('does not rewrite the registry file when nothing in it changed', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      const file = path.join(root, '.mfeflow/dev-registry.json');
      const before = (await fs.stat(file)).mtimeMs;
      rt.dev.change();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect((await fs.stat(file)).mtimeMs).toBe(before);
      rt.dev.interrupt();
      await done;
    });
  });

  describe('when a process ends', () => {
    it('reports a crash and keeps the others; exits 1 once all are gone', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      rt.dev.procs[1]?.exit(1);
      expect(rt.io.out).toContain('catalog | exited with code 1');
      rt.dev.procs[0]?.exit(0);
      rt.dev.procs[2]?.exit(0);
      expect(await done).toBe(1);
    });

    it('exits 0 when every app stopped by itself cleanly', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      for (const proc of rt.dev.procs) proc.exit(0);
      expect(await done).toBe(0);
      expect(rt.io.out).toContain('cart    | stopped');
    });

    it('a second Ctrl+C does not stop twice', async () => {
      const root = await project();
      const { rt, done } = await start(root, 3);
      rt.dev.interrupt();
      rt.dev.interrupt();
      expect(await done).toBe(130);
    });
  });

  it('--dry-run starts nothing and writes no registry', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['dev', '--dry-run', '--cwd', root], rt)).toBe(0);
    expect(rt.dev.procs).toEqual([]);
    await expect(fs.access(path.join(root, '.mfeflow'))).rejects.toThrow();
    const text = rt.io.out.join('\n');
    expect(text).toContain('shell: pnpm run dev in apps/shell (port 4300)');
    expect(text).toContain('cart -> http://localhost:4312/mf-manifest.json');
  });

  it("--json prints one result and sends the apps' output to stderr", async () => {
    const root = await project();
    const { rt, done } = await start(root, 2, '--json', '--remote', 'cart=http://localhost:3001');
    rt.dev.procs[0]?.print('hello\n');
    rt.dev.interrupt();
    expect(await done).toBe(130);
    expect(rt.io.err).toContain('shell   | hello');
    const result = JSON.parse(rt.io.out.join('')) as DevResult;
    expect(validateResult(result)).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      command: 'dev',
      interrupted: true,
      dryRun: false,
      overrides: { cart: 'http://localhost:3001/mf-manifest.json' },
    });
    expect(result.apps.map((a) => [a.name, a.status])).toEqual([
      ['shell', 'started'],
      ['catalog', 'started'],
      ['cart', 'overridden'],
    ]);
  });
});
