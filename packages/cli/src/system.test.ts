import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSystem, run, type Run } from './system';

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
