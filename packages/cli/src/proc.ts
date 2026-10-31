import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export interface DevProcess {
  readonly pid: number | undefined;
  onOutput(listener: (chunk: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  /** Ends the process and everything it started. Resolves once it is gone. */
  stop(): Promise<void>;
}

export interface DevSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

export type SpawnDev = (spec: DevSpec) => DevProcess;

export interface DevHost {
  spawn: SpawnDev;
  /** Calls back on Ctrl+C or a termination signal. Returns a function that stops listening. */
  onInterrupt(listener: () => void): () => void;
  /** Calls back, debounced, when any of `paths` changes. Returns a function that stops watching. */
  watch(paths: readonly string[], listener: () => void): () => void;
  portFree(port: number): Promise<boolean>;
}

const GRACE_MS = 5000;

type Kill = (pid: number, signal: NodeJS.Signals | 0) => void;

export interface TreeKiller {
  platform: NodeJS.Platform;
  kill: Kill;
  /** Runs `taskkill` on Windows. */
  taskkill(pid: number): Promise<void>;
  graceMs: number;
}

const alive = (kill: Kill, pid: number): boolean => {
  try {
    kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stops a process and its children: the process group on POSIX, `taskkill /T` on Windows. */
export async function killTree(pid: number, how: TreeKiller): Promise<void> {
  if (how.platform === 'win32') {
    await how.taskkill(pid);
    return;
  }
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      how.kill(-pid, signal);
    } catch {
      return;
    }
    const deadline = Date.now() + (signal === 'SIGTERM' ? how.graceMs : 2000);
    // oxlint-disable-next-line no-await-in-loop -- polls until the group is gone
    while (alive(how.kill, pid) && Date.now() < deadline) await sleep(50);
    if (!alive(how.kill, pid)) return;
  }
}

const realKiller: TreeKiller = {
  platform: process.platform,
  kill: (pid, signal) => process.kill(pid, signal),
  taskkill: (pid) =>
    new Promise((resolve) => {
      const child = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      child.on('error', () => {
        resolve();
      });
      child.on('close', () => {
        resolve();
      });
    }),
  graceMs: GRACE_MS,
};

function wrap(child: ChildProcess, killer: TreeKiller): DevProcess {
  let exited = false;
  const exit = new Promise<void>((resolve) => {
    child.once('close', () => {
      exited = true;
      resolve();
    });
    child.once('error', () => {
      exited = true;
      resolve();
    });
  });
  return {
    pid: child.pid,
    onOutput(listener) {
      for (const stream of [child.stdout, child.stderr]) {
        stream?.on('data', (chunk: Buffer) => {
          listener(chunk.toString('utf8'));
        });
      }
    },
    onExit(listener) {
      child.once('close', (code) => {
        listener(code);
      });
      child.once('error', () => {
        listener(null);
      });
    },
    async stop() {
      if (child.pid !== undefined && !exited) await killTree(child.pid, killer);
      await Promise.race([exit, sleep(2000)]);
    },
  };
}

export const spawnDev: SpawnDev = (spec) => {
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // POSIX: its own process group, so one signal takes the dev server's children too.
    detached: process.platform !== 'win32',
    // pnpm is a .cmd file on Windows and needs a shell.
    shell: process.platform === 'win32' && !path.isAbsolute(spec.command),
  });
  return wrap(child, realKiller);
};

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      resolve(false);
    });
    probe.listen(port, () => {
      probe.close(() => {
        resolve(true);
      });
    });
  });
}

const DEBOUNCE_MS = 150;

/** Watches files (through their folder, since an atomic save replaces the file) and folders. */
export function watchPaths(paths: readonly string[], listener: () => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  const fire = (): void => {
    clearTimeout(timer);
    timer = setTimeout(listener, DEBOUNCE_MS);
  };
  const watchers: fs.FSWatcher[] = [];
  for (const target of paths) {
    let folder = target;
    let only: string | undefined;
    try {
      if (!fs.statSync(target).isDirectory()) {
        folder = path.dirname(target);
        only = path.basename(target);
      }
    } catch {
      continue;
    }
    try {
      watchers.push(
        fs.watch(folder, (_event, name) => {
          if (only === undefined || name === null || name === only) fire();
        }),
      );
    } catch {
      // A folder that cannot be watched only means no live reload for it.
    }
  }
  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

export function onInterrupt(listener: () => void): () => void {
  const signals = ['SIGINT', 'SIGTERM'] as const;
  for (const signal of signals) process.on(signal, listener);
  return () => {
    for (const signal of signals) process.off(signal, listener);
  };
}

export function realDevHost(): DevHost {
  return { spawn: spawnDev, onInterrupt, watch: watchPaths, portFree };
}
