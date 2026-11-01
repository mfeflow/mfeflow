import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { Cancelled } from './exit';
import { COMMANDS, main, validateResult } from '.';
import { commandHelp, rootHelp } from './help';
import { scriptedPrompter, testRuntime } from './testing';
import { readPackageJson } from './version';

describe('mfeflow', () => {
  it('prints the version for --version and -v', async () => {
    for (const flag of ['--version', '-v']) {
      const rt = testRuntime();
      expect(await main([flag], rt)).toBe(0);
      expect(rt.io.out).toEqual([`mfeflow ${readPackageJson().version}`]);
    }
  });

  it('prints help with no arguments, `help`, --help and -h', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const rt = testRuntime();
      expect(await main(argv, rt)).toBe(0);
      expect(rt.io.out.join('\n')).toBe(rootHelp(COMMANDS));
    }
  });

  it('shows examples, global flags and the exit codes in the root help', () => {
    const text = rootHelp(COMMANDS);
    expect(text).toContain('npm create mfeflow@latest my-app -- --yes');
    expect(text).toContain('Exit codes:');
    for (const command of COMMANDS) expect(text).toContain(command.name);
  });

  it('gives every command its own help with examples and every global flag', async () => {
    for (const command of COMMANDS) {
      for (const flag of ['--help', '-h']) {
        const rt = testRuntime();
        expect(await main([command.name, flag], rt)).toBe(0);
        const text = rt.io.out.join('\n');
        expect(text).toBe(commandHelp(command));
        expect(text).toContain('Examples:');
        for (const global of [
          '--yes',
          '--preset',
          '--json',
          '--dry-run',
          '--cwd',
          '--no-install',
          '--verbose',
        ]) {
          expect(text).toContain(global.replace('--no-install', '--install'));
        }
      }
    }
  });

  it('lists the options init has of its own', () => {
    const text = commandHelp(COMMANDS[0] ?? COMMANDS[1]!);
    for (const flag of ['--scope', '--remotes', '--features', '--option'])
      expect(text).toContain(flag);
  });

  it('reports an unknown command as E107 with exit code 2', async () => {
    const rt = testRuntime();
    expect(await main(['deploy'], rt)).toBe(2);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E107');
    expect(rt.io.err.join('\n')).toContain('Fix:');
    expect(rt.io.err.join('\n')).toContain('https://mfeflow.github.io/mfeflow/errors/E107');
  });

  it('asks for the command first when a flag comes before it', async () => {
    const rt = testRuntime();
    expect(await main(['--cwd', '/tmp', 'init'], rt)).toBe(2);
    expect(rt.io.err.join('\n')).toContain('comes before the command');
  });

  it('reports an unknown flag the same way, in JSON when asked', async () => {
    const rt = testRuntime();
    expect(await main(['features', '--bogus', '--json'], rt)).toBe(2);
    const result: unknown = JSON.parse(rt.io.out.join(''));
    expect(validateResult(result)).toEqual([]);
    expect(result).toMatchObject({ ok: false, exitCode: 2, error: { code: 'MFEFLOW_E107' } });
    expect(rt.io.err).toEqual([]);
  });

  // Reading the working folder throws a plain TypeError, which is no MfeflowError.
  const unexpected = ['init', 'x', '--yes'];
  const broken = () => {
    const rt = testRuntime();
    Object.defineProperty(rt.io, 'cwd', {
      get: () => {
        throw new TypeError('cwd is broken: no null bytes allowed');
      },
    });
    return rt;
  };

  it('turns an unexpected error into exit 1 without a stack, and with one under --verbose', async () => {
    const rt = broken();
    expect(await main(unexpected, rt)).toBe(1);
    expect(rt.io.err.join('\n')).toContain('Unexpected error:');
    expect(rt.io.err.join('\n')).toContain('--verbose');
    const loud = broken();
    await main([...unexpected, '--verbose'], loud);
    expect(loud.io.err.join('\n')).toContain('TypeError');
  });

  it('prints an unexpected error as JSON under --json', async () => {
    const rt = broken();
    expect(await main([...unexpected, '--json'], rt)).toBe(1);
    const result: unknown = JSON.parse(rt.io.out.join(''));
    expect(validateResult(result)).toEqual([]);
    expect(result).toMatchObject({ ok: false, exitCode: 1, error: { code: 'UNEXPECTED' } });
    expect(rt.io.err).toEqual([]);
  });

  it('gives an unexpected error under --json its own fix and no E107 docs', async () => {
    const rt = broken();
    await main([...unexpected, '--json'], rt);
    const { error } = JSON.parse(rt.io.out.join('')) as {
      error: { code: string; message: string; fix: string; docs: string };
    };
    expect(error.message).toContain('null bytes');
    expect(error.fix).not.toContain('--help');
    expect(error.fix).toContain('--verbose');
    expect(error.docs).not.toContain('E107');
    expect(error.docs).toContain('github.com/mfeflow/mfeflow/issues');
  });

  it('exits 130 and writes nothing when the person backs out of a prompt', async () => {
    const rt = testRuntime({
      prompter: { ...scriptedPrompter(), confirm: () => Promise.reject(new Cancelled()) },
    });
    rt.io.interactive = true;
    const argv = [
      'init',
      'x',
      '--scope',
      '@x',
      '--remotes',
      'a',
      '--features',
      'lint-oxlint',
      '--cwd',
      os.tmpdir(),
    ];
    expect(await main(argv, rt)).toBe(130);
    expect(rt.io.err.join('\n')).toContain('Cancelled');
    expect(rt.system.installs).toEqual([]);
  });
});
