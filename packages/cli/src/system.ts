import { spawn } from 'node:child_process';
import path from 'node:path';
import { messageOf } from '@mfeflow/core';
import type { Io } from './io';

export interface RunResult {
  code: number;
  output: string;
}

/** Runs a program and collects what it prints. Rejects only when it cannot be started. */
export type Run = (
  command: string,
  args: readonly string[],
  options: { cwd: string; onOutput?: (chunk: string) => void },
) => Promise<RunResult>;

export const run: Run = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // pnpm is a .cmd file on Windows and needs a shell; a full path to an executable does not.
      shell: process.platform === 'win32' && !path.isAbsolute(command),
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      output += text;
      options.onOutput?.(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });

export interface System {
  /** Runs `<packageManager> install` in `root`. Throws with the tail of the output when it fails. */
  install(root: string, packageManager: string, verbose: boolean): Promise<void>;
  /** `git init` unless `root` is already inside a work tree. Returns whether it ran. */
  gitInit(root: string): Promise<boolean>;
}

const TAIL_LINES = 15;

/** The CLI has just changed package.json, so a lockfile that was frozen in CI would be out of date. */
function installArgs(packageManager: string): string[] {
  return packageManager === 'pnpm' ? ['install', '--no-frozen-lockfile'] : ['install'];
}

export function createSystem(io: Pick<Io, 'stderr'>, runner: Run = run): System {
  return {
    async install(root, packageManager, verbose) {
      let result: RunResult;
      try {
        result = await runner(packageManager, installArgs(packageManager), {
          cwd: root,
          ...(verbose ? { onOutput: (chunk) => io.stderr(chunk.trimEnd()) } : {}),
        });
      } catch (error) {
        throw new Error(
          `could not start ${packageManager} (${messageOf(error)}); install it, for example with \`corepack enable\``,
          { cause: error },
        );
      }
      if (result.code !== 0) {
        const tail = result.output.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');
        throw new Error(`${packageManager} install exited with ${String(result.code)}\n${tail}`);
      }
    },
    async gitInit(root) {
      try {
        const inside = await runner('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
        if (inside.code === 0) return false;
        return (await runner('git', ['init', '--quiet'], { cwd: root })).code === 0;
      } catch {
        return false;
      }
    },
  };
}
