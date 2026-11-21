import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT, main, validateResult, type ToolResult } from '..';
import { passThrough } from './tools';
import { removeDir, tempDir, testRuntime, type TestRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

const BIN = process.platform === 'win32' ? '.cmd' : '';

async function bin(dir: string, name: string): Promise<void> {
  const file = path.join(dir, 'node_modules', '.bin', `${name}${BIN}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '');
}

/** A generated project with the tools "installed": tsc in each app and the root, vitest and oxlint in the root. */
async function project(tools: readonly string[] = ['vitest', 'oxlint', 'tsc']): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
  const root = path.join(cwd, 'app');
  for (const tool of tools) {
    if (tool === 'tsc') {
      for (const app of ['shell', 'catalog', 'cart']) {
        // oxlint-disable-next-line no-await-in-loop -- three small files
        await bin(path.join(root, 'apps', app), 'tsc');
      }
    }
    // oxlint-disable-next-line no-await-in-loop -- three small files
    await bin(root, tool);
  }
  return root;
}

const until = async (check: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 400 && !check(); i++) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!check()) throw new Error(`timed out waiting for ${what}`);
};

/** Runs a command and ends each process it starts with `code` as soon as it appears. */
async function run(
  argv: string[],
  code: number | ((rt: TestRuntime, index: number) => number) = 0,
): Promise<{ rt: TestRuntime; exit: number }> {
  const rt = testRuntime();
  const done = main(argv, rt);
  const state = { finished: false };
  void done.finally(() => {
    state.finished = true;
  });
  let seen = 0;
  while (!state.finished) {
    while (seen < rt.dev.procs.length) {
      const proc = rt.dev.procs[seen];
      const exit = typeof code === 'function' ? code(rt, seen) : code;
      seen += 1;
      proc?.print('some output\n');
      proc?.exit(exit);
    }
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return { rt, exit: await done };
}

const rel = (root: string, dir: string): string =>
  path.relative(root, dir).split(path.sep).join('/') || '.';

describe('passThrough', () => {
  it('is everything after --', () => {
    expect(passThrough(['--only', 'a', '--', '--coverage', '-t', 'x'])).toEqual([
      '--coverage',
      '-t',
      'x',
    ]);
  });
  it('is empty without --', () => {
    expect(passThrough(['--only', 'a'])).toEqual([]);
  });
});

describe('mfeflow typecheck', () => {
  it('runs tsc --noEmit in every app and the root tooling config, prefixed', async () => {
    const root = await project();
    const { rt, exit } = await run(['typecheck', '--cwd', root]);
    expect(exit).toBe(EXIT.ok);
    expect(rt.dev.procs.map((p) => rel(root, p.spec.cwd)).toSorted()).toEqual([
      '.',
      'apps/cart',
      'apps/catalog',
      'apps/shell',
    ]);
    expect(rt.dev.procs.every((p) => p.spec.args.join(' ') === '--noEmit')).toBe(true);
    expect(rt.dev.procs.every((p) => path.basename(p.spec.command).startsWith('tsc'))).toBe(true);
    expect(rt.io.out).toContain('shell   | some output');
    expect(rt.io.out.at(-1)).toMatch(/^mfeflow: typecheck: .*shell ok .*tooling ok /);
  });

  it('resolves tsc from the app first, else from the project root', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/cart/node_modules'), { recursive: true });
    const { rt } = await run(['typecheck', '--cwd', root, '--only', 'cart']);
    expect(rt.dev.procs[0]?.spec.command).toBe(path.join(root, 'node_modules/.bin', `tsc${BIN}`));
    expect(rt.dev.procs[0]?.spec.cwd).toBe(path.join(root, 'apps/cart'));
  });

  it('--only picks apps, and the root config is called tooling', async () => {
    const root = await project();
    const { rt } = await run(['typecheck', '--cwd', root, '--only', 'catalog,tooling']);
    expect(rt.dev.procs.map((p) => rel(root, p.spec.cwd)).toSorted()).toEqual([
      '.',
      'apps/catalog',
    ]);
  });

  it('inside an app folder checks only that app', async () => {
    const root = await project();
    const { rt } = await run(['typecheck', '--cwd', path.join(root, 'apps/shell', 'src')]);
    expect(rt.dev.procs.map((p) => rel(root, p.spec.cwd))).toEqual(['apps/shell']);
  });

  it('passes the arguments after -- to tsc', async () => {
    const root = await project();
    const { rt } = await run([
      'typecheck',
      '--cwd',
      root,
      '--only',
      'shell',
      '--',
      '--pretty',
      'false',
    ]);
    expect(rt.dev.procs[0]?.spec.args).toEqual(['--noEmit', '--pretty', 'false']);
  });

  it('exits 5 when a check fails and says which', async () => {
    const root = await project();
    const { rt, exit } = await run(['typecheck', '--cwd', root], (r, i) =>
      path.basename(r.dev.procs[i]?.spec.cwd ?? '') === 'cart' ? 2 : 0,
    );
    expect(exit).toBe(EXIT.build);
    expect(rt.io.out.at(-1)).toContain('cart FAILED (exit 2)');
  });

  it('limits how many run at once with --jobs', async () => {
    const root = await project();
    const rt = testRuntime();
    const done = main(['typecheck', '--cwd', root, '--jobs', '1'], rt);
    await until(() => rt.dev.procs.length === 1, 'the first process');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(rt.dev.procs).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one after the other
      await until(() => rt.dev.procs.length === i + 1, 'the next process');
      rt.dev.procs[i]?.exit(0);
    }
    expect(await done).toBe(EXIT.ok);
  });

  it('rejects an unknown app with E107 and a bad --jobs', async () => {
    const root = await project();
    const a = await run(['typecheck', '--cwd', root, '--only', 'nope']);
    expect(a.exit).toBe(EXIT.usage);
    expect(a.rt.io.err.join('\n')).toContain('no such app');
    const b = await run(['typecheck', '--cwd', root, '--jobs', '0']);
    expect(b.exit).toBe(EXIT.usage);
    const c = await run(['typecheck', '--cwd', root, '--bogus']);
    expect(c.exit).toBe(EXIT.usage);
  });

  it('refuses with E310 naming the package when tsc is not installed', async () => {
    const root = await project(['vitest', 'oxlint']);
    const { rt, exit } = await run(['typecheck', '--cwd', root]);
    expect(exit).toBe(EXIT.build);
    expect(rt.io.err.join('\n')).toMatch(/MFEFLOW_E310.*typescript is not installed/);
    expect(rt.dev.procs).toHaveLength(0);
  });

  it('--dry-run prints what would run and starts nothing', async () => {
    const root = await project();
    const { rt, exit } = await run(['typecheck', '--cwd', root, '--dry-run', '--only', 'shell']);
    expect(exit).toBe(EXIT.ok);
    expect(rt.dev.procs).toHaveLength(0);
    expect(rt.io.out).toEqual(['shell: tsc --noEmit in apps/shell']);
  });

  it('checks workspace packages that have a typecheck script', async () => {
    const root = await project();
    const pkg = path.join(root, 'packages', 'ui');
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name: '@app/ui', scripts: { typecheck: 'tsc --noEmit' } }),
    );
    await fs.writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - packages/*\n',
    );
    await bin(pkg, 'tsc');
    const { rt } = await run(['typecheck', '--cwd', root, '--only', '@app/ui']);
    expect(rt.dev.procs.map((p) => rel(root, p.spec.cwd))).toEqual(['packages/ui']);
  });

  it('checks the packages of a tooling repo, which has no apps', async () => {
    const cwd = await tempDir();
    dirs.push(cwd);
    await main(
      ['init', 'lib', '--yes', '--no-install', '--kind', 'tooling', '--cwd', cwd],
      testRuntime(),
    );
    const root = path.join(cwd, 'lib');
    await bin(root, 'tsc');
    const { rt, exit } = await run(['typecheck', '--cwd', root]);
    expect(exit).toBe(EXIT.ok);
    expect(rt.dev.procs.length).toBeGreaterThan(0);
    expect(rt.dev.procs.every((p) => rel(root, p.spec.cwd).startsWith('packages/'))).toBe(true);
  });

  it('says so when there is nothing to check', async () => {
    const cwd = await tempDir();
    dirs.push(cwd);
    await main(
      ['init', 'lib', '--yes', '--no-install', '--kind', 'tooling', '--cwd', cwd],
      testRuntime(),
    );
    const root = path.join(cwd, 'lib');
    await fs.rm(path.join(root, 'packages'), { recursive: true });
    const { rt, exit } = await run(['typecheck', '--cwd', root]);
    expect(exit).toBe(EXIT.ok);
    expect(rt.dev.procs).toHaveLength(0);
    expect(rt.io.out.join('\n')).toContain('no app or package');
  });

  it('prints one valid JSON document, with the tool output on stderr', async () => {
    const root = await project();
    const { rt, exit } = await run(['typecheck', '--cwd', root, '--json', '--only', 'shell,cart']);
    expect(exit).toBe(EXIT.ok);
    expect(rt.io.out).toHaveLength(1);
    const doc = JSON.parse(rt.io.out[0] ?? '') as ToolResult;
    expect(validateResult(doc)).toEqual([]);
    expect(doc).toMatchObject({
      ok: true,
      command: 'typecheck',
      dryRun: false,
      interrupted: false,
    });
    expect(doc.runs.map((r) => [r.name, r.tool, r.ok, r.exitCode, r.cwd])).toEqual([
      ['shell', 'tsc', true, 0, 'apps/shell'],
      ['cart', 'tsc', true, 0, 'apps/cart'],
    ]);
    expect(rt.io.err.some((l) => l.includes('shell | some output'))).toBe(true);
  });

  it('exits 130 and reports the stop on Ctrl+C', async () => {
    const root = await project();
    const rt = testRuntime();
    const done = main(['typecheck', '--cwd', root, '--jobs', '1', '--json'], rt);
    await until(() => rt.dev.procs.length === 1, 'the first process');
    rt.dev.interrupt();
    expect(await done).toBe(EXIT.cancelled);
    expect((JSON.parse(rt.io.out[0] ?? '') as ToolResult).interrupted).toBe(true);
  });
});

describe('mfeflow test', () => {
  it('runs vitest run at the root', async () => {
    const root = await project();
    const { rt, exit } = await run(['test', '--cwd', root]);
    expect(exit).toBe(EXIT.ok);
    expect(rt.dev.procs).toHaveLength(1);
    expect(rt.dev.procs[0]?.spec).toMatchObject({ args: ['run'], cwd: root });
    expect(rt.dev.procs[0]?.spec.command).toBe(
      path.join(root, 'node_modules/.bin', `vitest${BIN}`),
    );
    expect(rt.io.out).toContain('some output');
  });

  it('maps --only to vitest projects named by each app package', async () => {
    const root = await project();
    const { rt } = await run(['test', '--cwd', root, '--only', 'shell,cart']);
    expect(rt.dev.procs[0]?.spec.args).toEqual([
      'run',
      '--project',
      '@app/shell',
      '--project',
      '@app/cart',
    ]);
  });

  it('inside an app folder runs that app project only', async () => {
    const root = await project();
    const { rt } = await run(['test', '--cwd', path.join(root, 'apps/catalog')]);
    expect(rt.dev.procs[0]?.spec.args).toEqual(['run', '--project', '@app/catalog']);
    expect(rt.dev.procs[0]?.spec.cwd).toBe(root);
  });

  it('passes the arguments after -- through', async () => {
    const root = await project();
    const { rt } = await run(['test', '--cwd', root, '--', '--coverage', '-t', 'cart total']);
    expect(rt.dev.procs[0]?.spec.args).toEqual(['run', '--coverage', '-t', 'cart total']);
  });

  it('exits 5 when tests fail, and reports the exit code in JSON', async () => {
    const root = await project();
    const { rt, exit } = await run(['test', '--cwd', root, '--json'], 1);
    expect(exit).toBe(EXIT.build);
    const doc = JSON.parse(rt.io.out[0] ?? '') as ToolResult;
    expect(validateResult(doc)).toEqual([]);
    expect(doc).toMatchObject({ ok: false, command: 'test' });
    expect(doc.runs[0]).toMatchObject({
      name: 'test',
      tool: 'vitest',
      ok: false,
      exitCode: 1,
      cwd: '.',
    });
  });

  it('runs vitest in each app that has a config when the root has none', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'vitest.config.ts'));
    const { rt } = await run(['test', '--cwd', root, '--only', 'shell,cart']);
    expect(rt.dev.procs.map((p) => rel(root, p.spec.cwd)).toSorted()).toEqual([
      'apps/cart',
      'apps/shell',
    ]);
    expect(rt.dev.procs[0]?.spec.args).toEqual(['run']);
    expect(rt.io.out.some((l) => l.startsWith('shell | '))).toBe(true);
  });

  it('runs a single app without a prefix when the root has no config', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'vitest.config.ts'));
    await bin(path.join(root, 'apps/shell'), 'vitest');
    const { rt } = await run(['test', '--cwd', path.join(root, 'apps/shell')]);
    expect(rt.dev.procs[0]?.spec.command).toBe(
      path.join(root, 'apps/shell/node_modules/.bin', `vitest${BIN}`),
    );
    expect(rt.io.out).toContain('some output');
  });

  it('refuses with E310 when vitest is not set up or not installed', async () => {
    const root = await project(['oxlint', 'tsc']);
    const missing = await run(['test', '--cwd', root]);
    expect(missing.exit).toBe(EXIT.build);
    expect(missing.rt.io.err.join('\n')).toMatch(/E310.*vitest is not installed/);
    await fs.rm(path.join(root, 'vitest.config.ts'));
    for (const app of ['shell', 'catalog', 'cart']) {
      // oxlint-disable-next-line no-await-in-loop -- three small files
      await fs.rm(path.join(root, 'apps', app, 'vitest.config.ts'));
    }
    const noConfig = await run(['test', '--cwd', root]);
    expect(noConfig.exit).toBe(EXIT.build);
    expect(noConfig.rt.io.err.join('\n')).toMatch(/E310.*vitest is not set up/);
  });

  it('--dry-run prints the command', async () => {
    const root = await project();
    const { rt } = await run(['test', '--cwd', root, '--dry-run', '--only', 'cart']);
    expect(rt.dev.procs).toHaveLength(0);
    expect(rt.io.out).toEqual(['test: vitest run --project @app/cart in .']);
  });
});

describe('mfeflow lint', () => {
  it('runs oxlint with the flags of the lint script at the root', async () => {
    const root = await project();
    const { rt, exit } = await run(['lint', '--cwd', root]);
    expect(exit).toBe(EXIT.ok);
    expect(rt.dev.procs[0]?.spec).toMatchObject({
      args: ['--type-aware', '--deny-warnings'],
      cwd: root,
    });
    expect(rt.dev.procs[0]?.spec.command).toBe(
      path.join(root, 'node_modules/.bin', `oxlint${BIN}`),
    );
  });

  it('limits the paths with --only and passes the rest through', async () => {
    const root = await project();
    const { rt } = await run(['lint', '--cwd', root, '--only', 'shell,cart', '--', '--fix']);
    expect(rt.dev.procs[0]?.spec.args).toEqual([
      '--type-aware',
      '--deny-warnings',
      'apps/shell',
      'apps/cart',
      '--fix',
    ]);
  });

  it('inside an app folder lints that folder', async () => {
    const root = await project();
    const { rt } = await run(['lint', '--cwd', path.join(root, 'apps/cart')]);
    expect(rt.dev.procs[0]?.spec.args).toEqual(['--type-aware', '--deny-warnings', 'apps/cart']);
  });

  it('exits 5 on findings and E310 names oxlint when it is missing', async () => {
    const root = await project();
    expect((await run(['lint', '--cwd', root], 1)).exit).toBe(EXIT.build);
    const bare = await project(['vitest', 'tsc']);
    const { rt, exit } = await run(['lint', '--cwd', bare]);
    expect(exit).toBe(EXIT.build);
    expect(rt.io.err.join('\n')).toMatch(/E310.*oxlint is not installed/);
  });
});
