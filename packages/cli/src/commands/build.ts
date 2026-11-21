import os from 'node:os';
import path from 'node:path';
import { bundlerOf } from '@mfeflow/contracts';
import { findProjectRoot, isInside, isMfeflowError, MfeflowError, messageOf } from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, splitList } from '../args';
import { realBundlerHost, type BundlerApp, type BundlerHost } from '../bundler';
import { finding, type Finding } from '../findings';
import { inspectProject, type AppView } from '../inspect';
import { hasNoApps, noApps } from '../noapps';
import type { BuildApp, BuildResult, BuildStatus } from '../output';
import { Prefixer, wantsColor } from '../prefixed';
import { realDevHost, type DevHost, type DevProcess } from '../proc';
import { exitForFindings } from '../report';
import type { Runtime } from '../runtime';
import { builtKb } from '../sizes';
import { cliBinPath } from '../version';

export const BUILD_ARGS = {
  only: {
    type: 'string',
    description: 'Build only these apps, comma separated (default: every remote, then the shell)',
    valueHint: 'a,b',
  },
  concurrency: {
    type: 'string',
    description: 'How many apps to build at once (default: 4, or fewer CPUs)',
    valueHint: 'n',
  },
  dist: {
    type: 'string',
    description: 'Build output folder inside each app, where sizes are read (default dist)',
    valueHint: 'dir',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

/** Set by the parent build, so a child leaves the error summary to the parent. */
export const BUILD_CHILD_ENV = 'MFEFLOW_BUILD_CHILD';

export const defaultConcurrency = (): number => Math.min(4, os.availableParallelism());

function concurrencyOf(args: Record<string, unknown>): number {
  const given = args.concurrency;
  if (typeof given !== 'string' || given === '') return defaultConcurrency();
  const value = Number(given);
  if (!Number.isInteger(value) || value < 1) {
    throw new MfeflowError('E107', `--concurrency ${given}: must be a whole number of 1 or more`);
  }
  return value;
}

/** The app whose folder holds `cwd`, the deepest one if they nest. Undefined at the project root. */
export function appContaining(apps: readonly AppView[], cwd: string): AppView | undefined {
  const inside = apps.filter((app) => isInside(app.dir, cwd));
  return inside.toSorted((a, b) => b.dir.length - a.dir.length)[0];
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const isCallback = (value: unknown): value is () => void => typeof value === 'function';

/** Runs `work` with what the bundler prints on stdout going to stderr, so `--json` keeps stdout for the document. */
export async function withStdoutOnStderr<T>(work: () => Promise<T>): Promise<T> {
  const own = Object.hasOwn(process.stdout, 'write');
  const original: unknown = Reflect.get(process.stdout, 'write');
  Object.defineProperty(process.stdout, 'write', {
    configurable: true,
    writable: true,
    value: (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      const written = process.stderr.write(chunk);
      for (const done of rest) if (isCallback(done)) done();
      return written;
    },
  });
  try {
    return await work();
  } finally {
    if (own)
      Object.defineProperty(process.stdout, 'write', {
        configurable: true,
        writable: true,
        value: original,
      });
    else Reflect.deleteProperty(process.stdout, 'write');
  }
}

function errorFinding(error: MfeflowError, app: string): Finding {
  return {
    code: error.code,
    severity: 'error',
    check: 'build',
    message: error.message,
    fix: error.fix,
    docs: error.docs,
    fixable: false,
    app,
  };
}

interface Run {
  apps: Map<string, BuildApp>;
  findings: Finding[];
  /** Set by the first failure or by Ctrl+C: nothing new is started. */
  stop: boolean;
  interrupted: boolean;
  running: Set<DevProcess>;
}

function record(run: Run, app: AppView, status: BuildStatus, ms: number | null, kb: number | null) {
  run.apps.set(app.name, { name: app.name, kind: app.kind, status, ms, kb });
}

/** Builds one app in a process of its own, so its output carries its name and its bundler's state stays its own. */
async function buildInChild(
  app: AppView,
  host: DevHost,
  dist: string,
  color: boolean,
  lines: Prefixer,
  run: Run,
): Promise<void> {
  const started = Date.now();
  const outcome = await new Promise<number | null>((resolve) => {
    let child: DevProcess;
    try {
      child = host.spawn({
        command: process.execPath,
        args: [cliBinPath(), 'build', '--dist', dist],
        cwd: app.dir,
        env: color ? { FORCE_COLOR: '1', [BUILD_CHILD_ENV]: '1' } : { [BUILD_CHILD_ENV]: '1' },
      });
    } catch (error) {
      lines.line(app.name, `could not start: ${messageOf(error)}`);
      resolve(null);
      return;
    }
    run.running.add(child);
    child.onOutput((chunk) => {
      lines.feed(app.name, chunk);
    });
    child.onExit((code) => {
      lines.flush(app.name);
      run.running.delete(child);
      resolve(code);
    });
  });
  const ms = Date.now() - started;
  if (outcome === 0) {
    record(run, app, 'built', ms, await builtKb(app.kind, path.join(app.dir, dist)));
  } else if (run.interrupted) {
    record(run, app, 'stopped', ms, null);
  } else {
    run.stop = true;
    record(run, app, 'failed', ms, null);
    run.findings.push(
      finding(
        'build',
        'E310',
        outcome === null
          ? `${app.name} could not be started`
          : `${app.name} exited with code ${String(outcome)}`,
        { app: app.name },
      ),
    );
  }
}

/** Starts the apps in order, at most `limit` at a time, until one fails. Running ones are left to finish. */
async function runPhase(
  apps: readonly AppView[],
  limit: number,
  build: (app: AppView) => Promise<void>,
  run: Run,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!run.stop) {
      const app = apps[next++];
      if (app === undefined) return;
      // oxlint-disable-next-line no-await-in-loop -- a worker builds its apps one after another
      await build(app);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, apps.length) }, worker));
}

