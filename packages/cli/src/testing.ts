import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isMfeflowError, type MfeflowError } from '@mfeflow/core';
import { assetRoots } from './assets';
import type { Io } from './io';
import type { DevHost, DevProcess, DevSpec } from './proc';
import type { Prompter } from './prompter';
import type { Runtime } from './runtime';
import type { System } from './system';

/** The checkout this package lives in; `--local` tests point at it. */
export const REPO = path.resolve(import.meta.dirname, '../../..');

export interface Recorded {
  out: string[];
  err: string[];
}

export function fakeIo(overrides: Partial<Io> = {}): Io & Recorded {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    cwd: process.cwd(),
    env: {},
    interactive: false,
    ...overrides,
  };
}

/** Answers prompts in the order they are asked, from `answers`; records the messages. */
export function scriptedPrompter(answers: readonly unknown[] = []): Prompter & { asked: string[] } {
  const queue = [...answers];
  const asked: string[] = [];
  const take = <T>(message: string): Promise<T> => {
    asked.push(message);
    if (queue.length === 0) throw new Error(`no answer scripted for "${message}"`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test scripts the right type
    return Promise.resolve(queue.shift() as T);
  };
  return {
    asked,
    text: ({ message }) => take<string>(message),
    multiselect: ({ message }) => take<string[]>(message),
    select: ({ message }) => take<string>(message),
    confirm: ({ message }) => take<boolean>(message),
  };
}

export interface SystemCalls {
  installs: { root: string; packageManager: string; verbose: boolean }[];
  gitInits: string[];
}

export function fakeSystem(
  options: { installError?: Error; gitInit?: boolean } = {},
): System & SystemCalls {
  const installs: SystemCalls['installs'] = [];
  const gitInits: string[] = [];
  return {
    installs,
    gitInits,
    install: (root, packageManager, verbose) => {
      installs.push({ root, packageManager, verbose });
      return options.installError ? Promise.reject(options.installError) : Promise.resolve();
    },
    gitInit: (root) => {
      gitInits.push(root);
      return Promise.resolve(options.gitInit ?? true);
    },
  };
}

export interface FakeProc extends DevProcess {
  spec: DevSpec;
  stopped: boolean;
  /** What the process prints. */
  print(text: string): void;
  /** The process ends by itself. */
  exit(code: number | null): void;
}

export interface FakeDev extends DevHost {
  procs: FakeProc[];
  /** Ports `portFree` reports as taken. */
  busy: Set<number>;
  watched: string[][];
  /** The watched files changed. */
  change(): void;
  /** Ctrl+C. */
  interrupt(): void;
}

export function fakeDev(): FakeDev {
  const procs: FakeProc[] = [];
  const listeners = { watch: [] as (() => void)[], interrupt: [] as (() => void)[] };
  const watched: string[][] = [];
  return {
    procs,
    busy: new Set(),
    watched,
    change: () => {
      for (const listener of listeners.watch) listener();
    },
    interrupt: () => {
      for (const listener of listeners.interrupt) listener();
    },
    spawn: (spec) => {
      const out: ((chunk: string) => void)[] = [];
      const ends: ((code: number | null) => void)[] = [];
      const proc: FakeProc = {
        spec,
        stopped: false,
        pid: 1000 + procs.length,
        onOutput: (listener) => out.push(listener),
        onExit: (listener) => ends.push(listener),
        print: (text) => {
          for (const listener of out) listener(text);
        },
        exit: (code) => {
          for (const listener of ends) listener(code);
        },
        stop: () => {
          proc.stopped = true;
          proc.exit(0);
          return Promise.resolve();
        },
      };
      procs.push(proc);
      return proc;
    },
    onInterrupt: (listener) => {
      listeners.interrupt.push(listener);
      return () => {
        listeners.interrupt.splice(listeners.interrupt.indexOf(listener), 1);
      };
    },
    watch: (paths, listener) => {
      watched.push([...paths]);
      listeners.watch.push(listener);
      return () => {
        listeners.watch.splice(listeners.watch.indexOf(listener), 1);
      };
    },
    portFree(port) {
      return Promise.resolve(!this.busy.has(port));
    },
  };
}

export type TestRuntime = Runtime & {
  io: Io & Recorded;
  system: System & SystemCalls;
  dev: FakeDev;
};

export function testRuntime(
  overrides: Partial<Pick<Runtime, 'prompter' | 'fetch' | 'roots'>> = {},
): TestRuntime {
  return {
    io: fakeIo(),
    system: fakeSystem(),
    prompter: scriptedPrompter(),
    fetch: () => Promise.reject(new Error('no network in tests')),
    roots: assetRoots(),
    dev: fakeDev(),
    ...overrides,
  };
}

export async function tempDir(prefix = 'mfeflow-cli-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Every file under `dir`, as `/`-separated paths mapped to content. */
export async function readTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        out[path.relative(dir, full).split(path.sep).join('/')] = await fs.readFile(full, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

/** Awaits a promise that must reject with an MfeflowError and returns it. */
export async function failure(promise: Promise<unknown>): Promise<MfeflowError> {
  try {
    await promise;
  } catch (error) {
    if (isMfeflowError(error)) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

/** Calls `fn`, which must throw an MfeflowError, and returns it. */
export function thrown(fn: () => unknown): MfeflowError {
  try {
    fn();
  } catch (error) {
    if (isMfeflowError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}
