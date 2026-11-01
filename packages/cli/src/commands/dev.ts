import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, messageOf, MfeflowError } from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, repeated, splitList } from '../args';
import { assertAllowed, devIndex, parseOverrides, serializeIndex } from '../devregistry';
import { inspectProject, readText, type AppView, type ProjectView } from '../inspect';
import type { DevApp, DevResult } from '../output';
import { DEFAULT_WAIT, realDevHost, type DevHost, type DevProcess } from '../proc';
import type { Runtime } from '../runtime';

export const DEV_ARGS = {
  only: {
    type: 'string',
    description: 'Run only these apps, comma separated (default: the shell and every remote)',
    valueHint: 'a,b',
  },
  remote: {
    type: 'string',
    description:
      'Use a server you already run for a remote, repeatable: --remote checkout=http://localhost:3001',
    valueHint: 'name=url',
  },
  'allow-origin': {
    type: 'string',
    description: 'Let --remote point at this origin; localhost is always allowed. Repeatable',
    valueHint: 'origin',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

const PALETTE = [36, 35, 33, 32, 34, 91] as const;
const REGISTRY_DIR = '.mfeflow';
const REGISTRY_FILE = 'dev-registry.json';

/** Writes `text` through a temp file and a rename, so the shell never reads half of it. Returns whether it changed. */
async function writeIfChanged(file: string, text: string): Promise<boolean> {
  if ((await readText(file)) === text) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${String(process.pid)}.tmp`;
  await fs.writeFile(temp, text, 'utf8');
  await fs.rename(temp, file);
  return true;
}

class Session {
  private readonly running = new Map<string, DevProcess>();
  private readonly buffers = new Map<string, string>();
  private stopping = false;
  private readonly failed = new Set<string>();
  private finish: (() => void) | undefined;
  readonly done = new Promise<void>((resolve) => {
    this.finish = resolve;
  });
  private readonly width: number;
  private readonly color: boolean;

  constructor(
    private readonly host: DevHost,
    io: Pick<Runtime['io'], 'env' | 'interactive'>,
    private readonly out: (text: string) => void,
    private readonly registryFile: string,
    private readonly names: readonly string[],
  ) {
    this.width = Math.max(...names.map((n) => n.length), 4);
    this.color =
      io.env.NO_COLOR === undefined && (io.interactive || io.env.FORCE_COLOR !== undefined);
  }

  get hasFailed(): boolean {
    return this.failed.size > 0;
  }

  has(name: string): boolean {
    return this.running.has(name);
  }

  runningNames(): string[] {
    return [...this.running.keys()];
  }

  prefix(name: string): string {
    const index = Math.max(0, this.names.indexOf(name));
    const label = name.padEnd(this.width);
    const code = PALETTE[index % PALETTE.length] ?? 36;
    return this.color ? `\u001B[${String(code)}m${label} |\u001B[0m ` : `${label} | `;
  }

  line(name: string, text: string): void {
    this.out(`${this.prefix(name)}${text}`);
  }

  private feed(name: string, chunk: string): void {
    const text = (this.buffers.get(name) ?? '') + chunk;
    const lines = text.split(/\r?\n/);
    this.buffers.set(name, lines.pop() ?? '');
    for (const line of lines) if (line.trim() !== '') this.line(name, line);
  }

  private flush(name: string): void {
    const rest = this.buffers.get(name) ?? '';
    this.buffers.delete(name);
    if (rest.trim() !== '') this.line(name, rest);
  }

  start(app: AppView, packageManager: string): void {
    const child = this.host.spawn({
      command: packageManager,
      args: ['run', 'dev'],
      cwd: app.dir,
      env: {
        MFEFLOW_DEV_REGISTRY: this.registryFile,
        ...(this.color ? { FORCE_COLOR: '1' } : {}),
      },
    });
    this.running.set(app.name, child);
    this.failed.delete(app.name);
    child.onOutput((chunk) => {
      this.feed(app.name, chunk);
    });
    child.onExit((code) => {
      this.flush(app.name);
      if (this.running.get(app.name) !== child) return;
      this.running.delete(app.name);
      if (!this.stopping) {
        this.line(app.name, code === 0 ? 'stopped' : `exited with code ${String(code)}`);
        if (code !== 0) this.failed.add(app.name);
        if (this.running.size === 0) this.finish?.();
      }
    });
  }

  async stopOne(name: string): Promise<void> {
    const child = this.running.get(name);
    if (child === undefined) return;
    this.running.delete(name);
    await child.stop();
    this.flush(name);
  }

  async stopAll(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.running.keys()].map((name) => this.stopOne(name)));
    this.finish?.();
  }
}

function describe(app: AppView, packageManager: string): DevApp {
  return {
    name: app.name,
    kind: app.kind,
    port: app.port ?? null,
    url: app.port === undefined ? null : `http://localhost:${String(app.port)}`,
    command: `${packageManager} run dev`,
    status: 'started',
  };
}

/** Is `name` in a node_modules of the app or of a folder above it, up to the project root (a hoisted install puts it in the root's)? */
async function isLinked(app: AppView, root: string, name: string): Promise<boolean> {
  let dir = app.dir;
  while (!path.relative(root, dir).startsWith('..')) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- walks up one folder at a time
      await fs.access(path.join(dir, 'node_modules', ...name.split('/')));
      return true;
    } catch {
      // Not here; try the folder above.
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return false;
}

/**
 * Has the install reached the app? A remote added by `mfeflow add` is not runnable until it has:
 * every dependency it declares is linked in its own node_modules or, with node-linker=hoisted, the project's.
 */
async function hasDependencies(app: AppView, root: string): Promise<boolean> {
  const text = await readText(path.join(app.dir, 'package.json'));
  let doc: unknown;
  try {
    doc = text === undefined ? undefined : JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof doc !== 'object' || doc === null) return false;
  const names = ['dependencies', 'devDependencies'].flatMap((key) => {
    const group: unknown = Reflect.get(doc, key);
    return typeof group === 'object' && group !== null ? Object.keys(group) : [];
  });
  const linked = await Promise.all(names.map((name) => isLinked(app, root, name)));
  return linked.every(Boolean);
}

async function busyPorts(host: DevHost, apps: readonly AppView[]): Promise<AppView[]> {
  const checked = await Promise.all(
    apps.map(async (app) =>
      app.port === undefined ? undefined : (await host.portFree(app.port)) ? undefined : app,
    ),
  );
  return checked.filter((a) => a !== undefined);
}

function assertPortsFree(busy: readonly AppView[]): void {
  if (busy.length === 0) return;
  throw new MfeflowError(
    'E306',
    busy.map((a) => `${String(a.port)} is in use (${a.name})`).join('; '),
    {
      fix: "Stop whatever listens there (an earlier `mfeflow dev`?), or change the port in mfeflow.json and the app's rsbuild config.",
    },
  );
}

export async function runDev(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<DevResult> {
  assertKnownFlags(raw, DEV_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const host = rt.dev ?? realDevHost();
  const root = await findProjectRoot(globals.cwd);
  let view = await inspectProject(root);
  const { packageManager } = view.project;
  const known = view.apps.map((a) => a.name);
  const only = splitList(typeof args.only === 'string' ? args.only : undefined);
  const unknown = (only ?? []).filter((n) => !known.includes(n));
  if (unknown.length > 0) {
    throw new MfeflowError(
      'E107',
      `--only ${unknown.join(', ')}: no such app (apps: ${known.join(', ')})`,
    );
  }
  const overrides = parseOverrides(repeated(raw, 'remote'), [
    ...view.apps.filter((a) => a.kind === 'remote').map((a) => a.name),
    ...Object.keys(view.devRemotes ?? {}),
  ]);
  assertAllowed(overrides, repeated(raw, 'allow-origin'));

  const wanted = (v: ProjectView): AppView[] =>
    v.apps.filter(
      (a) => a.present && !overrides.has(a.name) && (only === undefined || only.includes(a.name)),
    );
  const first = wanted(view);
  if (first.length === 0) {
    throw new MfeflowError(
      'E107',
      'nothing to run: every app is missing, filtered out by --only, or overridden',
    );
  }
  const registryFile = path.join(root, REGISTRY_DIR, REGISTRY_FILE);
  const out = (text: string): void => {
    if (globals.json) rt.io.stderr(text);
    else rt.io.stdout(text);
  };
  const apps = [
    ...first.map((a) => describe(a, packageManager)),
    ...[...overrides.keys()].map((name): DevApp => ({
      name,
      kind: 'remote',
      port: null,
      url: overrides.get(name) ?? null,
      command: '',
      status: 'overridden',
    })),
  ];
  const base = {
    ok: true,
    command: 'dev' as const,
    root,
    registry: registryFile,
    apps,
    overrides: Object.fromEntries(overrides),
  };

  if (globals.dryRun) {
    if (!globals.json) {
      for (const app of apps) {
        out(
          app.status === 'overridden'
            ? `${app.name}: uses ${app.url ?? ''}`
            : `${app.name}: ${app.command} in ${view.apps.find((a) => a.name === app.name)?.rel ?? ''} (port ${String(app.port)})`,
        );
      }
      out(
        `dev registry: ${JSON.stringify(devIndex(view, overrides).remotes.map((r) => `${r.name} -> ${r.entry}`))}`,
      );
    }
    return { ...base, dryRun: true, interrupted: false };
  }

  assertPortsFree(await busyPorts(host, first));
  await writeIfChanged(registryFile, serializeIndex(devIndex(view, overrides)));
  const session = new Session(host, rt.io, out, registryFile, known);
  let busy = Promise.resolve();
  const waiting = new Set<string>();
  const policy = host.waitPolicy ?? DEFAULT_WAIT;
  let poll: NodeJS.Timeout | undefined;
  let waitingSince = 0;
  let closed = false;
  const stopPolling = (): void => {
    clearInterval(poll);
    poll = undefined;
  };
  // The lockfile watch can miss the end of an install, so a waiting remote is also looked for on a timer.
  const keepPolling = (): void => {
    if (waiting.size === 0 || closed) {
      stopPolling();
    } else if (poll === undefined) {
      waitingSince = Date.now();
      poll = setInterval(() => reload(true), policy.intervalMs);
    } else if (Date.now() - waitingSince > policy.timeoutMs) {
      out(
        `mfeflow: gave up waiting for ${[...waiting].join(', ')} to be installed. Run \`${packageManager} install\`, then save mfeflow.json or run \`mfeflow dev\` again.`,
      );
      waiting.clear();
      stopPolling();
    }
  };
  const reload = (fromPoll = false): void => {
    busy = busy.then(async () => {
      // A poll tick queued before the poll gave up must not start waiting all over again.
      if (fromPoll && poll === undefined) return;
      let next: ProjectView;
      try {
        next = await inspectProject(root);
      } catch (error) {
        out(`mfeflow: ${messageOf(error)} (keeping what is running)`);
        return;
      }
      view = next;
      if (await writeIfChanged(registryFile, serializeIndex(devIndex(next, overrides)))) {
        out(
          `mfeflow: dev registry updated (${
            devIndex(next, overrides)
              .remotes.map((r) => r.name)
              .join(', ') || 'no remotes'
          })`,
        );
      }
      const now = wanted(next);
      for (const name of session.runningNames()) {
        if (!now.some((a) => a.name === name)) {
          out(`mfeflow: ${name} left the project, stopping it`);
          // oxlint-disable-next-line no-await-in-loop -- one at a time keeps the output ordered
          await session.stopOne(name);
        }
      }
      const candidates = now.filter((a) => !session.has(a.name));
      const installed = await Promise.all(candidates.map((app) => hasDependencies(app, root)));
      const fresh = candidates.filter((app, i) => {
        if (installed[i] === true) {
          waiting.delete(app.name);
          return true;
        }
        if (!waiting.has(app.name)) {
          out(`mfeflow: ${app.name} is waiting for its install to finish`);
          waiting.add(app.name);
        }
        return false;
      });
      const stuck = await busyPorts(host, fresh);
      for (const app of fresh) {
        if (stuck.includes(app)) {
          out(`mfeflow: not starting ${app.name}: port ${String(app.port)} is in use`);
        } else {
          out(
            `mfeflow: starting ${app.name}${app.port === undefined ? '' : ` on ${String(app.port)}`}`,
          );
          session.start(app, packageManager);
        }
      }
      keepPolling();
    });
  };

  const stopWatching = host.watch(
    // The lockfile is written when an install ends, which is when a new remote can start.
    [
      path.join(root, 'mfeflow.json'),
      path.join(root, 'registry', 'envs', 'dev'),
      path.join(root, 'pnpm-lock.yaml'),
      ...first
        .filter((app) => app.kind === 'shell' && view.devRemotes !== undefined)
        .map((app) => path.join(app.dir, 'public', 'config')),
    ],
    () => reload(),
  );
  let interrupted = false;
  const stopListening = host.onInterrupt(() => {
    if (interrupted) return;
    interrupted = true;
    out('\nmfeflow: stopping…');
    void session.stopAll();
  });
  for (const app of first) session.start(app, packageManager);
  out(
    `mfeflow: running ${first.map((a) => a.name).join(', ')}${overrides.size > 0 ? `; using your ${[...overrides.keys()].join(', ')}` : ''}. Ctrl+C stops everything.`,
  );
  try {
    await session.done;
  } finally {
    stopWatching();
    stopListening();
    closed = true;
    stopPolling();
    await busy;
    await session.stopAll();
  }
  return { ...base, ok: !session.hasFailed, dryRun: false, interrupted };
}