export function formatBuild(result: BuildResult): string {
  const width = Math.max(3, ...result.apps.map((a) => a.name.length));
  const rows = result.apps.map((a) => [
    a.name.padEnd(width),
    a.kind.padEnd(6),
    a.status.padEnd(7),
    (a.ms === null ? '-' : seconds(a.ms)).padStart(8),
    (a.kb === null ? '-' : `${String(a.kb)} KB`).padStart(10),
  ]);
  const lines = [
    '',
    ['app'.padEnd(width), 'kind  ', 'status ', '    time', '  JS (gzip)'].join('  '),
    ...rows.map((row) => row.join('  ')),
  ];
  for (const f of result.findings) {
    lines.push('', `error ${f.code} ${f.message}`, `  Fix: ${f.fix}`, `  ${f.docs}`);
  }
  return lines.join('\n');
}

/** What the summary says in one line: how many built, and why the rest did not. */
function headline(apps: readonly BuildApp[]): string {
  const count = (status: BuildStatus): number => apps.filter((a) => a.status === status).length;
  const parts = [`${String(count('built'))} built`];
  for (const status of ['failed', 'missing', 'stopped', 'skipped'] as const) {
    if (count(status) > 0) parts.push(`${String(count(status))} ${status}`);
  }
  return `mfeflow: ${parts.join(', ')}`;
}

/** Builds the app the command was started in, in this process. */
async function buildHere(
  rt: Runtime,
  app: AppView,
  bundlers: BundlerHost,
  dist: string,
  json: boolean,
  concurrency: number,
  root: string,
  bundler: BundlerApp['bundler'],
  dryRun: boolean,
): Promise<BuildResult> {
  const target: BundlerApp = { name: app.name, dir: app.dir, bundler };
  if (dryRun) {
    const planned: BuildResult = {
      ok: true,
      command: 'build',
      root,
      concurrency,
      apps: [{ name: app.name, kind: app.kind, status: 'skipped', ms: null, kb: null }],
      findings: [],
      interrupted: false,
    };
    if (!json) rt.io.stdout(`would build ${app.name} with ${bundler}, writing to ${dist}`);
    return planned;
  }
  const started = Date.now();
  const adapter = await bundlers.load(target);
  try {
    await (json ? withStdoutOnStderr(() => adapter.build(target)) : adapter.build(target));
  } catch (error) {
    throw isMfeflowError(error) ? error : new MfeflowError('E310', app.name, { cause: error });
  }
  const ms = Date.now() - started;
  const kb = await builtKb(app.kind, path.join(app.dir, dist));
  const result: BuildResult = {
    ok: true,
    command: 'build',
    root,
    concurrency,
    apps: [{ name: app.name, kind: app.kind, status: 'built', ms, kb }],
    findings: [],
    interrupted: false,
  };
  if (!json) {
    rt.io.stdout(
      `mfeflow: built ${app.name} in ${seconds(ms)}${kb === null ? '' : `, ${String(kb)} KB of JS`}`,
    );
  }
  return result;
}

