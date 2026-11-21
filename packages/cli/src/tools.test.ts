import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FakeProc } from './testing';
import { fakeDev, removeDir, tempDir } from './testing';
import { quoteForCmd, resolveTool, runsInShell, runTargets, type Target } from './tools';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function bin(dir: string, name: string): Promise<string> {
  // On Windows the tools are .cmd shims; a name that already has an extension is kept as it is.
  const shim = process.platform === 'win32' && path.extname(name) === '' ? '.cmd' : '';
  const file = path.join(dir, 'node_modules', '.bin', `${name}${shim}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '');
  return file;
}

describe('resolveTool', () => {
  it('finds the binary in the folder itself', async () => {
    const root = await tempDir();
    dirs.push(root);
    const app = path.join(root, 'apps', 'shell');
    const file = await bin(app, 'tsc');
    expect(await resolveTool('tsc', app, root)).toBe(file);
  });

  it('walks up to a hoisted install in the project root', async () => {
    const root = await tempDir();
    dirs.push(root);
    const file = await bin(root, 'vitest');
    expect(await resolveTool('vitest', path.join(root, 'apps', 'shell'), root)).toBe(file);
  });

  it('prefers the nearest copy', async () => {
    const root = await tempDir();
    dirs.push(root);
    await bin(root, 'tsc');
    const app = path.join(root, 'apps', 'shell');
    const near = await bin(app, 'tsc');
    expect(await resolveTool('tsc', app, root)).toBe(near);
  });

  it('never looks above the project root', async () => {
    const outer = await tempDir();
    dirs.push(outer);
    await bin(outer, 'oxlint');
    const root = path.join(outer, 'project');
    await fs.mkdir(root);
    expect(await resolveTool('oxlint', root, root)).toBeUndefined();
  });

  it('is undefined for a folder that is a directory called like the tool', async () => {
    const root = await tempDir();
    dirs.push(root);
    await fs.mkdir(
      path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'),
      {
        recursive: true,
      },
    );
    expect(await resolveTool('tsc', root, root)).toBeUndefined();
  });

  it('looks for the .cmd shim on Windows', async () => {
    const root = await tempDir();
    dirs.push(root);
    const file = await bin(root, 'tsc.cmd');
    expect(await resolveTool('tsc', root, root, 'win32')).toBe(file);
    expect(await resolveTool('tsc', root, root, 'linux')).toBeUndefined();
  });
});

function targets(...names: string[]): Target[] {
  return names.map((name) => ({
    name,
    tool: 'tsc' as const,
    bin: `/bin/${name}`,
    args: ['--noEmit'],
    cwd: `/work/${name}`,
    display: 'tsc --noEmit',
    rel: `apps/${name}`,
  }));
}

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) {
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(check()).toBe(true);
};

describe('runTargets', () => {
  it('starts only `jobs` at a time and starts the next when one ends', async () => {
    const host = fakeDev();
    const lines: string[] = [];
    const done = runTargets(targets('a', 'b', 'c'), {
      host,
      out: (l) => lines.push(l),
      width: 1,
      jobs: 2,
      env: {},
    });
    await until(() => host.procs.length === 2);
    expect(host.procs.map((p) => p.spec.cwd)).toEqual(['/work/a', '/work/b']);
    host.procs[0]?.exit(0);
    await until(() => host.procs.length === 3);
    for (const p of host.procs.slice(1)) p.exit(2);
    const { runs, interrupted } = await done;
    expect(interrupted).toBe(false);
    expect(runs.map((r) => [r.name, r.ok, r.exitCode])).toEqual([
      ['a', true, 0],
      ['b', false, 2],
      ['c', false, 2],
    ]);
    expect(runs[0]).toMatchObject({ tool: 'tsc', command: 'tsc --noEmit', cwd: 'apps/a' });
    expect(runs[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('prefixes whole lines and joins a line split across chunks', async () => {
    const host = fakeDev();
    const lines: string[] = [];
    const done = runTargets(targets('shell', 'a'), {
      host,
      out: (l) => lines.push(l),
      width: 5,
      jobs: 2,
      env: {},
    });
    await until(() => host.procs.length === 2);
    host.procs[0]?.print('error TS23');
    host.procs[0]?.print('22: bad\n\nsecond line\r\n');
    host.procs[1]?.print('tail without newline');
    for (const p of host.procs) p.exit(0);
    await done;
    expect(lines).toEqual([
      'shell | error TS2322: bad',
      'shell |',
      'shell | second line',
      'a     | tail without newline',
    ]);
  });

  it('prints lines as they are without a width, and passes the env on', async () => {
    const host = fakeDev();
    const lines: string[] = [];
    const done = runTargets(targets('a'), {
      host,
      out: (l) => lines.push(l),
      width: undefined,
      jobs: 1,
      env: { FORCE_COLOR: '1' },
    });
    await until(() => host.procs.length === 1);
    host.procs[0]?.print('plain\n');
    host.procs[0]?.exit(0);
    await done;
    expect(lines).toEqual(['plain']);
    expect(host.procs[0]?.spec).toMatchObject({
      command: '/bin/a',
      args: ['--noEmit'],
      env: { FORCE_COLOR: '1' },
    });
  });

  it('reports a process that could not start as a failure without an exit code', async () => {
    const host = fakeDev();
    const done = runTargets(targets('a'), { host, out: () => {}, width: 1, jobs: 1, env: {} });
    await until(() => host.procs.length === 1);
    host.procs[0]?.exit(null);
    host.procs[0]?.exit(null);
    const { runs } = await done;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: false, exitCode: null });
  });

  it('stops what runs on Ctrl+C and starts nothing more', async () => {
    const host = fakeDev();
    const done = runTargets(targets('a', 'b', 'c'), {
      host,
      out: () => {},
      width: 1,
      jobs: 1,
      env: {},
    });
    await until(() => host.procs.length === 1);
    host.interrupt();
    const { runs, interrupted } = await done;
    const first: FakeProc | undefined = host.procs[0];
    expect(first?.stopped).toBe(true);
    expect(host.procs).toHaveLength(1);
    expect(interrupted).toBe(true);
    expect(runs.map((r) => r.name)).toEqual(['a']);
  });

  it('runs one at a time when jobs is below one', async () => {
    const host = fakeDev();
    const done = runTargets(targets('a', 'b'), { host, out: () => {}, width: 1, jobs: 0, env: {} });
    await until(() => host.procs.length === 1);
    host.procs[0]?.exit(0);
    await until(() => host.procs.length === 2);
    host.procs[1]?.exit(0);
    expect((await done).runs).toHaveLength(2);
  });
});

describe('quoteForCmd', () => {
  it('quotes and escapes every metacharacter twice for a .cmd shim', () => {
    expect(quoteForCmd('plain')).toBe('^^^"plain^^^"');
    expect(quoteForCmd('adds an item')).toBe('^^^"adds^^^ an^^^ item^^^"');
    expect(quoteForCmd('a&b|c')).toBe('^^^"a^^^&b^^^|c^^^"');
    expect(quoteForCmd('a^b')).toBe('^^^"a^^^^b^^^"');
    expect(quoteForCmd('50%')).toBe('^^^"50^^^%^^^"');
    expect(quoteForCmd('(x)<y>')).toBe('^^^"^^^(x^^^)^^^<y^^^>^^^"');
  });

  it('escapes a quote with a backslash, and doubles backslashes before it', () => {
    expect(quoteForCmd('say "hi"')).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"');
    expect(quoteForCmd('a\\"b')).toBe('^^^"a\\\\\\^^^"b^^^"');
  });

  it('doubles trailing backslashes so they do not escape the closing quote', () => {
    expect(quoteForCmd('C:\\dir\\')).toBe('^^^"C:\\dir\\\\^^^"');
  });

  it('turns an empty argument into an empty quoted string', () => {
    expect(quoteForCmd('')).toBe('^^^"^^^"');
  });
});

describe('runsInShell', () => {
  it('is true on Windows for shims and bare commands, false for an .exe and on POSIX', () => {
    expect(runsInShell('C:\\p\\node_modules\\.bin\\vitest.cmd', 'win32')).toBe(true);
    expect(runsInShell('pnpm', 'win32')).toBe(true);
    expect(runsInShell('C:\\p\\oxlint.exe', 'win32')).toBe(false);
    expect(runsInShell('/p/node_modules/.bin/vitest', 'linux')).toBe(false);
    expect(runsInShell('pnpm', 'darwin')).toBe(false);
  });
});

describe('runTargets arguments and output', () => {
  const one = (args: string[], command = '/bin/a'): Target => ({
    ...targets('a')[0]!,
    bin: command,
    args,
  });
  const options = (
    host: ReturnType<typeof fakeDev>,
    lines: string[],
    platform?: NodeJS.Platform,
  ) => ({
    host,
    out: (l: string) => lines.push(l),
    width: undefined,
    jobs: 1,
    env: {},
    ...(platform === undefined ? {} : { platform }),
  });

  it('quotes the arguments of a shim on Windows and leaves POSIX alone', async () => {
    const args = ['run', '-t', 'adds an item', 'a&b'];
    const win = fakeDev();
    const first = runTargets([one(args, 'C:\\p\\vitest.cmd')], options(win, [], 'win32'));
    await until(() => win.procs.length === 1);
    expect(win.procs[0]?.spec.args).toEqual(args.map(quoteForCmd));
    win.procs[0]?.exit(0);
    await first;

    const posix = fakeDev();
    const second = runTargets([one(args)], options(posix, [], 'linux'));
    await until(() => posix.procs.length === 1);
    expect(posix.procs[0]?.spec.args).toEqual(args);
    posix.procs[0]?.exit(0);
    await second;
  });

  it('keeps a line buffer per stream and keeps blank lines', async () => {
    const host = fakeDev();
    const lines: string[] = [];
    const done = runTargets(targets('a'), { ...options(host, lines), width: 1 });
    await until(() => host.procs.length === 1);
    host.procs[0]?.print('out one ', 'stdout');
    host.procs[0]?.print('err one\n', 'stderr');
    host.procs[0]?.print('end\n\n\nlast', 'stdout');
    host.procs[0]?.print('tail', 'stderr');
    host.procs[0]?.exit(0);
    await done;
    expect(lines).toEqual(['a | err one', 'a | out one end', 'a |', 'a |', 'a | last', 'a | tail']);
  });

  it('records a spawn that throws as a failed run and still runs the others', async () => {
    const host = fakeDev();
    host.failSpawn = (spec) => (spec.cwd === '/work/a' ? new Error('spawn EACCES') : undefined);
    const lines: string[] = [];
    const done = runTargets(targets('a', 'b'), { ...options(host, lines), width: 1 });
    await until(() => host.procs.length === 1);
    host.procs[0]?.exit(0);
    const { runs, interrupted } = await done;
    expect(interrupted).toBe(false);
    expect(runs.map((r) => [r.name, r.ok, r.exitCode, r.error])).toEqual([
      ['a', false, null, 'spawn EACCES'],
      ['b', true, 0, undefined],
    ]);
    expect(lines).toContain('a | could not start: spawn EACCES');
  });

  it('stops the children that run when a later spawn throws and Ctrl+C follows', async () => {
    const host = fakeDev();
    host.failSpawn = (spec) => (spec.cwd === '/work/b' ? new Error('boom') : undefined);
    const done = runTargets(targets('a', 'b'), { ...options(host, []), jobs: 2 });
    await until(() => host.procs.length === 1);
    host.interrupt();
    const { runs } = await done;
    expect(host.procs[0]?.stopped).toBe(true);
    expect(runs.map((r) => r.name)).toEqual(['a', 'b']);
  });
});
