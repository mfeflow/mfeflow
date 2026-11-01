import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSystem, isolatedEnv, run, type Run } from './system';

const quiet = { stderr: () => undefined };

describe('run', () => {
  it('collects output and the exit code', async () => {
    const chunks: string[] = [];
    const result = await run(
      process.execPath,
      ['-e', "console.log('hi'); console.error('err'); process.exit(3)"],
      {
        cwd: process.cwd(),
        onOutput: (c) => chunks.push(c),
      },
    );
    expect(result.code).toBe(3);
    expect(result.output).toContain('hi');
    expect(result.output).toContain('err');
    expect(chunks.join('')).toBe(result.output);
  });

  it('rejects when the program cannot start', async () => {
    const missing = path.join(os.tmpdir(), 'mfeflow-no-such-program');
    await expect(run(missing, [], { cwd: process.cwd() })).rejects.toThrow();
  });
});

describe('install', () => {
  it('runs <package manager> install in the folder', async () => {
    const calls: unknown[] = [];
    const runner: Run = (command, args, options) => {
      calls.push([command, args, options.cwd]);
      return Promise.resolve({ code: 0, output: '' });
    };
    await createSystem(quiet, runner).install('/p', 'pnpm', false);
    expect(calls).toEqual([['pnpm', ['install', '--no-frozen-lockfile'], '/p']]);
    await createSystem(quiet, runner).install('/p', 'npm', false);
    expect(calls[1]).toEqual(['npm', ['install'], '/p']);
  });

  it('streams output to stderr with --verbose only', async () => {
    const lines: string[] = [];
    const runner: Run = (_c, _a, options) => {
      options.onOutput?.('working\n');
      return Promise.resolve({ code: 0, output: 'working\n' });
    };
    await createSystem({ stderr: (t) => lines.push(t) }, runner).install('/p', 'pnpm', false);
    expect(lines).toEqual([]);
    await createSystem({ stderr: (t) => lines.push(t) }, runner).install('/p', 'pnpm', true);
    expect(lines).toEqual(['working']);
  });

  it('fails with the tail of the output', async () => {
    const output = Array.from({ length: 40 }, (_, i) => `line ${String(i)}`).join('\n');
    const runner: Run = () => Promise.resolve({ code: 1, output });
    const error = await createSystem(quiet, runner)
      .install('/p', 'pnpm', false)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('pnpm install exited with 1');
    expect(message).toContain('line 39');
    expect(message).not.toContain('line 5\n');
  });

  it('says how to get the package manager when it cannot start', async () => {
    const runner: Run = () => Promise.reject(new Error('spawn pnpm ENOENT'));
    await expect(createSystem(quiet, runner).install('/p', 'pnpm', false)).rejects.toThrow(
      /corepack enable/,
    );
  });
});

describe('gitInit', () => {
  const answering =
    (codes: Record<string, number>): Run =>
    (_command, args) =>
      Promise.resolve({ code: codes[args[0] ?? ''] ?? 0, output: '' });

  it('leaves a folder that is already in a repository alone', async () => {
    expect(await createSystem(quiet, answering({ 'rev-parse': 0 })).gitInit('/p')).toBe(false);
  });

  it('initialises when it is not', async () => {
    expect(await createSystem(quiet, answering({ 'rev-parse': 128, init: 0 })).gitInit('/p')).toBe(
      true,
    );
    expect(await createSystem(quiet, answering({ 'rev-parse': 128, init: 1 })).gitInit('/p')).toBe(
      false,
    );
  });

  it('does not fail when git is missing', async () => {
    const runner: Run = () => Promise.reject(new Error('ENOENT'));
    expect(await createSystem(quiet, runner).gitInit('/p')).toBe(false);
  });
});

describe('isolatedEnv', () => {
  it('drops the variables that bind git to another repository and keeps the rest', () => {
    const env = isolatedEnv({
      GIT_DIR: '/r/.git',
      GIT_WORK_TREE: '/r',
      GIT_INDEX_FILE: 'i',
      PATH: '/bin',
      GIT_AUTHOR_NAME: 'a',
    });
    expect(env).toEqual({ PATH: '/bin', GIT_AUTHOR_NAME: 'a' });
  });

  it('keeps git init from turning the repository of a worktree hook bare', async () => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-gitenv-')));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, env: isolatedEnv(), stdio: 'pipe' }).toString().trim();
    try {
      const outer = path.join(base, 'outer');
      await fs.mkdir(outer);
      git(outer, 'init', '-q');
      git(
        outer,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        'commit',
        '-q',
        '--allow-empty',
        '--no-gpg-sign',
        '-m',
        'x',
      );
      git(outer, 'worktree', 'add', '-q', path.join(base, 'wt'), '-b', 'w');
      const project = path.join(base, 'project');
      await fs.mkdir(project);
      const saved = process.env.GIT_DIR;
      process.env.GIT_DIR = path.join(outer, '.git', 'worktrees', 'wt');
      try {
        expect(await createSystem(quiet).gitInit(project)).toBe(true);
      } finally {
        if (saved === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = saved;
      }
      expect(git(outer, 'config', 'core.bare')).toBe('false');
      expect(git(project, 'rev-parse', '--is-inside-work-tree')).toBe('true');
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});

describe('initRepo', () => {
  const cleanRunner: Run = (command, args, options) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
    );
    try {
      const output = execFileSync(command, [...args], {
        cwd: options.cwd,
        env,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return Promise.resolve({ code: 0, output });
    } catch {
      return Promise.resolve({ code: 1, output: '' });
    }
  };

  it('makes a repo of its own inside a folder that is already inside another work tree', async () => {
    const outer = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-outer-'));
    try {
      const system = createSystem(quiet, cleanRunner);
      expect(await system.gitInit(outer)).toBe(true);
      const inner = path.join(outer, 'inner');
      await fs.mkdir(inner);
      expect(await system.gitInit(inner)).toBe(false);
      expect(await system.initRepo(inner)).toBe(true);
      await fs.access(path.join(inner, '.git'));
      expect(await system.initRepo(inner)).toBe(false);
    } finally {
      await fs.rm(outer, { recursive: true, force: true });
    }
  });

  it('is false when git cannot run', async () => {
    const broken: Run = () => Promise.reject(new Error('no git'));
    expect(await createSystem(quiet, broken).initRepo(os.tmpdir())).toBe(false);
    const failing: Run = () => Promise.resolve({ code: 1, output: '' });
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-empty-'));
    try {
      expect(await createSystem(quiet, failing).initRepo(empty)).toBe(false);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});
