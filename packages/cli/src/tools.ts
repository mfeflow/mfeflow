import fs from 'node:fs/promises';
import path from 'node:path';
import type { DevHost, DevProcess } from './proc';
import type { ToolRun } from './output';

export type ToolName = ToolRun['tool'];

/** The npm package that provides each tool's binary. */
export const TOOL_PACKAGE: Record<ToolName, string> = {
  vitest: 'vitest',
  oxlint: 'oxlint',
  tsc: 'typescript',
};

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * The binary of `tool` in the project's own install: `node_modules/.bin` of `from` or of a folder
 * above it, up to `root` (a hoisted install keeps it in the root's). Never looked up on the PATH,
 * so the version is the one the project locked. On Windows the `.cmd` shim.
 */
export async function resolveTool(
  tool: ToolName,
  from: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const names = platform === 'win32' ? [`${tool}.cmd`, `${tool}.exe`] : [tool];
  let dir = path.resolve(from);
  const top = path.resolve(root);
  for (;;) {
    for (const name of names) {
      const file = path.join(dir, 'node_modules', '.bin', name);
      // oxlint-disable-next-line no-await-in-loop -- walks up one folder at a time
      if (await isFile(file)) return file;
    }
    const parent = path.dirname(dir);
    if (dir === top || parent === dir) return undefined;
    dir = parent;
  }
}

export interface Target {
  name: string;
  tool: ToolName;
  /** Absolute path of the binary. */
  bin: string;
  args: readonly string[];
  cwd: string;
  /** Printed and reported; the same on every OS. */
  display: string;
  /** Folder relative to the project root, with forward slashes. */
  rel: string;
}

export interface RunOptions {
  host: DevHost;
  /** Gets one finished line at a time, already prefixed when `width` is set. */
  out: (line: string) => void;
  /** Pad names to this width and prefix every line with `name | `; undefined prints lines as they are. */
  width: number | undefined;
  jobs: number;
  env: Record<string, string | undefined>;
}

export interface RunOutcome {
  runs: ToolRun[];
  interrupted: boolean;
}

/** Runs the targets with at most `jobs` at once, one process each, and reports every one that started. */
export async function runTargets(
  targets: readonly Target[],
  options: RunOptions,
): Promise<RunOutcome> {
  const { host, out, width, env } = options;
  const runs = new Map<Target, ToolRun>();
  const live = new Set<DevProcess>();
  const state = { interrupted: false };
  let next = 0;
  const label = (target: Target): string =>
    width === undefined ? '' : `${target.name.padEnd(width)} | `;

  const runOne = (target: Target): Promise<void> =>
    new Promise((resolve) => {
      const started = performance.now();
      const child = host.spawn({ command: target.bin, args: target.args, cwd: target.cwd, env });
      live.add(child);
      let buffer = '';
      let ended = false;
      const feed = (chunk: string): void => {
        const lines = (buffer + chunk).split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim() !== '') out(`${label(target)}${line}`);
      };
      child.onOutput(feed);
      child.onExit((code) => {
        if (ended) return;
        ended = true;
        feed('\n');
        live.delete(child);
        runs.set(target, {
          name: target.name,
          tool: target.tool,
          command: target.display,
          cwd: target.rel,
          ok: code === 0,
          exitCode: code,
          durationMs: Math.round(performance.now() - started),
        });
        resolve();
      });
    });

  const worker = async (): Promise<void> => {
    while (!state.interrupted && next < targets.length) {
      const target = targets[next++];
      if (target === undefined) return;
      // oxlint-disable-next-line no-await-in-loop -- each worker takes the next target when its own is done
      await runOne(target);
    }
  };

  const stopListening = host.onInterrupt(() => {
    state.interrupted = true;
    for (const child of live) void child.stop();
  });
  try {
    await Promise.all(Array.from({ length: Math.max(1, options.jobs) }, worker));
  } finally {
    stopListening();
  }
  return { runs: targets.flatMap((t) => runs.get(t) ?? []), interrupted: state.interrupted };
}