export async function runBuild(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<BuildResult> {
  assertKnownFlags(raw, BUILD_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const concurrency = concurrencyOf(args);
  const dist = typeof args.dist === 'string' && args.dist !== '' ? args.dist : 'dist';
  const root = await findProjectRoot(globals.cwd);
  const view = await inspectProject(root, rt.io);
  const empty = (apps: BuildApp[], findings: Finding[] = []): BuildResult => ({
    ok: findings.length === 0,
    command: 'build',
    root,
    concurrency,
    apps,
    findings,
    interrupted: false,
  });
  if (hasNoApps(view.project)) {
    if (!globals.json) rt.io.stdout(noApps('there is nothing to build.'));
    return empty([]);
  }
  const bundlers = rt.bundler ?? realBundlerHost();
  const bundler = bundlerOf(view.project);
  const here = appContaining(view.apps, globals.cwd);
  const only = splitList(typeof args.only === 'string' ? args.only : undefined);

  if (here !== undefined) {
    if (only !== undefined) {
      throw new MfeflowError('E107', '--only works from the project root; this folder is one app');
    }
    if (!here.present) {
      throw new MfeflowError('E112', `${here.name} (${here.rel}) has no package.json`);
    }
    return buildHere(
      rt,
      here,
      bundlers,
      dist,
      globals.json,
      concurrency,
      root,
      bundler,
      globals.dryRun,
    );
  }

  const known = view.apps.map((a) => a.name);
  const unknown = (only ?? []).filter((n) => !known.includes(n));
  if (unknown.length > 0) {
    throw new MfeflowError(
      'E107',
      `--only ${unknown.join(', ')}: no such app (apps: ${known.join(', ')})`,
    );
  }
  const selected = view.apps.filter((a) => only === undefined || only.includes(a.name));
  const run: Run = {
    apps: new Map(),
    findings: [],
    stop: false,
    interrupted: false,
    running: new Set(),
  };
  const out = (text: string): void => {
    if (globals.json) rt.io.stderr(text);
    else rt.io.stdout(text);
  };
  const finish = (): BuildResult => {
    const apps = selected.map(
      (a): BuildApp =>
        run.apps.get(a.name) ?? {
          name: a.name,
          kind: a.kind,
          status: 'skipped',
          ms: null,
          kb: null,
        },
    );
    const result: BuildResult = {
      ok: exitForFindings(run.findings) === 0 && !run.interrupted,
      command: 'build',
      root,
      concurrency,
      apps,
      findings: run.findings,
      interrupted: run.interrupted,
    };
    if (!globals.json) rt.io.stdout(formatBuild(result));
    out(headline(apps));
    return result;
  };

  const buildable: AppView[] = [];
  for (const app of selected) {
    if (app.present) {
      buildable.push(app);
    } else {
      record(run, app, 'missing', null, null);
      run.findings.push(
        finding('build', 'E112', `${app.name} (${app.rel}) has no package.json`, { app: app.name }),
      );
    }
  }
  const order = [
    buildable.filter((a) => a.kind === 'remote'),
    buildable.filter((a) => a.kind === 'shell'),
  ];

  if (globals.dryRun) {
    for (const [i, group] of order.entries()) {
      if (group.length > 0) {
        out(`${i === 0 ? 'remotes' : 'shell'}: ${group.map((a) => a.name).join(', ')}`);
      }
    }
    return empty(
      selected.map(
        (a): BuildApp =>
          run.apps.get(a.name) ?? {
            name: a.name,
            kind: a.kind,
            status: 'skipped',
            ms: null,
            kb: null,
          },
      ),
      run.findings,
    );
  }

  // Look for every bundler before any build starts: a missing install should not cost the builds before it.
  const checked = await Promise.all(
    buildable.map(async (app) => {
      try {
        await bundlers.check({ name: app.name, dir: app.dir, bundler });
        return undefined;
      } catch (error) {
        if (!isMfeflowError(error)) throw error;
        record(run, app, 'failed', null, null);
        run.findings.push(errorFinding(error, app.name));
        return error;
      }
    }),
  );
  if (checked.some((e) => e !== undefined)) return finish();

  const color = wantsColor(rt.io);
  const lines = new Prefixer(
    view.apps.map((a) => a.name),
    color,
    out,
  );
  const host = rt.dev ?? realDevHost();
  const stopListening = host.onInterrupt(() => {
    if (run.interrupted) return;
    run.interrupted = true;
    run.stop = true;
    out('\nmfeflow: stopping…');
    void Promise.all([...run.running].map((child) => child.stop()));
  });
  try {
    for (const group of order) {
      // oxlint-disable-next-line no-await-in-loop -- the shell waits for the remotes
      await runPhase(
        group,
        concurrency,
        (app) => buildInChild(app, host, dist, color, lines, run),
        run,
      );
    }
  } finally {
    stopListening();
  }
  return finish();
}
